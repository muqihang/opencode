import path from "path"
import z from "zod"
import { generateObject, type ModelMessage } from "ai"
import { EvidenceWriter } from "@/evidence/writer"
import { CachePolicy } from "@/cache/policy"
import { CacheStore } from "@/cache/store"
import { Instance } from "@/project/instance"
import { stableJson } from "@/util/stable-json"
import { sha256Text } from "@/routing/cache"
import { withTimeout } from "@/util/timeout"
import { Provider } from "@/provider/provider"
import { ContextLedger } from "@/session/context-ledger"
import { CapsuleAssisted, CapsuleAssistedAnchor, CapsuleAssistedBudget, CapsuleAssistedInput, CapsuleAssistedItem, CapsuleAssistedVerify } from "./capsule-assisted-protocol"
import { CapsuleAssistedVerifier } from "./capsule-assisted-verifier"

type Artifact = { path: string; sha256: string; kind: string }

export type CapsuleAssistedRunResult = {
  status: "success" | "degraded" | "failed" | "disabled"
  verifyOk: boolean
  reasonCode: string
  degradedReasonZh?: string
  coverage: { known: number; unknown: number; anchors: number }
  viewText?: string
  artifacts?: {
    input?: Artifact
    capsule?: Artifact
    view?: Artifact
    verify?: Artifact
  }
}

const coverageNone = { known: 0, unknown: 0, anchors: 0 }

const baseDir = () => (Instance.worktree === "/" ? Instance.directory : Instance.worktree)

const normRel = (value: string) => value.replace(/\\/g, "/").replace(/\/+/g, "/")

