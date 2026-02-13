import z from "zod"
import { Provider } from "@/provider/provider"
import { LlmWorkerRolePack } from "@/protocol/llm-worker-role-pack"
import { LlmWorkerResult } from "@/protocol/llm-worker-result"
import { withTimeout } from "@/util/timeout"
import { runStructured } from "../worker-llm"
import type { WorkerComputeInput, WorkerModel } from "../worker-spec"
import type { ToolRequest } from "@/protocol/llm-worker-result"
import { buildWorkerSystemPrompt } from "./prompt-registry"

const Retrieval = z
  .object({
    status: z.enum(["ok", "degraded"]),
    notes: z.array(z.string().min(1).max(400)).optional(),
    toolRequests: z
      .array(
        z
          .object({
            kind: z.enum(["retrieval", "verification"]),
            input: z.string().min(1),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()

type Retrieval = z.infer<typeof Retrieval>

type RetrievalDeps = {
  run: typeof runStructured
  resolveModel: typeof Provider.defaultModel
}

const retrieval = (input: string): ToolRequest => ({ kind: "retrieval", input })

const noteLimit = (pack: LlmWorkerRolePack) => {
  const byToken = Math.floor(pack.budget.maxOutputTokens / 128)
  const safe = byToken > 0 ? byToken : 1
  return Math.min(5, safe)
}

const textLimit = (pack: LlmWorkerRolePack) => {
  const scaled = pack.budget.maxOutputTokens * 4
  const capped = Math.min(380, scaled)
  return Math.max(24, capped)
}

const clean = (value: string, max: number) => {
  const text = value.trim()
  if (text.length <= max) return text
  return text.slice(0, max)
}

const obj = (value: unknown) => {
  if (!value) return undefined
  if (typeof value !== "object") return undefined
  if (Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

const txt = (value: unknown) => {
  if (typeof value !== "string") return ""
  return value
}

const list = (value: unknown) => {
  if (value === undefined) return [] as unknown[]
  if (Array.isArray(value)) return value
  return [value]
}

const statusMap = (value: unknown): Retrieval["status"] | undefined => {
  const key = txt(value).trim().toLowerCase()
  if (["ok", "success", "sufficient", "pass", "passed"].includes(key)) return "ok"
  if ([
    "degraded",
    "timeout",
    "cancelled",
    "insufficient",
    "conflict",
    "error",
    "failed",
    "fail",
    "needs_more",
    "needsmore",
    "needs-more",
    "need_more",
    "needmore",
    "retry",
  ].includes(key)) {
    return "degraded"
  }
}

const notesMap = (value: unknown, max: number) => {
  if (value === undefined) return [] as string[]
  const raw = list(value)
  const notes = raw
    .map((item) => clean(txt(item), max))
    .filter((item) => item.length > 0)
  if (raw.length > 0 && notes.length === 0) return
  return notes
}

const toolMap = (value: unknown, max: number): ToolRequest | undefined => {
  const data = obj(value)
  if (!data) return
  const kind = txt(data.kind ?? data.type ?? data.tool).trim().toLowerCase()
  if (!["retrieval", "retrieve", "search", "lookup"].includes(kind)) return
  const input = clean(txt(data.input ?? data.query ?? data.text ?? data.q), max)
  if (input.length === 0) return
  return { kind: "retrieval", input }
}

const toolsMap = (value: unknown, max: number) => {
  if (value === undefined) return [] as ToolRequest[]
  const raw = list(value)
  const tools = raw
    .map((item) => toolMap(item, max))
    .filter((item): item is ToolRequest => item !== undefined)
  if (raw.length > 0 && tools.length === 0) return
  return tools
}

const normalize = (value: unknown, rolePack: LlmWorkerRolePack): Retrieval | undefined => {
  const parsed = Retrieval.safeParse(value)
  if (parsed.success) return parsed.data

  const data = obj(value)
  if (!data) return

  const maxText = textLimit(rolePack)
  const status = statusMap(data.status)
  const notes = notesMap(data.notes ?? data.note, maxText)
  const tools = toolsMap(data.toolRequests ?? data.tool_requests ?? data.toolRequest, Math.min(1200, maxText * 2))

  if (!status) return
  if (notes === undefined) return
  if (tools === undefined) return

  const next = Retrieval.safeParse({
    status,
    notes: notes.length > 0 ? notes : undefined,
    toolRequests: tools.length > 0 ? tools : undefined,
  })
  if (!next.success) return
  return next.data
}

const bounded = (input: { rolePack: LlmWorkerRolePack; output: Retrieval }) => {
  const need = input.rolePack.workingSet.pointers.length === 0
  const maxTools = input.rolePack.budget.maxToolCalls
  const maxText = textLimit(input.rolePack)
  const maxNotes = noteLimit(input.rolePack)

  const notes = (input.output.notes ?? [])
    .map((item) => clean(item, maxText))
    .filter((item) => item.length > 0)
  const gate = ["from_model=", "to_model=", "gate_reason="]
  const head = notes.filter((item) => gate.some((prefix) => item.includes(prefix))).slice(0, gate.length)
  const tail = notes.filter((item) => !gate.some((prefix) => item.includes(prefix))).slice(0, Math.max(0, maxNotes - head.length))
  const merged = [...head, ...tail]

  const tools = (input.output.toolRequests ?? [])
    .filter((item) => item.kind === "retrieval")
    .map((item) => ({
      kind: "retrieval" as const,
      input: clean(item.input, Math.min(1200, maxText * 2)),
    }))
    .filter((item) => item.input.length > 0)

  const withNeed = need && !tools.some((item) => item.kind === "retrieval")
    ? [{ kind: "retrieval" as const, input: clean(input.rolePack.planPointer, Math.min(1200, maxText * 2)) }, ...tools]
    : tools

  return {
    status: input.output.status,
    notes: merged.length > 0 ? merged : undefined,
    toolRequests: withNeed.slice(0, maxTools),
  }
}

const fallback = (input: { rolePack: LlmWorkerRolePack; reason: string }) => {
  const maxText = textLimit(input.rolePack)
  const maxTools = input.rolePack.budget.maxToolCalls
  const tools = input.rolePack.workingSet.pointers.length === 0
    ? [retrieval(clean(input.rolePack.planPointer, Math.min(1200, maxText * 2)))]
    : []

  return LlmWorkerResult.parse({
    specVersion: "llm-worker-result/1.0",
    status: "degraded",
    notes: [clean(`worker degraded: ${input.reason}`, maxText)],
    toolRequests: tools.slice(0, maxTools),
  })
}

const resolve = async (input: { model?: WorkerModel; timeoutMs: number }, deps?: Partial<RetrievalDeps>) => {
  if (input.model) return input.model
  const run = deps?.resolveModel ?? Provider.defaultModel
  const value = await withTimeout(
    run().catch(() => undefined),
    input.timeoutMs,
  ).catch(() => undefined)
  if (value) return value
  return { providerID: "opencode", modelID: "gpt-5-nano" }
}

export const retrievalPlanner = async (input: WorkerComputeInput, deps?: Partial<RetrievalDeps>) => {
  const rolePack = input.rolePack
  const model = await resolve({ model: input.model, timeoutMs: rolePack.budget.timeoutMs }, deps)
  const runner = deps?.run ?? runStructured

  const prompt = {
    planPointer: rolePack.planPointer,
    policy: rolePack.policy,
    budget: rolePack.budget,
    pointers: rolePack.workingSet.pointers,
  }

  const generated = await runner({
    providerID: model.providerID,
    modelID: model.modelID,
    model: input.model,
    role: "retrieval_planner",
    schema: Retrieval,
    timeoutMs: rolePack.budget.timeoutMs,
    messages: [
      {
        role: "system",
        content: buildWorkerSystemPrompt("retrieval_planner"),
      },
      {
        role: "user",
        content: JSON.stringify(prompt),
      },
    ],
    degraded: (reason) => ({
      status: "degraded" as const,
      notes: [`worker degraded: ${reason}`],
      toolRequests: rolePack.workingSet.pointers.length === 0 ? [retrieval(rolePack.planPointer)] : [],
    }),
    normalize: (value) => normalize(value, rolePack),
  })

  const output = normalize(generated.object, rolePack)
  if (!output) return fallback({ rolePack, reason: "schema invalid" })

  const safe = bounded({ rolePack, output })
  if (generated.status === "degraded") {
    return LlmWorkerResult.parse({
      specVersion: "llm-worker-result/1.0",
      status: "degraded",
      notes: safe.notes,
      toolRequests: safe.toolRequests.length > 0 ? safe.toolRequests : undefined,
    })
  }

  return LlmWorkerResult.parse({
    specVersion: "llm-worker-result/1.0",
    status: safe.status,
    notes: safe.notes,
    toolRequests: safe.toolRequests.length > 0 ? safe.toolRequests : undefined,
  })
}
