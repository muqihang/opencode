import { EvidenceWriter } from "@/evidence/writer"
import { runRetrieval } from "@/retrieval/runner"
import type { ToolRequest, ToolRequestKind } from "@/protocol/llm-worker-result"

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

const joinPath = (...parts: string[]) => parts.join("/").replace(/\\/g, "/").replace(/\/+/g, "/")

const prefixPointers = (input: { sessionId: string; pointers: Pointers }) => {
  const root = joinPath(".opencode", "artifacts", input.sessionId)
  return {
    artifacts: input.pointers.artifacts.map((item) => ({ ...item, path: joinPath(root, item.path) })),
    topK: input.pointers.topK.map((item) => ({ ...item, path: joinPath(root, item.path) })),
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const allowKind = (kind: ToolRequestKind) => kind === "retrieval"

const summaryText = (status: "ok" | "rejected" | "degraded", kind: ToolRequestKind) => {
  if (status === "ok") return `tool broker ${kind} completed`
  if (status === "rejected") return `tool broker ${kind} rejected`
  return `tool broker ${kind} degraded`
}

export const runToolBroker = async (input: {
  sessionId: string
  messageId: string
  toolRequests: ToolRequest[]
  abort: AbortSignal
}): Promise<BrokerResult> => {
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
      kinds: input.toolRequests.map((request) => request.kind),
    },
    redaction: { applied: true, policyVersion: "v1" },
  })

  const results: RequestResult[] = []

  for (const request of input.toolRequests) {
    if (!allowKind(request.kind)) {
      const rejected: RequestResult = {
        kind: request.kind,
        status: "rejected",
        reason: "unsupported_kind_v0",
      }
      results.push(rejected)
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
      results.push(degraded)
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

    const pointers = prefixPointers({
      sessionId: input.sessionId,
      pointers: {
        artifacts: retrieval.value.evidencePointers.artifacts,
        topK: retrieval.value.evidencePointers.topK,
      },
    })

    const ok: RequestResult = {
      kind: request.kind,
      status: "ok",
      summary: retrieval.value.evidencePointers.summary,
      pointers,
    }
    results.push(ok)
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
        summary: ok.summary,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
  }

  const status = results.every((item) => item.status === "ok") ? "ok" : "degraded"
  return { status, results }
}
