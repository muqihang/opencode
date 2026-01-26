import z from "zod"
import { PositiveInt, Sha256, Ulid } from "./shared"

export const RoutingTier = z.enum(["plan", "limited", "full"])
export type RoutingTier = z.infer<typeof RoutingTier>

export const RoutingWorkerId = z.enum(["worker_a_repo", "worker_b_kb", "worker_c_graph"])
export type RoutingWorkerId = z.infer<typeof RoutingWorkerId>

const WorkerConfig = z
  .object({
    enabled: z.boolean(),
    topK: PositiveInt,
  })
  .strict()

const Repo = z
  .object({
    vcs: z.enum(["git", "none"]),
    head: z.string(),
    dirty: z.boolean(),
    diffFingerprint: z.string(),
  })
  .strict()
  .superRefine((repo, ctx) => {
    if (repo.vcs === "git") {
      if (!/^[0-9a-f]{40}$/i.test(repo.head)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "repo.head must be a 40-char git commit SHA when repo.vcs is git",
          path: ["head"],
        })
      }
    } else {
      if (repo.head !== "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "repo.head must be empty when repo.vcs is none",
          path: ["head"],
        })
      }
    }

    if (repo.dirty) {
      if (!Sha256.safeParse(repo.diffFingerprint).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "repo.diffFingerprint must be sha256 when repo.dirty is true",
          path: ["diffFingerprint"],
        })
      }
    } else {
      if (repo.diffFingerprint !== "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "repo.diffFingerprint must be empty when repo.dirty is false",
          path: ["diffFingerprint"],
        })
      }
    }
  })

export const RoutingRunRequest = z
  .object({
    specVersion: z.literal("routing-run-request/1.0"),
    routingRunId: Ulid,
    sessionId: z.string().min(1),
    messageId: z.string().min(1),
    tier: RoutingTier,
    intent: z
      .object({
        text: z.string().min(1),
        normalized: z.string().min(1),
        fingerprint: Sha256,
      })
      .strict(),
    project: z
      .object({
        projectId: z.string().min(1),
        worktreeRoot: z.string().min(1),
      })
      .strict(),
    repo: Repo,
    budgets: z
      .object({
        maxWallClockMs: PositiveInt,
        workerTimeoutMs: PositiveInt,
        topK: PositiveInt,
      })
      .strict()
      .superRefine((budgets, ctx) => {
        if (budgets.workerTimeoutMs > budgets.maxWallClockMs) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "budgets.workerTimeoutMs must be <= budgets.maxWallClockMs",
            path: ["workerTimeoutMs"],
          })
        }
      }),
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
  .superRefine((req, ctx) => {
    // Keep a single "topK" knob: worker topK must not exceed request budgets.
    for (const workerId of ["worker_a_repo", "worker_b_kb", "worker_c_graph"] as const) {
      const worker = req.workers[workerId]
      if (worker.topK > req.budgets.topK) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `workers.${workerId}.topK must be <= budgets.topK`,
          path: ["workers", workerId, "topK"],
        })
      }
    }

    // Make sure IDs are non-empty (already enforced) and routingRunId is ULID.
    // Keep a guard that routingRunId is "truthy" for older runtimes.
    if (!req.routingRunId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "routingRunId must be present",
        path: ["routingRunId"],
      })
    }
  })

export type RoutingRunRequest = z.infer<typeof RoutingRunRequest>
