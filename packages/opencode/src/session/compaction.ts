import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Session } from "."
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { MessageV2 } from "./message-v2"
import z from "zod"
import { SessionPrompt } from "./prompt"
import { Token } from "../util/token"
import { Log } from "../util/log"
import { fn } from "@/util/fn"
import { Config } from "@/config/config"
import { EvidenceWriter } from "@/evidence/writer"
import { stableJson } from "@/util/stable-json"
import { ulid } from "ulid"
import { CompactionFacts, CompactionInput, CompactionReport, CompactionTrigger } from "./compaction-protocol"
import fs from "fs/promises"
import path from "path"
import { ContextLedger } from "./context-ledger"
import { AnchorSnapshot } from "./anchor-snapshot"
import { withTimeout } from "@/util/timeout"
import { Capsule } from "./capsule"
import { CapsuleAssistedRunner } from "./capsule-assisted"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })

  export const Event = {
    Compacted: BusEvent.define(
      "session.compacted",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }

  export const Thresholds = {
    specVersion: "compaction-thresholds/1.0" as const,
    soft: 0.85,
    hard: 0.95,
    emergency: 1.0,
  }

  const toTextBytes = (messages: MessageV2.WithParts[]) => {
    const parts = messages.flatMap((m) => m.parts)
    const text = parts
      .filter((p): p is MessageV2.TextPart => p.type === "text")
      .filter((p) => !p.synthetic)
      .map((p) => p.text)
      .join("\n")
    return Buffer.byteLength(text, "utf-8")
  }

  const preview = (text: string, limit: number) => text.trim().slice(0, limit)

  export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    const config = await Config.get()
    if (config.compaction?.auto === false) return false
    const context = input.model.limit.context
    if (context === 0) return false
    const count = input.tokens.input + input.tokens.cache.read + input.tokens.output
    const output = Math.min(input.model.limit.output, SessionPrompt.OUTPUT_TOKEN_MAX) || SessionPrompt.OUTPUT_TOKEN_MAX
    const usable = input.model.limit.input || context - output
    return count > usable
  }

  export async function trigger(input: {
    tokens: MessageV2.Assistant["tokens"]
    model: Provider.Model
  }): Promise<z.infer<typeof CompactionTrigger> | undefined> {
    const cfg = await Config.get()
    if (cfg.compaction?.auto === false) return undefined
    const context = input.model.limit.context
    if (context === 0) return undefined

    const count = input.tokens.input + input.tokens.cache.read + input.tokens.output
    const output = Math.min(input.model.limit.output, SessionPrompt.OUTPUT_TOKEN_MAX) || SessionPrompt.OUTPUT_TOKEN_MAX
    const usable = input.model.limit.input || context - output
    const ratio = usable <= 0 ? 0 : count / usable

    const level =
      ratio >= Thresholds.emergency
        ? ("emergency" as const)
        : ratio >= Thresholds.hard
          ? ("hard" as const)
          : ratio >= Thresholds.soft
            ? ("soft" as const)
            : undefined
    if (!level) return undefined

    return CompactionTrigger.parse({
      specVersion: "compaction-trigger/1.0",
      level,
      thresholds: Thresholds,
      tokens: { count, usable, ratio },
      limit: {
        context,
        input: input.model.limit.input,
        output: input.model.limit.output,
      },
    })
  }

  export const PRUNE_MINIMUM = 20_000
  export const PRUNE_PROTECT = 40_000

  const PRUNE_PROTECTED_TOOLS = ["skill"]

  // goes backwards through parts until there are 40_000 tokens worth of tool
  // calls. then erases output of previous tool calls. idea is to throw away old
  // tool calls that are no longer relevant.
  export async function prune(input: { sessionID: string }) {
    const config = await Config.get()
    if (config.compaction?.prune === false) return
    log.info("pruning")
    const msgs = await Session.messages({ sessionID: input.sessionID })
    let total = 0
    let pruned = 0
    const toPrune = []
    let turns = 0

    loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
      const msg = msgs[msgIndex]
      if (msg.info.role === "user") turns++
      if (turns < 2) continue
      if (msg.info.role === "assistant" && msg.info.summary) break loop
      for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = msg.parts[partIndex]
        if (part.type === "tool")
          if (part.state.status === "completed") {
            if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue

            if (part.state.time.compacted) break loop
            const estimate = Token.estimate(part.state.output)
            total += estimate
            if (total > PRUNE_PROTECT) {
              pruned += estimate
              toPrune.push(part)
            }
          }
      }
    }
    log.info("found", { pruned, total })
    if (pruned > PRUNE_MINIMUM) {
      for (const part of toPrune) {
        if (part.state.status === "completed") {
          part.state.time.compacted = Date.now()
          await Session.updatePart(part)
        }
      }
      log.info("pruned", { count: toPrune.length })
    }
  }

  export async function process(input: {
    parentID: string
    messages: MessageV2.WithParts[]
    sessionID: string
    abort: AbortSignal
    auto: boolean
  }) {
    const user = input.messages.findLast((m) => m.info.id === input.parentID)?.info as MessageV2.User | undefined
    const writer = await EvidenceWriter.open({ sessionId: input.sessionID })

    if (!user) {
      const reason = "未找到触发压缩的用户消息（会话链可能已变更）。"
      const next = "请重试；若持续出现，请在 GUI 中导出会话并提交问题复现信息。"
      const err = await writer.artifact({
        kind: "compaction-error",
        path: `compaction/${ulid()}/errors/missing-parent.json`,
        data: stableJson({ reason_zh: reason, next_steps_zh: next, parentId: input.parentID }),
      })
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: input.sessionID,
        severity: "error",
        actor: "session:compaction",
        type: "compaction.degraded",
        summary: "compaction degraded",
        data: { reason_zh: reason, next_steps_zh: next, error_artifact: err.path },
        redaction: { applied: true, policyVersion: "v1" },
      })
      return "stop"
    }

    if (input.abort.aborted) {
      const reason = "压缩已取消：收到取消信号（AbortSignal）。"
      const next = "请重新触发压缩；若是自动压缩频繁触发，可临时关闭 compaction.auto。"
      const err = await writer.artifact({
        kind: "compaction-error",
        path: `compaction/${ulid()}/errors/cancelled.json`,
        data: stableJson({ reason_zh: reason, next_steps_zh: next, parentId: input.parentID }),
      })
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: input.sessionID,
        severity: "warn",
        actor: "session:compaction",
        type: "compaction.cancelled",
        summary: "compaction cancelled",
        data: { reason_zh: reason, next_steps_zh: next, error_artifact: err.path },
        redaction: { applied: true, policyVersion: "v1" },
      })
      return "stop"
    }

    const msg = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: input.parentID,
      sessionID: input.sessionID,
      mode: "compaction",
      agent: "compaction",
      summary: true,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        output: 0,
        input: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: user.model.modelID,
      providerID: user.model.providerID,
      time: {
        created: Date.now(),
      },
    })) as MessageV2.Assistant

    const compactionId = msg.id
    const base = `compaction/${compactionId}`
    const now = new Date().toISOString()
    const result = await withTimeout(
      (async () => {
        const messageIds = input.messages.map((m) => m.info.id)
        const textBytes = toTextBytes(input.messages)
        const parentMsg = input.messages.findLast((m) => m.info.id === input.parentID)
        const task = parentMsg?.parts.find((p): p is MessageV2.CompactionPart => p.type === "compaction")
        const triggerInfo = task?.trigger
        const contextLedger = await ContextLedger.read(input.sessionID)
        const baseDir = Instance.worktree === "/" ? Instance.directory : Instance.worktree

        const cancel = async (input2: { reasonZh: string; nextStepsZh: string }) => {
          const err = await writer.artifact({
            kind: "compaction-error",
            path: `${base}/errors/cancelled.json`,
            data: stableJson({ reason_zh: input2.reasonZh, next_steps_zh: input2.nextStepsZh, parentId: input.parentID }),
          })
          await writer.event({
            specVersion: "event/1.0",
            ts: new Date().toISOString(),
            sessionId: input.sessionID,
            severity: "warn",
            actor: "session:compaction",
            type: "compaction.cancelled",
            summary: "compaction cancelled",
            data: { reason_zh: input2.reasonZh, next_steps_zh: input2.nextStepsZh, error_artifact: err.path },
            redaction: { applied: true, policyVersion: "v1" },
          })
          return "stop" as const
        }

        const replay = AnchorSnapshot.checkReplay({
          sessionId: input.sessionID,
          lastContextPackId: contextLedger.lastContextPackId,
          pointer: contextLedger.lastAnchorSnapshot,
        })
        if (!replay.ok) {
          return cancel({ reasonZh: replay.reasonZh, nextStepsZh: replay.nextStepsZh })
        }

        const previousAnchor = contextLedger.lastAnchorSnapshot
          ? await AnchorSnapshot.read({
              baseDir,
              pointer: contextLedger.lastAnchorSnapshot,
            })
          : undefined

        if (contextLedger.lastAnchorSnapshot && !previousAnchor) {
          return cancel({
            reasonZh: "恢复链路 fail-closed：anchor-snapshot 不可读或不可解析。",
            nextStepsZh: "请重建 context-pack 与 anchor-snapshot，再重试恢复链路。",
          })
        }

        const anchor = AnchorSnapshot.build({
          sessionId: input.sessionID,
          messageId: input.parentID,
          planId: "unknown",
          generatedAtUtc: now,
          repo: previousAnchor?.repo ?? { head: "unknown", dirty: false },
          model: { providerId: user.model.providerID, modelId: user.model.modelID },
          context: {
            lastContextPackId: contextLedger.lastContextPackId,
            orchestratorMode: previousAnchor?.context.orchestratorMode ?? "unknown",
          },
          toolsetFingerprint: previousAnchor?.toolsetFingerprint ?? "unknown",
        })
        const anchorEntry = await writer.artifact({
          kind: "anchor-snapshot",
          path: `${base}/anchor.snapshot.json`,
          data: stableJson(anchor),
        })

        await writer.event({
          specVersion: "event/1.0",
          ts: now,
          sessionId: input.sessionID,
          severity: "info",
          actor: "session:compaction",
          type: "anchor.snapshot",
          summary: "anchor snapshot recorded",
          data: {
            specVersion: anchor.specVersion,
            compactionId,
            messageId: anchor.messageId,
            planId: anchor.planId,
            toolsetFingerprint: anchor.toolsetFingerprint,
            anchor_artifact: anchorEntry.path,
          },
          redaction: { applied: true, policyVersion: "v1" },
        })

        await ContextLedger.update({
          sessionId: input.sessionID,
          patch: {
            lastAnchorSnapshot: { path: anchorEntry.path, sha256: anchorEntry.sha256 },
          },
        })

        const startedInput = CompactionInput.parse({
          specVersion: "compaction-input/1.0",
          sessionId: input.sessionID,
          compactionId,
          parentId: input.parentID,
          generatedAtUtc: now,
          trigger: triggerInfo,
          messageIds,
          totals: { messages: messageIds.length, textBytes },
        })

        const inputEntry = await writer.artifact({
          kind: "compaction-input",
          path: `${base}/compaction.input.json`,
          data: stableJson(startedInput),
        })

        await writer.event({
          specVersion: "event/1.0",
          ts: now,
          sessionId: input.sessionID,
          severity: "info",
          actor: "session:compaction",
          type: "compaction.started",
          summary: "compaction started",
          data: {
            compactionId,
            parentId: input.parentID,
            trigger: triggerInfo,
            previousContextPackId: contextLedger.lastContextPackId,
            input_artifact: inputEntry.path,
          },
          redaction: { applied: true, policyVersion: "v1" },
        })

        if (input.abort.aborted)
          return cancel({
            reasonZh: "压缩已取消：处理中途收到取消信号（AbortSignal）。",
            nextStepsZh: "请重试；若频繁触发取消，可检查是否有并发请求或手动取消行为。",
          })

        const lastUserText =
          input.messages
            .filter((m) => m.info.role === "user" && m.info.id !== input.parentID)
            .findLast((m) => m.parts.some((p) => p.type === "text" && !p.synthetic && p.text.trim().length > 0))
            ?.parts.filter((p): p is MessageV2.TextPart => p.type === "text")
            .filter((p) => !p.synthetic)
            .map((p) => p.text.trim())
            .filter(Boolean)
            .join("\n\n") ?? ""

        const facts = CompactionFacts.parse({
          specVersion: "compaction-facts/1.0",
          sessionId: input.sessionID,
          compactionId,
          generatedAtUtc: now,
          facts: {
            session_id: { status: "known", value: input.sessionID },
            compaction_id: { status: "known", value: compactionId },
            trigger_parent_id: { status: "known", value: input.parentID },
            last_user_message_preview: { status: "known", value: preview(lastUserText, 240) },
            active_files: { status: "unknown" },
            next_steps: { status: "unknown" },
          },
        })

        const factsEntry = await writer.artifact({
          kind: "compaction-facts",
          path: `${base}/facts.json`,
          data: stableJson(facts),
        })

        const capsule = Capsule.buildSession({
          sessionId: input.sessionID,
          generatedAtUtc: now,
          pointers: [
            { path: inputEntry.path, sha256: inputEntry.sha256, kind: inputEntry.kind },
            { path: factsEntry.path, sha256: factsEntry.sha256, kind: factsEntry.kind },
          ],
          notes: [
            { status: "known", value: `compactionId: ${compactionId}` },
            { status: "known", value: `trigger: ${triggerInfo ? stableJson(triggerInfo) : "unknown"}` },
            { status: "known", value: `last_user_message_preview: ${preview(lastUserText, 800) || "unknown"}` },
            { status: "known", value: "plugin_prompt: disabled (structured backend compaction)" },
          ],
        })
        const capsuleRendered = Capsule.render(capsule)

        const capsuleSessionEntry = await writer.artifact({
          kind: "compaction-capsule-session",
          path: `${base}/capsule.session.json`,
          data: stableJson(capsule),
        })

        const capsuleEntry = await writer.artifact({
          kind: "compaction-capsule",
          path: `${base}/capsule.md`,
          data: capsuleRendered,
        })

        await ContextLedger.update({
          sessionId: input.sessionID,
          patch: {
            lastCapsuleSession: { path: capsuleSessionEntry.path, sha256: capsuleSessionEntry.sha256 },
            lastCapsuleRendered: { path: capsuleEntry.path, sha256: capsuleEntry.sha256 },
          },
        })

        const statePath = path.join(baseDir, ".opencode", "compaction", input.sessionID, "state.json")
        const prevText = await Bun.file(statePath).text().catch(() => "")
        const prev = (() => {
          if (!prevText) return {}
          try {
            return JSON.parse(prevText) as { lastCompactionId?: string; lastFactsPath?: string }
          } catch {
            return {}
          }
        })()
        const prevFactsText =
          prev.lastFactsPath ? await Bun.file(path.join(baseDir, prev.lastFactsPath)).text().catch(() => "") : ""
        const prevFacts = (() => {
          if (!prevFactsText) return { success: false as const }
          try {
            return CompactionFacts.safeParse(JSON.parse(prevFactsText) as unknown)
          } catch {
            return { success: false as const }
          }
        })()
        const prevKeys = prevFacts.success ? Object.keys(prevFacts.data.facts) : []
        const nextKeys = Object.keys(facts.facts)
        const added = nextKeys.filter((k) => !prevKeys.includes(k))
        const removed = prevKeys.filter((k) => !nextKeys.includes(k))
        const changed = prevFacts.success
          ? nextKeys.filter((k) => {
              const a = prevFacts.data.facts[k]
              const b = facts.facts[k]
              if (!a || !b) return false
              return stableJson(a) !== stableJson(b)
            })
          : []

        const reportRel = `${base}/compaction.report.json`
        const reportPath = `.opencode/artifacts/${input.sessionID}/${reportRel}`
        const report = CompactionReport.parse({
          specVersion: "compaction-report/1.0",
          sessionId: input.sessionID,
          compactionId,
          generatedAtUtc: now,
          previous: {
            compactionId: prev.lastCompactionId,
            contextPackId: contextLedger.lastContextPackId,
          },
          delta: { added, removed, changed },
          artifacts: {
            capsule: { path: capsuleEntry.path, sha256: capsuleEntry.sha256, kind: capsuleEntry.kind },
            facts: { path: factsEntry.path, sha256: factsEntry.sha256, kind: factsEntry.kind },
            input: { path: inputEntry.path, sha256: inputEntry.sha256, kind: inputEntry.kind },
            report: { path: reportPath, sha256: "0".repeat(64), kind: "compaction-report" },
            errors: [],
          },
        })

        const reportEntry = await writer.artifact({
          kind: "compaction-report",
          path: reportRel,
          data: stableJson(report),
        })

        const finalReport = CompactionReport.parse({
          ...report,
          artifacts: {
            ...report.artifacts,
            report: { path: reportEntry.path, sha256: reportEntry.sha256, kind: reportEntry.kind },
          },
        })
        await writer.artifact({ kind: "compaction-report", path: reportRel, data: stableJson(finalReport) })

        await fs.mkdir(path.dirname(statePath), { recursive: true })
        await Bun.write(
          statePath,
          stableJson({
            specVersion: "compaction-state/1.0",
            updatedAtUtc: now,
            lastCompactionId: compactionId,
            lastFactsPath: factsEntry.path,
          }),
        )

        await writer.event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId: input.sessionID,
          severity: "info",
          actor: "session:compaction",
          type: "compaction.completed",
          summary: "compaction completed",
          data: {
            compactionId,
            artifacts: {
              capsule: { path: capsuleEntry.path, sha256: capsuleEntry.sha256, kind: capsuleEntry.kind },
              capsuleSession: {
                path: capsuleSessionEntry.path,
                sha256: capsuleSessionEntry.sha256,
                kind: capsuleSessionEntry.kind,
              },
              facts: { path: factsEntry.path, sha256: factsEntry.sha256, kind: factsEntry.kind },
              input: { path: inputEntry.path, sha256: inputEntry.sha256, kind: inputEntry.kind },
              report: { path: reportEntry.path, sha256: reportEntry.sha256, kind: reportEntry.kind },
            },
            delta: finalReport.delta,
          },
          redaction: { applied: true, policyVersion: "v1" },
        })

        void CapsuleAssistedRunner.runFromCompaction({
          sessionId: input.sessionID,
          compactionId,
          parentId: input.parentID,
          hintText: capsuleRendered,
          modelFallback: { providerID: user.model.providerID, modelID: user.model.modelID },
          artifacts: [
            { path: capsuleEntry.path, sha256: capsuleEntry.sha256, kind: capsuleEntry.kind },
            { path: capsuleSessionEntry.path, sha256: capsuleSessionEntry.sha256, kind: capsuleSessionEntry.kind },
            { path: factsEntry.path, sha256: factsEntry.sha256, kind: factsEntry.kind },
            { path: inputEntry.path, sha256: inputEntry.sha256, kind: inputEntry.kind },
            { path: reportEntry.path, sha256: reportEntry.sha256, kind: reportEntry.kind },
          ],
        }).catch((error) => {
          log.warn("capsule assisted failed", { error })
        })

        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: msg.id,
          sessionID: input.sessionID,
          type: "text",
          text: capsuleRendered,
          time: { start: Date.now(), end: Date.now() },
        })
        msg.finish = "end_turn"
        msg.time.completed = Date.now()
        await Session.updateMessage(msg)

        if (input.auto) {
          const continueMsg = await Session.updateMessage({
            id: Identifier.ascending("message"),
            role: "user",
            sessionID: input.sessionID,
            time: {
              created: Date.now(),
            },
            agent: user.agent,
            model: user.model,
          })
          await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID: continueMsg.id,
            sessionID: input.sessionID,
            type: "text",
            synthetic: true,
            text: "Continue if you have next steps",
            time: {
              start: Date.now(),
              end: Date.now(),
            },
          })
        }

        Bus.publish(Event.Compacted, { sessionID: input.sessionID })
        return "continue" as const
      })(),
      15_000,
    ).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error)
      const isTimeout = message.includes("timed out")
      const type = isTimeout ? "compaction.timeout" : "compaction.degraded"
      const reason = isTimeout ? "压缩超时：超过后端允许的处理时限。" : "压缩降级：生成结构化产物时发生错误。"
      const next = isTimeout ? "请重试；若频繁超时，可减少会话长度或暂时关闭自动压缩。" : "请重试；若持续失败，请查看错误产物并提交复现信息。"
      const err = await writer.artifact({
        kind: "compaction-error",
        path: `${base}/errors/exception.json`,
        data: stableJson({ reason_zh: reason, next_steps_zh: next, message }),
      })
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: input.sessionID,
        severity: "error",
        actor: "session:compaction",
        type,
        summary: isTimeout ? "compaction timeout" : "compaction degraded",
        data: { reason_zh: reason, next_steps_zh: next, error_artifact: err.path },
        redaction: { applied: true, policyVersion: "v1" },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: msg.id,
        sessionID: input.sessionID,
        type: "text",
        text: ["# Compaction Failed", "", `reason_zh: ${reason}`, `next_steps_zh: ${next}`, "", `error: ${message}`].join(
          "\n",
        ),
        time: { start: Date.now(), end: Date.now() },
      })
      msg.finish = "unknown"
      msg.time.completed = Date.now()
      await Session.updateMessage(msg)
      return "stop" as const
    })

    return result
  }

  export const create = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      agent: z.string(),
      model: z.object({
        providerID: z.string(),
        modelID: z.string(),
      }),
      auto: z.boolean(),
      trigger: CompactionTrigger.optional(),
    }),
    async (input) => {
      const msg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: {
          created: Date.now(),
        },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        trigger: input.trigger,
      })
    },
  )
}
