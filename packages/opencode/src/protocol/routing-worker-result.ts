import z from "zod"
import { IsoDateTimeUtc, NonNegativeInt, Sha256 } from "./shared"
import { RoutingWorkerId } from "./routing-run-request"

export const RoutingWorkerStatus = z.enum(["ok", "degraded", "unavailable", "error"])
export type RoutingWorkerStatus = z.infer<typeof RoutingWorkerStatus>

export const RoutingCacheScope = z.enum(["project", "worktree", "session"])
export type RoutingCacheScope = z.infer<typeof RoutingCacheScope>

export const RoutingCacheReason = z.enum(["exact_match", "repo_changed", "index_changed", "ttl_expired", "disabled"])
export type RoutingCacheReason = z.infer<typeof RoutingCacheReason>

export const RoutingPointerKind = z.enum(["artifact", "file", "kb_chunk", "neo4j_query"])
export type RoutingPointerKind = z.infer<typeof RoutingPointerKind>

const Pointer = z
  .object({
    kind: RoutingPointerKind,
    ref: z.string().min(1),
    sha256: Sha256.optional(),
    label: z.string().min(1).optional(),
  })
  .strict()

const Capsule = z
  .object({
    handoff: z.string().min(1),
    pointers: Pointer.array(),
    openQuestions: z.string().array(),
  })
  .strict()

const ErrorItem = z
  .object({
    message: z.string(),
    code: z.string().optional(),
    data: z.unknown().optional(),
  })
  .strict()

// Worker A: Repo/LSP result
const WorkerAResult = z
  .object({
    kind: z.literal("repo-lsp"),
    files: z
      .object({
        path: z.string().min(1),
        reason: z.string().min(1),
        score: z.number(),
        symbols: z
          .object({
            name: z.string().min(1),
            kind: z.string().min(1),
            location: z
              .object({
                line: z.number().int().positive(),
                col: z.number().int().positive(),
              })
              .strict(),
          })
          .strict()
          .array()
          .optional(),
      })
      .strict()
      .array(),
    snippets: z
      .object({
        path: z.string().min(1),
        sha256: Sha256,
        why: z.string().min(1),
      })
      .strict()
      .array()
      .optional(),
  })
  .strict()

// Worker B: KB/RAG result
const WorkerBResult = z
  .object({
    kind: z.literal("kb-rag"),
    hits: z
      .object({
        id: z.string().min(1),
        source: z.enum(["pgroonga", "qdrant", "rrf"]),
        score: z.number(),
        citation: z
          .object({
            vaultPath: z.string().min(1),
            relativePath: z.string().min(1),
            startLine: z.number().int().positive(),
            endLine: z.number().int().positive(),
            contentHash: z.string().min(1),
          })
          .strict(),
      })
      .strict()
      .array(),
    queries: z
      .object({
        engine: z.enum(["pgroonga", "qdrant", "rrf"]),
        q: z.string().min(1),
        topK: z.number().int().positive(),
      })
      .strict()
      .array(),
  })
  .strict()

// Worker C: Graph/Impact result
const WorkerCResult = z
  .object({
    kind: z.literal("graph-impact"),
    seeds: z.string().min(1).array(),
    nodes: z
      .object({
        id: z.string().min(1),
        score: z.number(),
        why: z.string().min(1),
      })
      .strict()
      .array(),
    edges: z
      .object({
        from: z.string().min(1),
        to: z.string().min(1),
        type: z.string().min(1),
      })
      .strict()
      .array(),
    queries: z
      .object({
        engine: z.literal("neo4j"),
        cypherId: z.string().min(1),
        params: z.record(z.string(), z.unknown()),
      })
      .strict()
      .array(),
  })
  .strict()

const WorkerResult = z.discriminatedUnion("kind", [WorkerAResult, WorkerBResult, WorkerCResult])

export const RoutingWorkerResult = z
  .object({
    specVersion: z.literal("routing-worker-result/1.0"),
    routingRunId: z.string().min(1),
    sessionId: z.string().min(1),
    workerId: RoutingWorkerId,
    status: RoutingWorkerStatus,
    cache: z
      .object({
        hit: z.boolean(),
        key: Sha256,
        scope: RoutingCacheScope,
        reason: RoutingCacheReason,
      })
      .strict(),
    timing: z
      .object({
        startedAtUtc: IsoDateTimeUtc,
        endedAtUtc: IsoDateTimeUtc,
        durationMs: NonNegativeInt,
      })
      .strict(),
    inputs: z
      .object({
        intentFingerprint: Sha256,
        repoFingerprint: Sha256,
        configFingerprint: Sha256,
      })
      .strict(),
    result: WorkerResult,
    capsule: Capsule,
    errors: ErrorItem.array(),
  })
  .strict()
  .superRefine((x, ctx) => {
    const expectedKind: Record<z.infer<typeof RoutingWorkerId>, z.infer<typeof WorkerResult>["kind"]> = {
      worker_a_repo: "repo-lsp",
      worker_b_kb: "kb-rag",
      worker_c_graph: "graph-impact",
    }
    if (x.result.kind !== expectedKind[x.workerId]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `result.kind must match workerId (${expectedKind[x.workerId]})`,
        path: ["result", "kind"],
      })
    }
  })

export type RoutingWorkerResult = z.infer<typeof RoutingWorkerResult>