const uniq = <T>(items: T[], key: (v: T) => string) => {
  const seen = new Set<string>()
  return items.filter((item) => {
    const id = key(item)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

const kind = (value: string) => {
  const k = value.toLowerCase()
  if (k.includes("patch") || k.includes("diff") || k.includes("changeset")) return "diff" as const
  if (k.includes("issue")) return "issue" as const
  return "file" as const
}

const anchorFrom = (input: { path: string; sha256: string; kind: string; anchor?: string }) =>
  CapsuleAssistedAnchor.parse({
    path: normRel(input.path),
    sha256: input.sha256,
    kind: kind(input.kind),
    ...(input.anchor ? { anchor: input.anchor } : {}),
  })

const render = (input: {
  status: "success" | "degraded" | "failed"
  degradedReasonZh?: string
  items: CapsuleAssistedItem[]
  anchors: CapsuleAssistedAnchor[]
  coverage: { known: number; unknown: number; anchors: number }
}) => {
  const head = [
    "# AI 建议要点（可核验）",
    "",
    `- status: ${input.status}`,
    `- coverage: known=${input.coverage.known}, unknown=${input.coverage.unknown}, anchors=${input.coverage.anchors}`,
    ...(input.degradedReasonZh ? [`- degradedReasonZh: ${input.degradedReasonZh}`] : []),
    "",
  ]

  const block = (t: "decision" | "question") => {
    const items = input.items.filter((i) => i.type === t)
    const title = t === "decision" ? "## 已形成的决策" : "## 仍待确认的问题"
    const lines = items.length > 0 ? items.map((i) => {
      const tag = i.status === "known" ? "known" : "unknown"
      const refs = i.evidenceIndices.length > 0 ? ` (evidence: ${i.evidenceIndices.join(",")})` : ""
      const reason = i.status === "unknown" && i.unknownReasonZh ? ` — 无法核验：${i.unknownReasonZh}` : ""
      return `- [${tag}] ${i.text}${refs}${reason}`
    }) : ["- (none)"]
    return [title, ...lines, ""]
  }

  const unknowns = input.items.filter((i) => i.status === "unknown")
  const tail = unknowns.length > 0
    ? [
        "## 未知/风险",
        ...unknowns.map((i) => `- ${i.text}${i.unknownReasonZh ? ` — 无法核验：${i.unknownReasonZh}` : ""}`),
        "",
      ]
    : []

  const refs = [
    "## 引用（anchors）",
    ...(input.anchors.length > 0
      ? input.anchors.map((a, idx) => `- @${idx}: ${a.kind}: ${a.path} (sha256: ${a.sha256})`)
      : ["- (none)"]),
    "",
  ]

  return [...head, ...block("decision"), ...block("question"), ...tail, ...refs].join("\n")
}

const handoffPointers = z
  .object({
    workingSet: z
      .object({
        pointers: z
          .array(
            z
              .object({
                kind: z.string().min(1),
                path: z.string().min(1),
                sha256: z.string().min(1),
                anchor: z.string().min(1).optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

const resolveModel = async (fallback: { providerID: string; modelID: string }) => {
  const preferred = [
    { providerID: "zai", modelID: "glm-4.7" },
    { providerID: "zhipuai", modelID: "glm-4.7" },
    { providerID: fallback.providerID, modelID: fallback.modelID },
  ]

  const pick = async (item: { providerID: string; modelID: string }) => {
    const model = await Provider.getModel(item.providerID, item.modelID).catch(() => undefined)
    if (!model) return
    const language = await Provider.getLanguage(model).catch(() => undefined)
    if (!language) return
    return { model, language }
  }

  for (const item of preferred) {
    const hit = await pick(item)
    if (hit) return hit
  }

  const def = await Provider.defaultModel().catch(() => undefined)
  const found = def ? await pick(def) : undefined
  return found
}

const promptText = (input: { hintText: string; anchors: CapsuleAssistedAnchor[]; budget: CapsuleAssistedBudget }) => {
  const list = input.anchors
    .map((a, idx) => {
      const short = a.sha256.slice(0, 12)
      return `@${idx} ${a.kind} ${a.path} sha256:${short}`
    })
    .join("\n")

  const lines = [
    "你正在生成一个“AI 建议要点（可核验）”的结构化清单。",
    "",
    "硬约束（必须遵守）：",
    "1) 只能引用下方 anchors 列表（用 evidenceIndices 索引），禁止编造路径/文件名。",
    "2) status=known 的条目必须有 evidenceIndices（至少 1 个）；无法引用则输出 status=unknown 并给 unknownReasonZh。",
    "3) 每条 text 必须短、清晰，不要写长段落；禁止输出 ``` 代码块。",
    `4) 总条目数不超过 ${input.budget.maxItems}。`,
    "",
    "任务背景（hint）：",
    input.hintText.trim() ? input.hintText.trim() : "(none)",
    "",
    "可引用 anchors（按索引引用）：",
    list || "(none)",
    "",
    "输出要求：请只输出 JSON 对象，满足 schema：{ items: Item[] }。",
  ]
  return lines.join("\n")
}

const pickReason = (input: {
  status: "success" | "degraded" | "failed"
  failures: Array<{ code: string }>
  llmError?: unknown
  cacheHit: boolean
}) => {
  if (input.status === "success") return { code: undefined as string | undefined, zh: undefined as string | undefined }

  const err = input.llmError ? String(input.llmError instanceof Error ? input.llmError.message : input.llmError) : ""
  const timed = err.includes("timed out") || err.includes("timeout") || err.includes("Operation timed out")

  if (input.status === "failed") {
    const code = timed ? "timeout" : "provider_error"
    const zh = timed ? "模型调用超时" : "模型调用失败"
    return { code, zh: err ? `${zh}：${err}` : zh }
  }

  if (input.cacheHit && input.failures.some((f) => f.code === "schema_invalid")) {
    return { code: "cache_corrupt", zh: "缓存命中但验证失败（疑似缓存污染）" }
  }

  const order = ["content_unsafe", "sha_mismatch", "ref_unresolvable", "budget_exceeded", "schema_invalid"]
  const hit = order.find((c) => input.failures.some((f) => f.code === c))
  const code = hit ?? "ref_unresolvable"
  const zh =
    code === "content_unsafe"
      ? "内容安全门禁未通过"
      : code === "sha_mismatch"
        ? "引用内容发生变化（sha 不匹配）"
        : code === "budget_exceeded"
          ? "输出超预算"
          : code === "schema_invalid"
            ? "输出不符合协议"
            : "证据引用无法解析"
  return { code, zh }
}

export const CapsuleAssistedRunner = {
  async runFromCompaction(input: {
    sessionId: string
    compactionId: string
    parentId?: string
    hintText: string
    modelFallback: { providerID: string; modelID: string }
    artifacts: Artifact[]
  }): Promise<CapsuleAssistedRunResult> {
    const start = Date.now()
    const now = new Date().toISOString()
    const writer = await EvidenceWriter.open({ sessionId: input.sessionId })

    const versions = { promptVersion: "v1", refVersion: "v1", verifierVersion: "v1" } as const
    const budget = CapsuleAssistedBudget.parse({ maxBytes: 8_000, maxItems: 24, maxAnchors: 40 })

    await writer.event({
      specVersion: "event/1.0",
      ts: now,
      sessionId: input.sessionId,
      severity: "info",
      actor: "session:capsule_assisted",
      type: "capsule.assisted.requested",
      summary: "capsule assisted requested",
      data: {
        compactionId: input.compactionId,
        parentId: input.parentId,
        versions,
        budget,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })

    const resolved = await resolveModel(input.modelFallback)
    if (!resolved) {
      const reasonZh = "无法选择可用模型（provider/model 未配置或不可用）"
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: input.sessionId,
        severity: "error",
        actor: "session:capsule_assisted",
        type: "capsule.assisted.failed",
        summary: "capsule assisted failed",
        data: { compactionId: input.compactionId, status: "failed", degradedReasonZh: reasonZh, reasonCode: "provider_error" },
        redaction: { applied: true, policyVersion: "v1" },
      })
      return {
        status: "failed",
        verifyOk: false,
        reasonCode: "provider_error",
        degradedReasonZh: reasonZh,
        coverage: coverageNone,
      }
    }

    const ledger = await ContextLedger.read(input.sessionId)
    const base = baseDir()

    const recent = (ledger.handoffs ?? []).slice(-5)
    const handoffs = await Promise.all(
      recent.map(async (h) => {
        const abs = path.join(base, h.capsulePath)
        const json = await Bun.file(abs).json().catch(() => undefined)
        const parsed = handoffPointers.safeParse(json)
        const pointers = parsed.success ? parsed.data.workingSet?.pointers ?? [] : []
        const owned = pointers.map((p) => ({
          kind: typeof p.kind === "string" ? p.kind : "file",
          path: typeof p.path === "string" ? p.path : "",
          sha256: typeof p.sha256 === "string" ? p.sha256 : "",
          anchor: typeof p.anchor === "string" ? p.anchor : undefined,
        }))
        return [
          { kind: "capsule-handoff", path: h.capsulePath, sha256: h.capsuleSha256 },
          ...owned.filter((p) => p.path && p.sha256),
        ]
      }),
    )

    const seeded = input.artifacts
      .filter((a) => a.path && a.sha256 && a.kind)
      .map((a) => ({ kind: a.kind, path: a.path, sha256: a.sha256 }))

    const candidates = uniq(
      [
        ...seeded,
        ...handoffs.flat().filter((p) => p.path && p.sha256 && p.kind),
      ],
      (p) => `${p.path}|${p.sha256}|${p.kind}`,
    )
      .slice(0, budget.maxAnchors)
      .map((p) => anchorFrom({ path: p.path, sha256: p.sha256, kind: p.kind }))

    const anchors = candidates.length > 0 ? candidates : []

    const inputPack = CapsuleAssistedInput.parse({
      specVersion: "capsule-assisted-input/1.0",
      sessionId: input.sessionId,
      compactionId: input.compactionId,
      generatedAtUtc: now,
      model: { providerID: resolved.model.providerID, modelID: resolved.model.id },
      versions,
      budget,
      anchors,
      hintText: input.hintText,
    })

    const inputEntry = await writer.artifact({
      kind: "compaction-capsule-assisted-input",
      path: `compaction/${input.compactionId}/capsule.assisted.input.json`,
      data: stableJson(inputPack),
    })

    const scope = { projectId: Instance.project.id, worktreeRoot: base }
    const cacheKey = CacheStore.key({
      namespace: "capsule-assisted",
      scope,
      input: {
        specVersion: "capsule-assisted-cache-key/1.0",
        sessionId: input.sessionId,
        model: { providerID: resolved.model.providerID, modelID: resolved.model.id },
        versions,
        budget,
        anchors: anchors.map((a) => ({ path: a.path, sha256: a.sha256, kind: a.kind, anchor: a.anchor })),
        hintSha256: sha256Text(input.hintText),
      },
    })
    const store = CacheStore.open({ namespace: "capsule-assisted", scope, limits: CachePolicy.limits() })
    const policy = CachePolicy.policy("capsule-assisted")

    const Draft = z
      .object({
        items: z.array(CapsuleAssistedItem).default([]),
      })
      .strict()

    const CacheValue = z
      .object({
        specVersion: z.literal("capsule-assisted-cache/1.0"),
        items: z.array(CapsuleAssistedItem).default([]),
      })
      .strict()

    const llm = await store
      .getOrCompute({
        key: cacheKey,
        ttlMs: CachePolicy.ttlMs("capsule-assisted"),
        policy: { enabled: policy.enabled, force: policy.force },
        compute: async () => {
          const messages: ModelMessage[] = [
            {
              role: "system",
              content: "You generate safe, verifiable, structured outputs. Return ONLY valid JSON matching the schema.",
            },
            {
              role: "user",
              content: promptText({ hintText: inputPack.hintText, anchors: inputPack.anchors, budget }),
            },
          ]

          const result = await withTimeout(
            generateObject({
              model: resolved.language,
              temperature: 0.2,
              schema: Draft,
              messages,
            }),
            12_000,
          )
          return { specVersion: "capsule-assisted-cache/1.0", items: result.object.items }
        },
      })
      .then((value) => ({ ok: true as const, value }))
      .catch((error) => ({ ok: false as const, error }))

    const cacheHit = llm.ok ? llm.value.status === "hit" : false
    const cacheStatus = llm.ok ? llm.value.status : "miss"
    const cacheTier = llm.ok ? llm.value.tier : "none"

    const parsedCache = llm.ok ? CacheValue.safeParse(llm.value.value) : { success: false as const }
    const seedFailures =
      llm.ok && !parsedCache.success
        ? [
            {
              code: "schema_invalid",
              messageZh: cacheHit ? "缓存命中但输出不符合协议" : "模型输出不符合协议",
            },
          ]
        : []
    const rawItems = llm.ok && parsedCache.success ? parsedCache.data.items : []

    const verified = await CapsuleAssistedVerifier.verify({
      baseDir: base,
      budget,
      anchors,
      items: rawItems,
      failures: seedFailures,
    })

    const latencyMs = Math.max(0, Date.now() - start)
    const status = !llm.ok ? ("failed" as const) : verified.ok ? (verified.failures.length === 0 ? ("success" as const) : ("degraded" as const)) : ("degraded" as const)
    const reason = pickReason({ status, failures: verified.failures, llmError: llm.ok ? undefined : llm.error, cacheHit })
    const degradedReasonZh = status === "success" ? undefined : status === "failed" ? reason.zh : verified.degradedReasonZh ?? reason.zh ?? "已降级：部分条目无法核验"

    const capsule = CapsuleAssisted.parse({
      specVersion: "capsule-assisted/1.0",
      sessionId: input.sessionId,
      compactionId: input.compactionId,
      generatedAtUtc: now,
      model: { providerID: resolved.model.providerID, modelID: resolved.model.id },
      status,
      degradedReasonZh,
      budget,
      versions,
      anchors,
      items: verified.items,
      coverage: verified.coverage,
    })

    const view = render({
      status: capsule.status,
      degradedReasonZh: capsule.degradedReasonZh,
      items: capsule.items,
      anchors: capsule.anchors,
      coverage: capsule.coverage,
    })

    const jsonEntry = await writer.artifact({
      kind: "compaction-capsule-assisted",
      path: `compaction/${input.compactionId}/capsule.assisted.json`,
      data: stableJson(capsule),
    })
    const mdEntry = await writer.artifact({
      kind: "compaction-capsule-assisted-view",
      path: `compaction/${input.compactionId}/capsule.assisted.md`,
      data: view,
    })
    const verifyEntry = await writer.artifact({
      kind: "compaction-capsule-assisted-verify",
      path: `compaction/${input.compactionId}/capsule.assisted.verify.json`,
      data: stableJson(
        CapsuleAssistedVerify.parse({
          specVersion: "capsule-assisted-verify/1.0",
          sessionId: input.sessionId,
          compactionId: input.compactionId,
          verifiedAtUtc: new Date().toISOString(),
          ok: verified.ok,
          status,
          failures: verified.failures,
          coverage: verified.coverage,
          versions,
        }),
      ),
    })

    const payload = {
      status: capsule.status,
      degradedReasonZh: capsule.degradedReasonZh,
      items: capsule.items,
      anchors: capsule.anchors.map((a) => ({ path: a.path, sha256: a.sha256, kind: a.kind })),
    }

    const eventType =
      capsule.status === "success"
        ? "capsule.assisted.completed"
        : capsule.status === "failed"
          ? "capsule.assisted.failed"
          : "capsule.assisted.degraded"

    const severity = capsule.status === "success" ? "info" : capsule.status === "failed" ? "error" : "warn"

    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: input.sessionId,
      severity,
      actor: "session:capsule_assisted",
      type: eventType,
      summary:
        capsule.status === "success" ? "capsule assisted completed" : capsule.status === "failed" ? "capsule assisted failed" : "capsule assisted degraded",
      data: {
        compactionId: input.compactionId,
        parentId: input.parentId,
        status: capsule.status,
        degradedReasonZh: capsule.degradedReasonZh,
        reasonCode: capsule.status === "success" ? undefined : reason.code,
        latencyMs,
        cache: { key: cacheKey, status: cacheStatus, tier: cacheTier, hit: cacheHit },
        versions,
        budget,
        coverage: capsule.coverage,
        artifacts: {
          input: { path: inputEntry.path, sha256: inputEntry.sha256, kind: inputEntry.kind },
          capsule: { path: jsonEntry.path, sha256: jsonEntry.sha256, kind: jsonEntry.kind },
          view: { path: mdEntry.path, sha256: mdEntry.sha256, kind: mdEntry.kind },
          verify: { path: verifyEntry.path, sha256: verifyEntry.sha256, kind: verifyEntry.kind },
        },
        capsule: payload,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })

    const result: CapsuleAssistedRunResult = {
      status: capsule.status,
      verifyOk: verified.ok && verified.failures.length === 0,
      reasonCode: capsule.status === "success" ? "none" : reason.code ?? "unknown",
      degradedReasonZh: capsule.degradedReasonZh,
      coverage: capsule.coverage,
      viewText: view,
      artifacts: {
        input: { path: inputEntry.path, sha256: inputEntry.sha256, kind: inputEntry.kind },
        capsule: { path: jsonEntry.path, sha256: jsonEntry.sha256, kind: jsonEntry.kind },
        view: { path: mdEntry.path, sha256: mdEntry.sha256, kind: mdEntry.kind },
        verify: { path: verifyEntry.path, sha256: verifyEntry.sha256, kind: verifyEntry.kind },
      },
    }

    if (capsule.status !== "success") return result

    await ContextLedger.update({
      sessionId: input.sessionId,
      patch: {
        lastCapsuleAssisted: { path: jsonEntry.path, sha256: jsonEntry.sha256 },
        lastCapsuleAssistedRendered: { path: mdEntry.path, sha256: mdEntry.sha256 },
        lastCapsuleAssistedInput: { path: inputEntry.path, sha256: inputEntry.sha256 },
        lastCapsuleAssistedMeta: {
          ok: true,
          generatedAtUtc: now,
          model: `${resolved.model.providerID}/${resolved.model.id}`,
          compactionId: input.compactionId,
        },
      },
    })

    return result
  },
}
