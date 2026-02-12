import z from "zod"
import { Provider } from "@/provider/provider"
import { LlmWorkerRolePack } from "@/protocol/llm-worker-role-pack"
import { LlmWorkerResult } from "@/protocol/llm-worker-result"
import { withTimeout } from "@/util/timeout"
import { runStructured } from "../worker-llm"
import type { WorkerComputeInput, WorkerModel } from "../worker-spec"
import { buildWorkerSystemPrompt } from "./prompt-registry"

const text = z.string().min(1).max(400)

const Strategy = z
  .object({
    status: z.enum(["ok", "degraded"]),
    steps: z.array(text).min(1).max(6),
    risks: z.array(text).min(1).max(4),
    prerequisites: z.array(text).min(1).max(4),
    notes: z.array(text).max(5).optional(),
  })
  .strict()

type Strategy = z.infer<typeof Strategy>

type PlannerDeps = {
  run: typeof runStructured
  resolveModel: typeof Provider.defaultModel
}

const textLimit = (pack: LlmWorkerRolePack) => {
  const scaled = pack.budget.maxOutputTokens * 4
  const capped = Math.min(380, scaled)
  return Math.max(24, capped)
}

const noteLimit = (pack: LlmWorkerRolePack) => {
  const byToken = Math.floor(pack.budget.maxOutputTokens / 80)
  const capped = Math.min(10, byToken)
  return Math.max(7, capped)
}

const clean = (value: string, max: number) => {
  const trimmed = value.trim()
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max)
}

const textList = (items: string[], max: number, keep: number) =>
  items
    .map((item) => clean(item, max))
    .filter((item) => item.length > 0)
    .slice(0, keep)

const commands = [
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "node",
  "npx",
  "python",
  "pip",
  "git",
  "bash",
  "sh",
  "zsh",
  "make",
  "docker",
  "kubectl",
  "terraform",
  "cargo",
  "go",
  "java",
  "mvn",
  "gradle",
  "cd",
  "ls",
  "cat",
  "cp",
  "mv",
  "rm",
]

const commandPattern = new RegExp(`\\b(?:${commands.join("|")})\\b`, "i")
const commandLinePattern = new RegExp(`^\\s*(?:[$#>]\\s*)?(?:${commands.join("|")})\\b`, "i")
const imperativePattern = /\b(?:run|execute|launch|invoke|执行|运行|命令|终端)\b/i

const hasExecutable = (value: string) => {
  const normalized = value.trim()
  if (normalized.includes("```")) return true
  if (commandLinePattern.test(normalized)) return true
  if (imperativePattern.test(normalized) && commandPattern.test(normalized)) return true
  if (/\b(?:npm|pnpm|yarn|bun|python|git|docker|kubectl)\s+\S+/i.test(normalized)) return true
  return false
}

const hasUnsafe = (output: Strategy) =>
  [...output.steps, ...output.risks, ...output.prerequisites, ...(output.notes ?? [])].some((item) => hasExecutable(item))

const route = ["from_model=", "to_model=", "gate_reason="]

const safePlan = (input: { rolePack: LlmWorkerRolePack; reason?: string }): Strategy => {
  const max = textLimit(input.rolePack)
  const pointerText = clean(input.rolePack.planPointer, max)
  const pointerCount = input.rolePack.workingSet.pointers.length
  const reason = input.reason ? clean(`worker degraded: ${input.reason}`, max) : undefined

  return {
    status: reason ? "degraded" : "ok",
    steps: [
      clean(`Review target scope from ${pointerText}.`, max),
      clean("Sequence intended edits as plain-language strategy tasks.", max),
      clean("Define verification goals without listing executable commands.", max),
    ],
    risks: [
      clean("Evidence gaps can cause incorrect patch scope decisions.", max),
      clean("Policy constraints may block proposed edits if not rechecked.", max),
    ],
    prerequisites: [
      clean(`Confirm policy mode and budget constraints for ${pointerText}.`, max),
      clean(`Ensure ${String(pointerCount)} context pointers are loaded and readable.`, max),
    ],
    notes: reason ? [reason] : undefined,
  }
}

const toNotes = (input: { rolePack: LlmWorkerRolePack; output: Strategy }) => {
  const max = textLimit(input.rolePack)
  const limit = noteLimit(input.rolePack)
  const routeNotes = (input.output.notes ?? []).filter((item) => route.some((prefix) => item.includes(prefix))).slice(0, route.length)
  const steps = textList(input.output.steps, max, 3).map((item) => clean(`steps: ${item}`, max))
  const risks = textList(input.output.risks, max, 2).map((item) => clean(`risks: ${item}`, max))
  const prerequisites = textList(input.output.prerequisites, max, 2).map((item) => clean(`prerequisites: ${item}`, max))
  const messages = (input.output.notes ?? [])
    .filter((item) => !route.some((prefix) => item.includes(prefix)))
    .map((item) => clean(item, max))
    .filter((item) => item.length > 0)
    .slice(0, 2)
  const merged = [...steps, ...risks, ...prerequisites, ...routeNotes, ...messages]
  const limited = merged.slice(0, limit)
  if (limited.length > 0) return limited
  return toNotes({ rolePack: input.rolePack, output: safePlan({ rolePack: input.rolePack }) })
}

const fallback = (input: { rolePack: LlmWorkerRolePack; reason: string }) => {
  const plan = safePlan({ rolePack: input.rolePack, reason: input.reason })
  return LlmWorkerResult.parse({
    specVersion: "llm-worker-result/1.0",
    status: "degraded",
    notes: toNotes({ rolePack: input.rolePack, output: plan }),
  })
}

const resolve = async (input: { model?: WorkerModel; timeoutMs: number }, deps?: Partial<PlannerDeps>) => {
  if (input.model) return input.model
  const run = deps?.resolveModel ?? Provider.defaultModel
  const value = await withTimeout(
    run().catch(() => undefined),
    input.timeoutMs,
  ).catch(() => undefined)
  if (value) return value
  return { providerID: "opencode", modelID: "gpt-5-nano" }
}

export const patchPlanner = async (input: WorkerComputeInput, deps?: Partial<PlannerDeps>) => {
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
    role: "patch_planner",
    schema: Strategy,
    timeoutMs: rolePack.budget.timeoutMs,
    messages: [
      {
        role: "system",
        content: buildWorkerSystemPrompt("patch_planner"),
      },
      {
        role: "user",
        content: JSON.stringify(prompt),
      },
    ],
    degraded: (reason) => safePlan({ rolePack, reason }),
  })

  const parsed = Strategy.safeParse(generated.object)
  if (!parsed.success) return fallback({ rolePack, reason: "schema invalid" })
  if (hasUnsafe(parsed.data)) return fallback({ rolePack, reason: "executable output blocked" })

  const status = generated.status === "degraded" || parsed.data.status === "degraded" ? "degraded" : "ok"
  const notes = toNotes({ rolePack, output: parsed.data })

  return LlmWorkerResult.parse({
    specVersion: "llm-worker-result/1.0",
    status,
    notes,
  })
}
