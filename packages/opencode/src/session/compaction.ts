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
import { EvidenceReader } from "@/evidence/reader"
import { stableJson } from "@/util/stable-json"
import { ulid } from "ulid"
import { CompactionFacts, CompactionInput, CompactionQuality, CompactionReport, CompactionTrigger } from "./compaction-protocol"
import fs from "fs/promises"
import path from "path"
import { ContextLedger } from "./context-ledger"
import { AnchorSnapshot } from "./anchor-snapshot"
import { withTimeout } from "@/util/timeout"
import { Capsule } from "./capsule"
import { CapsuleAssistedRunner } from "./capsule-assisted"
import { resolveProbeCorrelationID } from "./probe-correlation"
import type { CapsuleAssistedRunResult } from "./capsule-assisted"

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

  const PATH_LIMIT = 8
  const STEP_LIMIT = 6
  const PATH_RE = /(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+|[A-Za-z0-9._-]+\.[A-Za-z0-9]{1,10}/g
  const STEP_RE = /\b(next step|next steps|todo|to-do|need to|needs to|should|must|fix|add|update|implement|write|verify|refresh|run|check|ensure|continue|plan)\b|请|下一步|需要|修复|新增|更新|验证/iu
  const GOAL_RE = /\b(goal|task|need|needs|please|todo|next step|fix|add|update|implement|write|ensure|verify|upgrade|refresh)\b|目标|任务|请|下一步|需要|修复|新增|更新|验证/iu
  const COMPACT_RE = /^(?:\/?compact|please compact)\b/i
  const NEGATIVE_RE =
    /\b(do not|don't|not|never|without|avoid|skip|remove|disable|drop|no)\b|不要|禁止|别|移除|禁用|跳过|无须|不需要/iu
  const MACHINE_FIELDS = [
    "specversion:",
    "sessionid:",
    "generatedatutc:",
    "sha256:",
    "plugin_prompt:",
    "compaction-input:",
    "compaction-facts:",
  ]

  const STOP = new Set([
    "a",
    "an",
    "and",
    "the",
    "to",
    "for",
    "of",
    "in",
    "on",
    "with",
    "from",
    "by",
    "at",
    "is",
    "are",
    "be",
    "this",
    "that",
    "please",
    "next",
    "step",
    "steps",
    "todo",
    "need",
    "needs",
    "must",
    "should",
    "ensure",
    "verify",
    "run",
    "check",
    "continue",
    "plan",
    "add",
    "update",
    "implement",
    "write",
    "fix",
    "refresh",
    "keep",
    "remove",
    "disable",
    "avoid",
    "skip",
    "not",
    "no",
    "do",
    "don't",
  ])

  const clip = (text: string) => text.replace(/^[`"'(<\[{]+/, "").replace(/[`"')>\]}.,;:!?]+$/, "")

  const uniq = <T>(items: T[], key: (item: T) => string) => {
    const seen = new Set<string>()
    return items.filter((item) => {
      const id = key(item)
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
  }

  const stripNoise = (text: string) =>
    [0, 1, 2].reduce(
      (acc) =>
        acc
          .replace(/\b(?:known|unknown)\s*:\s*/giu, "")
          .replace(/\b(?:next[_\s-]*steps?|active[_\s-]*files?)\s*:\s*/giu, ""),
      text,
    )

  const cleanValue = (text: string) => {
    const raw = clip(text.trim())
    if (!raw) return ""
    const flat = raw.replace(/\s+/g, " ").replace(/[|｜]{2,}/g, "|").trim()
    if (!flat) return ""
    const value = clip(stripNoise(flat).replace(/\s+/g, " ").trim())
    if (!value) return ""
    if (value === "|" || value === "-" || value === "pending") return ""
    const lower = value.toLowerCase()
    if (MACHINE_FIELDS.some((item) => lower.includes(item))) return ""
    return value
  }

  const stepSignal = (text: string) => {
    const words = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}._/-]+/gu, " ")
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
      .filter((item) => !STOP.has(item))
    return words.length > 0
  }

  const bullets = (items: string[], fallback: string) => (items.length > 0 ? items.map((item) => `- ${item}`) : [`- ${fallback}`])

  const lines = (text: string) =>
    text
      .split(/\r?\n/)
      .flatMap((item) => item.split(/[。！？.!?]/))
      .map((item) =>
        clip(
          item
            .replace(/^[-*]\s+/, "")
            .replace(/^\d+[.)]\s+/, "")
            .replace(/^round\s+\d+\s*:\s*/i, "")
            .trim(),
        ),
      )
      .filter((item) => item.length > 0)

  const renderSummary = (input: { goal: string; triggerSource: string; files: string[]; steps: string[] }) => {
    const goal = cleanValue(input.goal)
    const files = uniq(
      input.files.map((item) => cleanValue(item)).filter((item): item is string => Boolean(item)),
      (item) => item.toLowerCase(),
    )
    const steps = uniq(
      input.steps.map((item) => cleanValue(item)).filter((item): item is string => Boolean(item)),
      (item) => item.toLowerCase(),
    )
    const trigger = input.triggerSource.startsWith("auto:") ? `Compaction trigger: ${input.triggerSource}` : "Compaction trigger: manual"
    const decisions = [trigger, files.length > 0 ? `Active files in scope: ${files.join(", ")}` : "Active files in scope: unknown"]
    const open = [
      ...(files.length === 0 ? ["Active files still need confirmation"] : []),
      ...(steps.length === 0 ? ["Next steps still need confirmation"] : []),
    ]
    return [
      "# Compaction Summary",
      "",
      "## Goal",
      ...bullets(goal ? [goal] : [], "unknown"),
      "",
      "## Decisions",
      ...bullets(decisions, "none"),
      "",
      "## Open Questions",
      ...bullets(open, "none"),
      "",
      "## Next Steps",
      ...bullets(steps, "unknown"),
    ].join("\n")
  }

  const safePath = (raw: string) => {
    const item = clip(raw.trim().replaceAll("\\", "/"))
    if (!item) return
    if (item.length > 180) return
    if (item.includes("://")) return
    if (item.includes("\u0000")) return
    if (item.startsWith("/") || item.startsWith("~")) return
    if (/^[A-Za-z]:\//.test(item)) return
    if (!/^[A-Za-z0-9._/-]+$/.test(item)) return
    const norm = path.posix.normalize(item)
    if (!norm || norm === "." || norm === "..") return
    if (norm.startsWith("../") || norm.includes("/../")) return
    const rel = norm.startsWith("./") ? norm.slice(2) : norm
    if (!rel) return
    if (!rel.includes("/") && !rel.includes(".")) return
    return rel
  }

  const gatherText = (messages: MessageV2.WithParts[]) =>
    messages
      .slice(-24)
      .flatMap((msg) =>
        msg.parts
          .filter((part): part is MessageV2.TextPart => part.type === "text")
          .filter((part) => !part.synthetic)
          .map((part) => ({ role: msg.info.role, text: part.text.trim() })),
      )
      .filter((item) => item.text.length > 0)

  const semantic = (messages: MessageV2.WithParts[]) => {
    const chunks = gatherText(messages)
    const rev = chunks.slice().reverse()
    const users = rev.filter((item) => item.role === "user")
    const userLines = users.flatMap((item) => lines(item.text))
    const primaryGoal = userLines.find((item) => GOAL_RE.test(item) && !COMPACT_RE.test(item))
    const fallbackGoal = userLines.find((item) => !COMPACT_RE.test(item)) ?? userLines[0] ?? ""
    const goal = preview(cleanValue(primaryGoal ?? fallbackGoal), 240)

    const files = uniq(
      rev
        .flatMap((item) => item.text.match(PATH_RE) ?? [])
        .map((item) => safePath(cleanValue(item)))
        .filter((item): item is string => Boolean(item)),
      (item) => item.toLowerCase(),
    ).slice(0, PATH_LIMIT)

    const steps = uniq(
      rev
        .flatMap((item) => lines(item.text))
        .filter((item) => item.length >= 8 && item.length <= 220)
        .filter((item) => STEP_RE.test(item))
        .filter((item) => !COMPACT_RE.test(item))
        .flatMap((item) => item.split(/\s*[|｜]\s*/u))
        .filter((item) => STEP_RE.test(item))
        .map((item) => cleanValue(item))
        .filter((item): item is string => Boolean(item))
        .filter((item) => stepSignal(item))
        .filter((item) => item.length >= 4 && item.length <= 220),
      (item) => item.toLowerCase(),
    ).slice(0, STEP_LIMIT)

    return {
      goal,
      files,
      steps,
      lastUser: users[0]?.text ?? "",
    }
  }

  type QualityRow = {
    status: "known" | "unknown"
    value?: string
  }

  const keyFrom = (text: string) => {
    const safe = (text.match(PATH_RE) ?? [])
      .map((item) => safePath(item))
      .find((item): item is string => Boolean(item))
    if (safe) return safe.toLowerCase()

    const words = clip(text.toLowerCase())
      .replace(/[^\p{L}\p{N}._/-]+/gu, " ")
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
      .filter((item) => !STOP.has(item))
      .slice(0, 6)
    if (words.length === 0) return ""
    return words.join("_")
  }

  const qualitySignals = (input: {
    goal: QualityRow
    decisions: QualityRow[]
    openQuestions: QualityRow[]
    workingSet: string[]
  }) => {
    const rows = [
      input.goal,
      ...input.decisions,
      ...input.openQuestions,
      ...input.workingSet.map((item) => ({ status: "known" as const, value: item })),
    ]
    const claims = rows
      .map((item) => {
        if (!item.value) return
        const text = String(item.value).trim()
        if (!text) return
        const key = keyFrom(text)
        if (!key) return
        const polarity = NEGATIVE_RE.test(text) ? -1 : 1
        return { key, polarity }
      })
      .filter((item): item is { key: string; polarity: -1 | 1 } => Boolean(item))

    const polarityMap = claims.reduce(
      (acc, item) => {
        const prev = acc.get(item.key) ?? new Set<number>()
        prev.add(item.polarity)
        acc.set(item.key, prev)
        return acc
      },
      new Map<string, Set<number>>(),
    )

    const contradictionCount = [...polarityMap.values()].filter((item) => item.size > 1).length
    const domainSignals = [
      input.goal.status === "known",
      input.decisions.some((item) => item.status === "known"),
      input.openQuestions.some((item) => item.status === "known"),
      input.workingSet.length > 0,
    ]
    const domainScore = domainSignals.filter(Boolean).length / domainSignals.length
    const consistencyScore = Number((domainScore * (1 / (1 + contradictionCount))).toFixed(3))
    const reasonCodes = [
      ...(input.goal.status === "unknown" ? ["goal_unknown"] : []),
      ...(input.workingSet.length === 0 ? ["working_set_empty"] : []),
      ...(input.openQuestions.some((item) => item.status === "unknown") ? ["open_questions_pending"] : []),
      ...(contradictionCount > 0 ? ["contradiction_detected"] : []),
      ...(consistencyScore < 0.75 ? ["consistency_low"] : []),
      ...(domainScore < 1 ? ["consistency_partial"] : []),
    ]

    return {
      consistencyScore,
      contradictionCount,
      claimCount: claims.length,
      reasonCodes: [...new Set(reasonCodes)].sort(),
    }
  }

  const referenceCheck = async (sessionID: string) => {
    const rows = await EvidenceReader.readEvents(sessionID, { cursor: 0, limit: 1200 }).catch(() => undefined)
    const resolved = rows?.events.findLast((item) => item.type === "reference_check.mode_resolved")
    if (!resolved)
      return {
        modeResolved: "unknown" as const,
        confidence: 0,
        reasonCodes: ["reference_check_unavailable"],
      }

    const data = resolved.data ?? {}
    const modeRaw = typeof data["mode_resolved"] === "string" ? data["mode_resolved"] : data["mode"]
    const modeResolved = modeRaw === "strict" || modeRaw === "normal" ? modeRaw : "unknown"
    const confidenceRaw = Number(data["confidence"])
    const confidence = Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0
    const reasonCodes = Array.isArray(data["reason_codes"])
      ? data["reason_codes"].map((item) => String(item)).filter((item) => /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(item))
      : []
    return {
      modeResolved,
      confidence,
      reasonCodes: reasonCodes.length > 0 ? reasonCodes : ["reference_check_missing_reason_codes"],
    }
  }

  const source = (input: { auto: boolean; trigger: z.infer<typeof CompactionTrigger> | undefined }) => {
    if (!input.auto) return "manual" as const
    const level = input.trigger?.level ?? "emergency"
    return `auto:${level}` as const
  }

  type AssistedSkipCode =
    | "disabled"
    | "assisted_failed"
    | "assisted_degraded"
    | "verify_failed"
    | "artifact_missing"

  const blockedViewPatterns = [
    /<assistant_claims_json>/iu,
    /capsule\.session\.json/iu,
    /capsule\.assisted\.verify\.json/iu,
    /```json/iu,
    /\bspecVersion\s*:/iu,
    /\bsessionId\s*:/iu,
    /\bgeneratedAtUtc\s*:/iu,
    /\bsha256\s*:/iu,
    /\bplugin_prompt\s*:/iu,
    /\bcompaction-input\s*:/iu,
    /\bcompaction-facts\s*:/iu,
  ]

  const viewSafe = (text: string) => blockedViewPatterns.every((p) => !p.test(text))

  const coverageNone = { known: 0, unknown: 0, anchors: 0 }
  const assistedTimeoutDefault = 30_000

  const runtimeReason = (value: string | undefined) => (value === "timeout" ? "timeout" : "failed")

  const degradedNote = (value: "timeout" | "failed") =>
    `LLM 摘要不可用（原因：${value}），当前显示 deterministic 摘要`

  const withDegradedNote = (input: { text: string; reason: string | undefined }) => {
    const note = degradedNote(runtimeReason(input.reason))
    if (input.text.includes(note)) return input.text
    return `${input.text.trimEnd()}\n\n> ${note}`
  }

  const skipCode = (input: { status: CapsuleAssistedRunResult["status"]; verifyOk: boolean }): AssistedSkipCode => {
    if (input.status === "disabled") return "disabled"
    if (input.status === "failed") return "assisted_failed"
    if (input.status === "degraded") return "assisted_degraded"
    if (!input.verifyOk) return "verify_failed"
    return "artifact_missing"
  }

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
    const probeCorrelationID = resolveProbeCorrelationID({
      sessionID: input.sessionID,
      messageID: input.parentID,
    })
    const base = `compaction/${compactionId}`
    const now = new Date().toISOString()
    const result = await withTimeout(
      (async () => {
        const messageIds = input.messages.map((m) => m.info.id)
        const textBytes = toTextBytes(input.messages)
        const parentMsg = input.messages.findLast((m) => m.info.id === input.parentID)
        const task = parentMsg?.parts.find((p): p is MessageV2.CompactionPart => p.type === "compaction")
        const triggerInfo = task?.trigger
        const triggerSource = source({ auto: input.auto, trigger: triggerInfo })
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
          probe_correlation_id: probeCorrelationID,
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
            probe_correlation_id: probeCorrelationID,
            parentId: input.parentID,
            trigger: triggerInfo,
            trigger_source: triggerSource,
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

        const insight = semantic(input.messages)
        const activeValue = insight.files.join(", ")
        const stepsValue = insight.steps.join(" | ")
        const active = insight.files.length > 0 ? ({ status: "known" as const, value: activeValue }) : ({ status: "unknown" as const })
        const steps = insight.steps.length > 0 ? ({ status: "known" as const, value: stepsValue }) : ({ status: "unknown" as const })
        const previewText = preview(insight.lastUser || insight.goal, 240)

        const facts = CompactionFacts.parse({
          specVersion: "compaction-facts/1.0",
          sessionId: input.sessionID,
          compactionId,
          generatedAtUtc: now,
          facts: {
            session_id: { status: "known", value: input.sessionID },
            compaction_id: { status: "known", value: compactionId },
            trigger_parent_id: { status: "known", value: input.parentID },
            trigger_source: { status: "known", value: triggerSource },
            last_user_message_preview: { status: "known", value: previewText },
            active_files: active,
            next_steps: steps,
          },
        })
        const goal = insight.goal
          ? ({ status: "known" as const, value: insight.goal })
          : ({ status: "unknown" as const, value: "goal unavailable" })
        const decisions = [
          { status: "known" as const, value: `compaction_id=${compactionId}` },
          { status: "known" as const, value: `trigger_parent_id=${input.parentID}` },
          { status: "known" as const, value: `trigger_source=${triggerSource}` },
        ]
        const openQuestions = [
          active.status === "unknown"
            ? ({ status: "unknown" as const, value: "active_files pending confirmation" })
            : ({ status: "known" as const, value: `active_files extracted (${insight.files.length})` }),
          steps.status === "unknown"
            ? ({ status: "unknown" as const, value: "next_steps pending confirmation" })
            : ({ status: "known" as const, value: `next_steps extracted (${insight.steps.length})` }),
        ]
        const workingSet = [...insight.files, ...insight.steps]

        const factsEntry = await writer.artifact({
          kind: "compaction-facts",
          path: `${base}/facts.json`,
          data: stableJson(facts),
        })

        const capsule = Capsule.buildSession({
          sessionId: input.sessionID,
          generatedAtUtc: now,
          goal,
          decisions,
          openQuestions,
          pointers: [
            { path: inputEntry.path, sha256: inputEntry.sha256, kind: inputEntry.kind },
            { path: factsEntry.path, sha256: factsEntry.sha256, kind: factsEntry.kind },
          ],
          notes: [
            { status: "known", value: `compactionId: ${compactionId}` },
            { status: "known", value: `trigger_source: ${triggerSource}` },
            { status: "known", value: `trigger: ${triggerInfo ? stableJson(triggerInfo) : triggerSource}` },
            { status: "known", value: `last_user_message_preview: ${preview(insight.lastUser || insight.goal, 800) || "unavailable"}` },
            { status: active.status, value: `active_files: ${active.status === "known" ? activeValue : "pending"}` },
            { status: steps.status, value: `next_steps: ${steps.status === "known" ? stepsValue : "pending"}` },
            { status: "known", value: "plugin_prompt: disabled (structured backend compaction)" },
          ],
        })
        const capsuleRendered = Capsule.render(capsule)
        const summaryRendered = renderSummary({
          goal: insight.goal,
          triggerSource,
          files: insight.files,
          steps: insight.steps,
        })

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
        const factTotals = Object.values(facts.facts).reduce(
          (acc, item) => {
            if (item.status === "known") acc.known += 1
            if (item.status === "unknown") acc.unknown += 1
            return acc
          },
          { known: 0, unknown: 0 },
        )
        const semanticKnown = [goal.status, active.status, steps.status].filter((item) => item === "known").length
        const consistency = qualitySignals({
          goal,
          decisions,
          openQuestions,
          workingSet,
        })
        const reference = await referenceCheck(input.sessionID)
        const contradictionRate = Number((consistency.contradictionCount / Math.max(1, consistency.claimCount)).toFixed(3))
        const anchorScore = Number(
          ((
            ((contextLedger.lastAnchorSnapshot ? 1 : 0) + (reference.modeResolved === "unknown" ? 0 : 1) + reference.confidence) /
            3
          ) *
            (1 / (1 + contradictionRate))).toFixed(3),
        )
        const qualityReasonCodes = [
          ...consistency.reasonCodes,
          ...(reference.modeResolved === "unknown" ? ["reference_check_unlinked"] : ["reference_check_linked"]),
        ]
        const quality = CompactionQuality.parse({
          semantic_coverage: Number((semanticKnown / 3).toFixed(3)),
          consistency_score: consistency.consistencyScore,
          anchor_consistency_score: anchorScore,
          known_facts: factTotals.known,
          unknown_facts: factTotals.unknown,
          contradiction_count: consistency.contradictionCount,
          contradiction_rate: contradictionRate,
          active_files_count: insight.files.length,
          next_steps_count: insight.steps.length,
          reason_codes: [...new Set(qualityReasonCodes)].sort(),
        })

        const reportRel = `${base}/compaction.report.json`
        const reportPath = `.opencode/artifacts/${input.sessionID}/${reportRel}`
        const report = CompactionReport.parse({
          specVersion: "compaction-report/1.0",
          sessionId: input.sessionID,
          compactionId,
          probe_correlation_id: probeCorrelationID,
          generatedAtUtc: now,
          previous: {
            compactionId: prev.lastCompactionId,
            contextPackId: contextLedger.lastContextPackId,
          },
          delta: { added, removed, changed },
          quality,
          reference_check: {
            mode_resolved: reference.modeResolved,
            confidence: reference.confidence,
            reason_codes: reference.reasonCodes,
          },
          ui_view_source: "deterministic",
          assisted_status: "disabled",
          assisted_reason_code: null,
          assisted_timeout_ms: assistedTimeoutDefault,
          summary_format_version: "human-summary/1.0",
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

        await writer.event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId: input.sessionID,
          severity: "info",
          actor: "session:compaction",
          type: "compaction.quality",
          summary: "compaction semantic quality recorded",
          data: {
            compactionId,
            probe_correlation_id: probeCorrelationID,
            semantic_coverage: finalReport.quality.semantic_coverage,
            consistency_score: finalReport.quality.consistency_score,
            anchor_consistency_score: finalReport.quality.anchor_consistency_score,
            known_facts: finalReport.quality.known_facts,
            unknown_facts: finalReport.quality.unknown_facts,
            contradiction_count: finalReport.quality.contradiction_count,
            contradiction_rate: finalReport.quality.contradiction_rate,
            active_files_count: finalReport.quality.active_files_count,
            next_steps_count: finalReport.quality.next_steps_count,
            reason_codes: finalReport.quality.reason_codes,
            reference_check_mode_resolved: finalReport.reference_check?.mode_resolved,
            reference_check_confidence: finalReport.reference_check?.confidence,
            reference_check_reason_codes: finalReport.reference_check?.reason_codes,
            report_artifact: reportEntry.path,
          },
          redaction: { applied: true, policyVersion: "v1" },
        })

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
            probe_correlation_id: probeCorrelationID,
            quality: finalReport.quality,
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

        const summaryPart = MessageV2.TextPart.parse(
          await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID: msg.id,
            sessionID: input.sessionID,
            type: "text",
            text: summaryRendered,
            time: { start: Date.now(), end: Date.now() },
          }),
        )
        msg.finish = "end_turn"
        msg.time.completed = Date.now()
        await Session.updateMessage(msg)

        const writeRuntime = async (input2: {
          uiViewSource: "deterministic" | "llm"
          assistedStatus: "success" | "degraded" | "failed" | "disabled"
          assistedReasonCode: string | null
          assistedTimeoutMs: number
          summaryFormatVersion: string
        }) => {
          const updated = CompactionReport.parse({
            ...finalReport,
            ui_view_source: input2.uiViewSource,
            assisted_status: input2.assistedStatus,
            assisted_reason_code: input2.assistedReasonCode,
            assisted_timeout_ms: input2.assistedTimeoutMs,
            summary_format_version: input2.summaryFormatVersion,
          })
          await writer.artifact({ kind: "compaction-report", path: reportRel, data: stableJson(updated) })
          return updated
        }

        const emitSkipped = async (input2: {
          status: CapsuleAssistedRunResult["status"]
          reasonCode: AssistedSkipCode
          assistedReasonCode?: string
          assistedTimeoutMs: number
          coverage: { known: number; unknown: number; anchors: number }
          viewArtifact?: string
          verifyArtifact?: string
        }) => {
          const assistedStatus = input2.status === "success" ? "degraded" : input2.status
          const runtime = await writeRuntime({
            uiViewSource: "deterministic",
            assistedStatus,
            assistedReasonCode: input2.assistedReasonCode ?? null,
            assistedTimeoutMs: input2.assistedTimeoutMs,
            summaryFormatVersion: "human-summary/1.0",
          })

          if (input2.status !== "disabled") {
            const text = withDegradedNote({
              text: summaryRendered,
              reason: input2.assistedReasonCode,
            })
            await Session.updatePart({
              id: summaryPart.id,
              messageID: summaryPart.messageID,
              sessionID: summaryPart.sessionID,
              type: "text",
              text,
              time: {
                start: summaryPart.time?.start ?? Date.now(),
                end: Date.now(),
              },
            })
          }

          await writer.event({
            specVersion: "event/1.0",
            ts: new Date().toISOString(),
            sessionId: input.sessionID,
            severity: "info",
            actor: "session:compaction",
            type: "compaction.assisted_skipped",
            summary: "compaction assisted skipped",
            data: {
              compactionId,
              status: input2.status,
              reasonCode: input2.reasonCode,
              assisted_status: runtime.assisted_status,
              assisted_reason_code: runtime.assisted_reason_code,
              assisted_timeout_ms: runtime.assisted_timeout_ms,
              ui_view_source: runtime.ui_view_source,
              summary_format_version: runtime.summary_format_version,
              coverage: input2.coverage,
              view_artifact: input2.viewArtifact,
              verify_artifact: input2.verifyArtifact,
            },
            redaction: { applied: true, policyVersion: "v1" },
          })
        }

        void (async () => {
          const cfg = await Config.get()
          const assistedEnabled = cfg.experimental?.compaction_llm_augment ?? false
          const assistedTimeoutMs = cfg.experimental?.compaction_llm_timeout_ms ?? assistedTimeoutDefault
          if (!assistedEnabled) {
            await emitSkipped({
              status: "disabled",
              reasonCode: "disabled",
              assistedTimeoutMs,
              coverage: coverageNone,
            })
            return
          }

          const assisted: CapsuleAssistedRunResult = await CapsuleAssistedRunner.runFromCompaction({
            sessionId: input.sessionID,
            compactionId,
            parentId: input.parentID,
            hintText: summaryRendered,
            timeoutMs: assistedTimeoutMs,
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
            return {
              status: "failed",
              verifyOk: false,
              reasonCode: "runner_error",
              coverage: coverageNone,
            } satisfies CapsuleAssistedRunResult
          })

          if (assisted.status !== "success") {
            await emitSkipped({
              status: assisted.status,
              reasonCode: skipCode({ status: assisted.status, verifyOk: assisted.verifyOk }),
              assistedReasonCode: assisted.reasonCode,
              assistedTimeoutMs,
              coverage: assisted.coverage,
              viewArtifact: assisted.artifacts?.view?.path,
              verifyArtifact: assisted.artifacts?.verify?.path,
            })
            return
          }

          if (!assisted.verifyOk) {
            await emitSkipped({
              status: assisted.status,
              reasonCode: "verify_failed",
              assistedReasonCode: assisted.reasonCode,
              assistedTimeoutMs,
              coverage: assisted.coverage,
              viewArtifact: assisted.artifacts?.view?.path,
              verifyArtifact: assisted.artifacts?.verify?.path,
            })
            return
          }

          const viewText = assisted.viewText?.trim() ?? ""
          const viewArtifact = assisted.artifacts?.view?.path
          if (!viewText || !viewArtifact) {
            await emitSkipped({
              status: assisted.status,
              reasonCode: "artifact_missing",
              assistedReasonCode: assisted.reasonCode,
              assistedTimeoutMs,
              coverage: assisted.coverage,
              viewArtifact,
              verifyArtifact: assisted.artifacts?.verify?.path,
            })
            return
          }

          if (!viewSafe(viewText)) {
            await emitSkipped({
              status: assisted.status,
              reasonCode: "verify_failed",
              assistedReasonCode: assisted.reasonCode,
              assistedTimeoutMs,
              coverage: assisted.coverage,
              viewArtifact,
              verifyArtifact: assisted.artifacts?.verify?.path,
            })
            return
          }

          await Session.updatePart({
            id: summaryPart.id,
            messageID: summaryPart.messageID,
            sessionID: summaryPart.sessionID,
            type: "text",
            text: viewText,
            time: {
              start: summaryPart.time?.start ?? Date.now(),
              end: Date.now(),
            },
          })

          const runtime = await writeRuntime({
            uiViewSource: "llm",
            assistedStatus: "success",
            assistedReasonCode: null,
            assistedTimeoutMs,
            summaryFormatVersion: "assisted-summary/1.0",
          })

          await writer.event({
            specVersion: "event/1.0",
            ts: new Date().toISOString(),
            sessionId: input.sessionID,
            severity: "info",
            actor: "session:compaction",
            type: "compaction.assisted_applied",
            summary: "compaction assisted applied",
            data: {
              compactionId,
              status: assisted.status,
              assisted_status: runtime.assisted_status,
              assisted_reason_code: runtime.assisted_reason_code,
              assisted_timeout_ms: runtime.assisted_timeout_ms,
              ui_view_source: runtime.ui_view_source,
              summary_format_version: runtime.summary_format_version,
              coverage: assisted.coverage,
              view_artifact: viewArtifact,
              verify_artifact: assisted.artifacts?.verify?.path,
            },
            redaction: { applied: true, policyVersion: "v1" },
          })
        })().catch((error) => {
          log.warn("compaction assisted apply failed", { error })
        })

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
