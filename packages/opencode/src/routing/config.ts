import z from "zod"
import { PositiveInt } from "@/protocol/shared"
import { mergeDeep } from "remeda"

const WorkerConfig = z
  .object({
    enabled: z.boolean(),
    topK: PositiveInt,
  })
  .strict()

const WorkerOverride = z
  .object({
    enabled: z.boolean().optional(),
    topK: PositiveInt.optional(),
  })
  .strict()

export const RoutingConfig = z
  .object({
    enabled: z.boolean(),
    maxRoutingRunsInFlight: PositiveInt,
    maxWorkersInFlight: PositiveInt,
    maxWallClockMs: PositiveInt,
    workerTimeoutMs: PositiveInt,
    topK: PositiveInt,
    workers: z
      .object({
        worker_a_repo: WorkerConfig,
        worker_b_kb: WorkerConfig,
        worker_c_graph: WorkerConfig,
      })
      .strict(),
    versions: z
      .object({
        routingTemplate: z.string().min(1),
        capsuleSchema: z.string().min(1),
        workerSchemas: z.string().min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.workerTimeoutMs > config.maxWallClockMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "workerTimeoutMs must be <= maxWallClockMs",
        path: ["workerTimeoutMs"],
      })
    }
    for (const key of ["worker_a_repo", "worker_b_kb", "worker_c_graph"] as const) {
      const worker = config.workers[key]
      if (worker.topK > config.topK) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `workers.${key}.topK must be <= topK`,
          path: ["workers", key, "topK"],
        })
      }
    }
  })

export type RoutingConfig = z.infer<typeof RoutingConfig>

export const RoutingConfigOverride = z
  .object({
    enabled: z.boolean().optional(),
    maxRoutingRunsInFlight: PositiveInt.optional(),
    maxWorkersInFlight: PositiveInt.optional(),
    maxWallClockMs: PositiveInt.optional(),
    workerTimeoutMs: PositiveInt.optional(),
    topK: PositiveInt.optional(),
    workers: z
      .object({
        worker_a_repo: WorkerOverride.optional(),
        worker_b_kb: WorkerOverride.optional(),
        worker_c_graph: WorkerOverride.optional(),
      })
      .strict()
      .optional(),
    versions: z
      .object({
        routingTemplate: z.string().min(1).optional(),
        capsuleSchema: z.string().min(1).optional(),
        workerSchemas: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export type RoutingConfigOverride = z.infer<typeof RoutingConfigOverride>

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = RoutingConfig.parse({
  enabled: true,
  maxRoutingRunsInFlight: 1,
  maxWorkersInFlight: 3,
  maxWallClockMs: 15000,
  workerTimeoutMs: 8000,
  topK: 20,
  workers: {
    worker_a_repo: { enabled: true, topK: 20 },
    worker_b_kb: { enabled: true, topK: 20 },
    worker_c_graph: { enabled: true, topK: 20 },
  },
  versions: {
    routingTemplate: "routing-template/1.0",
    capsuleSchema: "routing-capsule/1.0",
    workerSchemas: "routing-worker-result/1.0",
  },
})

export const resolveRoutingConfig = (input?: RoutingConfigOverride): RoutingConfig => {
  const merged = mergeDeep(DEFAULT_ROUTING_CONFIG, input ?? {})
  return RoutingConfig.parse(merged)
}
