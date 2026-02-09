import { EvidenceWriter } from "@/evidence/writer"
import { runRetrieval } from "@/retrieval/runner"
import { stableJson } from "@/util/stable-json"
import type { ToolRequest, ToolRequestKind } from "@/protocol/llm-worker-result"
import type { OrchestratorPlan } from "@/protocol/orchestrator-plan"

type Pointer = { path: string; sha256: string; kind: string }

type TopPointer = { path: string; sha256: string; anchor?: Record<string, number> }

type Pointers = {
  artifacts: Pointer[]
  topK: TopPointer[]
}

type Summary = { total: number; code: number; workbench: number }

type RequestResult = {
  kind: ToolRequestKind
  status: "ok" | "rejected" | "degraded"
  reason?: string
  summary?: Summary
  pointers?: Pointers
}

type BrokerResult = {
  status: "ok" | "degraded"
  results: RequestResult[]
}

type ToolPolicy = OrchestratorPlan["toolPolicy"]

const joinPath = (...parts: string[]) => parts.join("/").replace(/\\/g, "/").replace(/\/+/g, "/")

const toArtifactPath = (input: { sessionId: string; path: string }) => {
  const normalized = joinPath(input.path)
  if (normalized.startsWith(".opencode/artifacts/")) return normalized
  return joinPath(".opencode", "artifacts", input.sessionId, normalized)
}

const prefixPointers = (input: { sessionId: string; pointers: Pointers }) => {
  return {
    artifacts: input.pointers.artifacts.map((item) => ({
      ...item,
      path: toArtifactPath({ sessionId: input.sessionId, path: item.path }),
    })),
    topK: input.pointers.topK.map((item) => ({
      ...item,
      path: toArtifactPath({ sessionId: input.sessionId, path: item.path }),
    })),
  }
}

const stripArtifactRoot = (input: { artifactRoot: string; pointerPath: string }) => {
  const root = joinPath(input.artifactRoot).replace(/\/+$/, "")
  const pointer = joinPath(input.pointerPath)
  const prefix = root ? `${root}/` : ""
  if (prefix && pointer.startsWith(prefix)) return pointer.slice(prefix.length)
  return pointer
}

const pointerSnapshot = (input: { sessionId: string; pointers?: Pointers }) => {
  if (!input.pointers) return { artifacts: [], topK: [] }
  return prefixPointers({ sessionId: input.sessionId, pointers: input.pointers })
}

const withPrefixedPointers = (input: { sessionId: string; result: RequestResult }): RequestResult => {
  if (!input.result.pointers) return input.result
  return {
    ...input.result,
    pointers: prefixPointers({ sessionId: input.sessionId, pointers: input.result.pointers }),
  }
}

