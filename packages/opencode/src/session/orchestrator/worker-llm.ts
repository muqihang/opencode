import { generateObject, type ModelMessage } from "ai"
import z from "zod"
import { Provider } from "@/provider/provider"
import { withTimeout } from "@/util/timeout"
import type { WorkerModel } from "./worker-spec"

type ResolveInput = {
  providerID: string
  modelID: string
  model?: WorkerModel
}

type ResolveDeps = {
  getSmallModel: typeof Provider.getSmallModel
  getModel: typeof Provider.getModel
}

export const resolveSmallModel = async (input: ResolveInput, deps?: Partial<ResolveDeps>) => {
  const getSmallModel = deps?.getSmallModel ?? Provider.getSmallModel
  const getModel = deps?.getModel ?? Provider.getModel

  if (input.model) return getModel(input.model.providerID, input.model.modelID)

  const small = await getSmallModel(input.providerID)
  if (small) return small

  return getModel(input.providerID, input.modelID)
}

export type WorkerLlmReason = "timeout" | "schema" | "error"

export type WorkerLlmResult<T> =
  | {
      status: "ok"
      object: T
    }
  | {
      status: "degraded"
      reason: WorkerLlmReason
      object: T
    }

type RunDeps = {
  resolveSmallModel: typeof resolveSmallModel
  getLanguage: typeof Provider.getLanguage
  generate: typeof generateObject
  timeout: typeof withTimeout
}

type RunInput<S extends z.ZodType> = {
  providerID: string
  modelID: string
  model?: WorkerModel
  schema: S
  messages: ModelMessage[]
  timeoutMs: number
  temperature?: number
  degraded: (reason: WorkerLlmReason) => z.output<S>
  deps?: Partial<RunDeps>
}

const TimeoutNames = new Set(["AbortError", "TimeoutError", "AI_APICallTimeoutError", "AI_AbortError"])
const TimeoutCodes = new Set([
  "ABORT_ERR",
  "ERR_ABORTED",
  "ETIMEDOUT",
  "ERR_OPERATION_TIMED_OUT",
  "ECONNABORTED",
  "ETIME",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
])
const SchemaNames = new Set(["TypeValidationError", "NoObjectGeneratedError", "AI_TypeValidationError", "AI_NoObjectGeneratedError"])

const obj = (value: unknown) => {
  if (!value) return undefined
  if (typeof value !== "object") return undefined
  return value as Record<string, unknown>
}

const prop = (value: unknown, key: string) => {
  const data = obj(value)
  if (!data) return undefined
  return data[key]
}

const str = (value: unknown) => {
  if (typeof value !== "string") return ""
  return value
}

const chain = (value: unknown) => {
  const seen = new Set<unknown>()
  const walk = (item: unknown): unknown[] => {
    if (!item) return []
    if (seen.has(item)) return []
    seen.add(item)
    const cause = prop(item, "cause")
    if (!cause) return [item]
    return [item, ...walk(cause)]
  }
  return walk(value)
}

const isTimeout = (error: unknown) => {
  const nodes = chain(error)
  const hasName = nodes.some((item) => TimeoutNames.has(str(prop(item, "name"))))
  if (hasName) return true

  const hasCode = nodes.some((item) => TimeoutCodes.has(str(prop(item, "code"))))
  if (hasCode) return true

  return nodes.some((item) => {
    const text = str(prop(item, "message")).toLowerCase()
    if (text.includes("timed out")) return true
    if (text.includes("timeout")) return true
    if (text.includes("time out")) return true
    if (text.includes("aborted")) return true
    if (text.includes("abort")) return true
    return false
  })
}

const isSchema = (error: unknown) => {
  const nodes = chain(error)
  const hasName = nodes.some((item) => SchemaNames.has(str(prop(item, "name"))))
  if (hasName) return true

  return nodes.some((item) => {
    const text = str(prop(item, "message")).toLowerCase()
    if (text.includes("typevalidationerror")) return true
    if (text.includes("noobjectgeneratederror")) return true
    if (text.includes("schema") && text.includes("validation")) return true
    return false
  })
}

const reason = (error: unknown): WorkerLlmReason => {
  if (isSchema(error)) return "schema"
  if (isTimeout(error)) return "timeout"
  return "error"
}

export const runStructured = async <S extends z.ZodType>(input: RunInput<S>): Promise<WorkerLlmResult<z.output<S>>> => {
  const deps = {
    resolveSmallModel,
    getLanguage: Provider.getLanguage,
    generate: generateObject,
    timeout: withTimeout,
    ...input.deps,
  }

  const run = async () => {
    const model = await deps.resolveSmallModel({
      providerID: input.providerID,
      modelID: input.modelID,
      model: input.model,
    })
    const language = await deps.getLanguage(model)
    return deps.generate({
      model: language,
      temperature: input.temperature,
      schema: input.schema,
      messages: input.messages,
    })
  }

  const called = await deps
    .timeout(run(), input.timeoutMs)
    .then((value) => ({ ok: true as const, value }))
    .catch((error) => ({ ok: false as const, error }))

  if (!called.ok) {
    const fail = reason(called.error)
    return {
      status: "degraded",
      reason: fail,
      object: input.degraded(fail),
    }
  }

  const parsed = input.schema.safeParse(called.value.object)
  if (!parsed.success) {
    return {
      status: "degraded",
      reason: "schema",
      object: input.degraded("schema"),
    }
  }

  return {
    status: "ok",
    object: parsed.data,
  }
}
