import z from "zod"
import { Provider } from "@/provider/provider"
import { LlmWorkerRolePack } from "@/protocol/llm-worker-role-pack"
import { LlmWorkerResult } from "@/protocol/llm-worker-result"
import { withTimeout } from "@/util/timeout"
import { runStructured } from "../worker-llm"
import type { WorkerComputeInput, WorkerModel } from "../worker-spec"

const Critic = z
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

type Critic = z.infer<typeof Critic>

type CriticDeps = {
  run: typeof runStructured
  resolveModel: typeof Provider.defaultModel
}

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

const normalizeKind = (kind: "retrieval" | "verification") => {
  if (kind === "verification") return "retrieval" as const
  return kind
}

const bounded = (input: { rolePack: LlmWorkerRolePack; output: Critic }) => {
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
    .map((item) => ({ kind: normalizeKind(item.kind), input: clean(item.input, Math.min(1200, maxText * 2)) }))
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
    ? [{ kind: "retrieval" as const, input: clean(input.rolePack.planPointer, Math.min(1200, maxText * 2)) }]
    : []

  return LlmWorkerResult.parse({
    specVersion: "llm-worker-result/1.0",
    status: "degraded",
    notes: [clean(`worker degraded: ${input.reason}`, maxText)],
    toolRequests: tools.slice(0, maxTools),
  })
}

const resolve = async (input: { model?: WorkerModel; timeoutMs: number }, deps?: Partial<CriticDeps>) => {
  if (input.model) return input.model
  const run = deps?.resolveModel ?? Provider.defaultModel
  const value = await withTimeout(
    run().catch(() => undefined),
    input.timeoutMs,
  ).catch(() => undefined)
  if (value) return value
  return { providerID: "opencode", modelID: "gpt-5-nano" }
}

export const evidenceCritic = async (input: WorkerComputeInput, deps?: Partial<CriticDeps>) => {
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
    role: "evidence_critic",
    schema: Critic,
    timeoutMs: rolePack.budget.timeoutMs,
    messages: [
      {
        role: "system",
        content:
          "You are evidence_critic. Return JSON only. Keep output concise. If evidence is missing, request retrieval.",
      },
      {
        role: "user",
        content: JSON.stringify(prompt),
      },
    ],
    degraded: (reason) => ({
      status: "degraded",
      notes: [`worker degraded: ${reason}`],
      toolRequests: rolePack.workingSet.pointers.length === 0 ? [{ kind: "retrieval", input: rolePack.planPointer }] : [],
    }),
  })

  const parsed = Critic.safeParse(generated.object)
  if (!parsed.success) return fallback({ rolePack, reason: "schema invalid" })

  const safe = bounded({ rolePack, output: parsed.data })
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