const persistPointer = async (input: {
  writer: Awaited<ReturnType<typeof EvidenceWriter.open>>
  sessionId: string
  messageId: string
  cycle: number
  index: number
  result: RequestResult
}) => {
  const artifactRoot = joinPath(".opencode", "artifacts", input.sessionId)
  const snapshot = pointerSnapshot({ sessionId: input.sessionId, pointers: input.result.pointers })
  const name = `${String(input.index + 1).padStart(4, "0")}-${input.result.kind}.pointer.json`
  const entry = await input.writer.artifact({
    kind: "tool-broker-pointer",
    path: `tool-broker/${input.messageId}/${name}`,
    data: stableJson({
      specVersion: "tool-broker-pointer/1.0",
      sessionId: input.sessionId,
      messageId: input.messageId,
      cycle: input.cycle,
      kind: input.result.kind,
      status: input.result.status,
      reason: input.result.reason,
      summary: input.result.summary,
      pointers: snapshot,
      generatedAtUtc: new Date().toISOString(),
    }),
  })
  const path = stripArtifactRoot({ artifactRoot, pointerPath: entry.path })
  const pointers = input.result.pointers ?? { artifacts: [], topK: [] }
  return {
    ...input.result,
    pointers: {
      artifacts: [...pointers.artifacts, { path, sha256: entry.sha256, kind: entry.kind }],
      topK: pointers.topK,
    },
  } satisfies RequestResult
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const canRunKind = (kind: ToolRequestKind) => kind === "retrieval"

const allowKind = (input: { kind: ToolRequestKind; policy: ToolPolicy }) => input.policy.allowed.includes(input.kind)

const summaryText = (status: "ok" | "rejected" | "degraded", kind: ToolRequestKind) => {
  if (status === "ok") return `tool broker ${kind} completed`
  if (status === "rejected") return `tool broker ${kind} rejected`
  return `tool broker ${kind} degraded`
}

export const runToolBroker = async (input: {
  sessionId: string
  messageId: string
  toolRequests: ToolRequest[]
  toolPolicy: ToolPolicy
  cycle?: number
  abort: AbortSignal
}): Promise<BrokerResult> => {
  const cycle = input.cycle ?? 1
  const writer = await EvidenceWriter.open({ sessionId: input.sessionId })

  await writer.event({
    specVersion: "event/1.0",
    ts: new Date().toISOString(),
    sessionId: input.sessionId,
    severity: "info",
    actor: "orchestrator:tool_broker",
    type: "tool_broker.requested",
    summary: "tool broker requested",
    data: {
      messageId: input.messageId,
      count: input.toolRequests.length,
      cycle,
      bounceMax: input.toolPolicy.bounceMax,
      allowed: input.toolPolicy.allowed,
      kinds: input.toolRequests.map((request) => request.kind),
    },
    redaction: { applied: true, policyVersion: "v1" },
  })

  const bounced = cycle > input.toolPolicy.bounceMax
  if (bounced) {
    const rejected = input.toolRequests.map((request) => ({
      kind: request.kind,
      status: "rejected" as const,
      reason: "bounce_limit_v1",
    }))
    const pointerized = await Promise.all(
      rejected.map((item, index) =>
        persistPointer({
          writer,
          sessionId: input.sessionId,
          messageId: input.messageId,
          cycle,
          index,
          result: item,
        }),
      ),
    )
    await Promise.all(
      pointerized.map((item) =>
        writer.event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId: input.sessionId,
          severity: "warn",
          actor: "orchestrator:tool_broker",
          type: "tool_broker.rejected",
          summary: summaryText(item.status, item.kind),
          data: {
            messageId: input.messageId,
            cycle,
            bounceMax: input.toolPolicy.bounceMax,
            kind: item.kind,
            reason: item.reason,
          },
          redaction: { applied: true, policyVersion: "v1" },
        }),
      ),
    )
    const results = pointerized.map((item) =>
      withPrefixedPointers({ sessionId: input.sessionId, result: item }),
    )
    return {
      status: "degraded",
      results,
    }
  }

  const results: RequestResult[] = []

  for (const [index, request] of input.toolRequests.entries()) {
    if (!canRunKind(request.kind)) {
      const rejected: RequestResult = {
        kind: request.kind,
        status: "rejected",
        reason: "unsupported_kind_v0",
      }
      const pointerized = await persistPointer({
        writer,
        sessionId: input.sessionId,
        messageId: input.messageId,
        cycle,
        index,
        result: rejected,
      })
      results.push(pointerized)
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: input.sessionId,
        severity: "warn",
        actor: "orchestrator:tool_broker",
        type: "tool_broker.rejected",
        summary: summaryText(rejected.status, request.kind),
        data: {
          messageId: input.messageId,
          kind: request.kind,
          reason: rejected.reason,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })
      continue
    }

    if (!allowKind({ kind: request.kind, policy: input.toolPolicy })) {
      const rejected: RequestResult = {
        kind: request.kind,
        status: "rejected",
        reason: "policy_kind_not_allowed_v1",
      }
      const pointerized = await persistPointer({
        writer,
        sessionId: input.sessionId,
        messageId: input.messageId,
        cycle,
        index,
        result: rejected,
      })
      results.push(pointerized)
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: input.sessionId,
        severity: "warn",
        actor: "orchestrator:tool_broker",
        type: "tool_broker.rejected",
        summary: summaryText(rejected.status, request.kind),
        data: {
          messageId: input.messageId,
          kind: request.kind,
          allowed: input.toolPolicy.allowed,
          reason: rejected.reason,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })
      continue
    }

    const retrieval = await runRetrieval({
      sessionId: input.sessionId,
      messageId: input.messageId,
      intentText: request.input,
      abort: input.abort,
    })
      .then((value) => ({ ok: true as const, value }))
      .catch((error) => ({ ok: false as const, error }))

    if (!retrieval.ok) {
      const degraded: RequestResult = {
        kind: request.kind,
        status: "degraded",
        reason: errorText(retrieval.error),
      }
      const pointerized = await persistPointer({
        writer,
        sessionId: input.sessionId,
        messageId: input.messageId,
        cycle,
        index,
        result: degraded,
      })
      results.push(pointerized)
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: input.sessionId,
        severity: "warn",
        actor: "orchestrator:tool_broker",
        type: "tool_broker.degraded",
        summary: summaryText(degraded.status, request.kind),
        data: {
          messageId: input.messageId,
          kind: request.kind,
          reason: degraded.reason,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })
      continue
    }

    const pointers = {
      artifacts: retrieval.value.evidencePointers.artifacts,
      topK: retrieval.value.evidencePointers.topK,
    }

    const ok: RequestResult = {
      kind: request.kind,
      status: "ok",
      summary: retrieval.value.evidencePointers.summary,
      pointers,
    }
    const pointerized = await persistPointer({
      writer,
      sessionId: input.sessionId,
      messageId: input.messageId,
      cycle,
      index,
      result: ok,
    })
    results.push(pointerized)
    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: input.sessionId,
      severity: "info",
      actor: "orchestrator:tool_broker",
      type: "tool_broker.completed",
      summary: summaryText(ok.status, request.kind),
      data: {
        messageId: input.messageId,
        kind: request.kind,
        summary: pointerized.summary,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
  }

  const finalized = results.map((item) => withPrefixedPointers({ sessionId: input.sessionId, result: item }))
  const status = finalized.every((item) => item.status === "ok") ? "ok" : "degraded"
  return { status, results: finalized }
}
