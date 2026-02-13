import z from "zod"

export const ToolRequestKind = z.enum(["retrieval", "verification"])
export type ToolRequestKind = z.infer<typeof ToolRequestKind>

export const ToolRequest = z
  .object({
    kind: ToolRequestKind,
    input: z.string().min(1),
  })
  .strict()

export type ToolRequest = z.infer<typeof ToolRequest>

export const ToolRequestQueryTypeV2 = z.enum(["symbol", "path", "text"])
export type ToolRequestQueryTypeV2 = z.infer<typeof ToolRequestQueryTypeV2>

export const ToolRequestQueryV2 = z
  .object({
    id: z.string().min(1),
    type: ToolRequestQueryTypeV2,
    query: z.string().min(1),
    pathHints: z.array(z.string().min(1)).optional(),
    why: z.string().min(1).optional(),
  })
  .strict()

export type ToolRequestQueryV2 = z.infer<typeof ToolRequestQueryV2>

export const ToolRequestFiltersV2 = z
  .object({
    extensions: z.array(z.string().min(1)).optional(),
    exclude: z.array(z.string().min(1)).optional(),
  })
  .strict()

export type ToolRequestFiltersV2 = z.infer<typeof ToolRequestFiltersV2>

export const ToolRequestV2 = z
  .object({
    specVersion: z.literal("tool-request/2.0"),
    kind: ToolRequestKind,
    queries: z.array(ToolRequestQueryV2).min(1),
    filters: ToolRequestFiltersV2,
    expectedEvidence: z.array(z.string().min(1)),
    dedupeKey: z.string().min(1),
  })
  .strict()

export type ToolRequestV2 = z.infer<typeof ToolRequestV2>

const hashText = (input: string) => {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(input)
  return hash.digest("hex")
}

const defaultFiltersV2 = {
  extensions: [".ts", ".md"],
  exclude: [".opencode/**", ".git/**"],
}

export const toolRequestV2FromV1 = (input: ToolRequest): ToolRequestV2 =>
  ToolRequestV2.parse({
    specVersion: "tool-request/2.0",
    kind: input.kind,
    queries: [{ id: "q1", type: "text", query: input.input }],
    filters: {
      extensions: [...defaultFiltersV2.extensions],
      exclude: [...defaultFiltersV2.exclude],
    },
    expectedEvidence: [],
    dedupeKey: hashText(`${input.kind}:${input.input}`),
  })

export const toolRequestV1FromV2 = (input: ToolRequestV2): ToolRequest => {
  const head = input.queries.find((item) => item.query.trim().length > 0)
  const query = head?.query ?? input.dedupeKey
  return ToolRequest.parse({ kind: input.kind, input: query })
}

export const toolRequestV1Compatible = (input: ToolRequest | ToolRequestV2): ToolRequest => {
  const parsedV1 = ToolRequest.safeParse(input)
  if (parsedV1.success) return parsedV1.data

  const parsedV2 = ToolRequestV2.safeParse(input)
  if (parsedV2.success) return toolRequestV1FromV2(parsedV2.data)

  return ToolRequest.parse(input)
}

export const LlmWorkerStatus = z.enum(["ok", "degraded", "timeout", "cancelled"])
export type LlmWorkerStatus = z.infer<typeof LlmWorkerStatus>

const Note = z.string().min(1).max(400)

export const LlmWorkerResult = z
  .object({
    specVersion: z.literal("llm-worker-result/1.0"),
    status: LlmWorkerStatus,
    toolRequests: z.array(ToolRequest).optional(),
    notes: z.array(Note).optional(),
  })
  .strict()

export type LlmWorkerResult = z.infer<typeof LlmWorkerResult>

export const CriticVerdictStatusV2 = z.enum(["sufficient", "insufficient", "conflict", "degraded"])
export type CriticVerdictStatusV2 = z.infer<typeof CriticVerdictStatusV2>

export const CriticCoverageV2 = z
  .object({
    requirementId: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)),
    pass: z.boolean(),
  })
  .strict()

export type CriticCoverageV2 = z.infer<typeof CriticCoverageV2>

export const CriticMissingV2 = z
  .object({
    requirementId: z.string().min(1),
    reason: z.string().min(1),
    suggestedQuery: z.string().min(1).optional(),
  })
  .strict()

export type CriticMissingV2 = z.infer<typeof CriticMissingV2>

export const CriticConflictV2 = z
  .object({
    left: z.string().min(1),
    right: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict()

export type CriticConflictV2 = z.infer<typeof CriticConflictV2>

export const CriticRetryV2 = z
  .object({
    allowed: z.boolean(),
    newQueries: z.array(z.string().min(1)),
    stopReason: z.string().min(1),
  })
  .strict()

export type CriticRetryV2 = z.infer<typeof CriticRetryV2>

export const CriticVerdictV2 = z
  .object({
    specVersion: z.literal("critic-verdict/2.0"),
    status: CriticVerdictStatusV2,
    coverage: z.array(CriticCoverageV2),
    missing: z.array(CriticMissingV2),
    conflicts: z.array(CriticConflictV2),
    confidence: z.number().min(0).max(1),
    retry: CriticRetryV2,
  })
  .strict()

export type CriticVerdictV2 = z.infer<typeof CriticVerdictV2>

const missingNote = (input: CriticMissingV2) => {
  const base = `${input.requirementId}: ${input.reason}`
  if (!input.suggestedQuery) return base
  return `${base} (query: ${input.suggestedQuery})`
}

const conflictNote = (input: CriticConflictV2) => `${input.left}<->${input.right}: ${input.reason}`

export const criticVerdictV1FromV2 = (input: CriticVerdictV2): LlmWorkerResult => {
  const status = input.status === "sufficient" ? "ok" : "degraded"
  const notes = [
    `retry:${input.retry.stopReason}`,
    ...input.missing.map((item) => missingNote(item)),
    ...input.conflicts.map((item) => conflictNote(item)),
  ]
  const fallback = input.status === "sufficient" ? [] : [`verdict degraded: ${input.status}`]
  const merged = notes.length > 0 ? notes : fallback
  const queries = input.retry.allowed ? input.retry.newQueries : []
  const tools = queries.map((query) => ToolRequest.parse({ kind: "retrieval", input: query }))

  return LlmWorkerResult.parse({
    specVersion: "llm-worker-result/1.0",
    status,
    notes: merged.length > 0 ? merged : undefined,
    toolRequests: tools.length > 0 ? tools : undefined,
  })
}

export const criticVerdictV2FromV1 = (input: LlmWorkerResult): CriticVerdictV2 => {
  const status = input.status === "ok" ? "sufficient" : "degraded"
  const queries = (input.toolRequests ?? []).map((item) => item.input)
  const missing = status === "sufficient"
    ? []
    : (input.notes ?? []).map((reason, index) => ({
        requirementId: `v1_note_${index + 1}`,
        reason,
      }))

  return CriticVerdictV2.parse({
    specVersion: "critic-verdict/2.0",
    status,
    coverage: [],
    missing,
    conflicts: [],
    confidence: status === "sufficient" ? 1 : 0.25,
    retry: {
      allowed: queries.length > 0,
      newQueries: queries,
      stopReason: status === "sufficient" ? "complete" : "worker_degraded",
    },
  })
}
