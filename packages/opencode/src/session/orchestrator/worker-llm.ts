import { generateObject, type ModelMessage } from "ai"
import z from "zod"
import { Provider } from "@/provider/provider"
import { withTimeout } from "@/util/timeout"
import type { WorkerModel } from "./worker-spec"

type ResolveInput = {
  providerID: string
  modelID: string
  model?: WorkerModel
  role?: string
}

type ResolveDeps = {
  getSmallModel: typeof Provider.getSmallModel
  getModel: typeof Provider.getModel
}

export const resolveSmallModel = async (input: ResolveInput, deps?: Partial<ResolveDeps>) => {
  const getSmallModel = deps?.getSmallModel ?? Provider.getSmallModel
  const getModel = deps?.getModel ?? Provider.getModel

  if (input.model) return getModel(input.model.providerID, input.model.modelID)

  const small = await getSmallModel(input.providerID, input.role, input.modelID)
  if (small) return small

  return getModel(input.providerID, input.modelID)
}

export type WorkerLlmReason = "timeout" | "schema" | "error"

export type WorkerLlmRoute = {
  fromModel: string
  toModel: string
  gateReason: string
}

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
  getModel: typeof Provider.getModel
  getSmallModel: typeof Provider.getSmallModel
  getLanguage: typeof Provider.getLanguage
  generate: typeof generateObject
  timeout: typeof withTimeout
}

type RunInput<S extends z.ZodType> = {
  providerID: string
  modelID: string
  model?: WorkerModel
  role?: string
  schema: S
  messages: ModelMessage[]
  timeoutMs: number
  temperature?: number
  normalize?: (value: unknown) => z.input<S> | undefined
  degraded: (reason: WorkerLlmReason, route: WorkerLlmRoute) => z.output<S>
  deps?: Partial<RunDeps>
}

type CandidateKind = "route" | "primary" | "fallback"

type Candidate = {
  kind: CandidateKind
  model: Awaited<ReturnType<typeof Provider.getModel>>
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

const read = async <T>(promise: Promise<T>) =>
  promise
    .then((value) => ({ ok: true as const, value }))
    .catch((error) => ({ ok: false as const, error }))

const modelRef = (providerID: string, modelID: string) => `${providerID}/${modelID}`

const modelKey = (model: Awaited<ReturnType<typeof Provider.getModel>>) => `${model.providerID}/${model.id}`

const routeTags = (route: WorkerLlmRoute) => [
  `from_model=${route.fromModel}`,
  `to_model=${route.toModel}`,
  `gate_reason=${route.gateReason}`,
]

const routeNote = <S extends z.ZodType>(input: { schema: S; object: z.output<S>; route: WorkerLlmRoute }) => {
  const data = obj(input.object)
  if (!data) return input.object
  if (!Array.isArray(data["notes"])) return input.object

  const notes = data["notes"].filter((item) => typeof item === "string")
  const next = {
    ...data,
    notes: [...notes, ...routeTags(input.route)],
  }
  const parsed = input.schema.safeParse(next)
  if (!parsed.success) return input.object
  return parsed.data
}

const stage = (kind: CandidateKind) => {
  if (kind === "primary") return "upgrade"
  return "fallback"
}

const finalRoute = (input: {
  gate: WorkerLlmRoute
  current: Candidate
  reason: WorkerLlmReason
  requested: string
}) => {
  if (input.gate.gateReason === "routed") {
    return {
      fromModel: input.requested,
      toModel: modelKey(input.current.model),
      gateReason: `${input.reason}_degraded`,
    }
  }
  return {
    fromModel: input.gate.fromModel,
    toModel: input.gate.toModel,
    gateReason: `${input.reason}_degraded`,
  }
}

export const runStructured = async <S extends z.ZodType>(input: RunInput<S>): Promise<WorkerLlmResult<z.output<S>>> => {
  const deps = {
    resolveSmallModel,
    getModel: Provider.getModel,
    getSmallModel: Provider.getSmallModel,
    getLanguage: Provider.getLanguage,
    generate: generateObject,
    timeout: withTimeout,
    ...input.deps,
  }

  const requested = modelRef(input.providerID, input.modelID)
  const degrade = (fail: WorkerLlmReason, route: WorkerLlmRoute): WorkerLlmResult<z.output<S>> => {
    const raw = input.degraded(fail, route)
    return {
      status: "degraded",
      reason: fail,
      object: routeNote({ schema: input.schema, object: raw, route }),
    }
  }

  const first = await read(
    deps.timeout(
      deps.resolveSmallModel({
        providerID: input.providerID,
        modelID: input.modelID,
        model: input.model,
        role: input.role,
      }),
      input.timeoutMs,
    ),
  )

  if (!first.ok) {
    const fail = reason(first.error)
    return degrade(fail, {
      fromModel: requested,
      toModel: requested,
      gateReason: `${fail}_degraded`,
    })
  }

  const primary = await read(deps.getModel(input.providerID, input.modelID))
  const active = input.model?.modelID ?? input.modelID
  const fallback = await read(deps.getSmallModel(input.providerID, input.role, active))
  const seen = new Set<string>()
  const candidates = [
    { kind: "route" as const, model: first.value },
    primary.ok ? ({ kind: "primary" as const, model: primary.value } as const) : undefined,
    fallback.ok && fallback.value ? ({ kind: "fallback" as const, model: fallback.value } as const) : undefined,
  ]
    .filter((item) => item !== undefined)
    .filter((item) => {
      const key = modelKey(item.model)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }) as Candidate[]

  const start = candidates[0]
  if (!start) {
    return degrade("error", {
      fromModel: requested,
      toModel: requested,
      gateReason: "error_degraded",
    })
  }

  const run = async (state: { index: number; gate: WorkerLlmRoute }): Promise<WorkerLlmResult<z.output<S>>> => {
    const current = candidates[state.index]
    if (!current) return degrade("error", state.gate)

    const called = await read(
      deps.timeout(
        deps
          .getLanguage(current.model)
          .then((language) =>
            deps.generate({
              model: language,
              temperature: input.temperature,
              schema: input.schema,
              messages: input.messages,
            }),
          ),
        input.timeoutMs,
      ),
    )

    const normalized = called.ok
      ? (input.normalize ? input.normalize(called.value.object) : (called.value.object as z.input<S>))
      : undefined
    const parsed = called.ok && normalized !== undefined ? input.schema.safeParse(normalized) : undefined
    if (called.ok && parsed?.success) {
      return {
        status: "ok",
        object: parsed.data,
      }
    }

    const fail = called.ok ? "schema" : reason(called.error)
    const next = candidates[state.index + 1]
    if (!next) return degrade(fail, finalRoute({ gate: state.gate, current, reason: fail, requested }))

    return run({
      index: state.index + 1,
      gate: {
        fromModel: modelKey(current.model),
        toModel: modelKey(next.model),
        gateReason: `${fail}_${stage(next.kind)}`,
      },
    })
  }

  return run({
    index: 0,
    gate: {
      fromModel: requested,
      toModel: modelKey(start.model),
      gateReason: "routed",
    },
  })
}
