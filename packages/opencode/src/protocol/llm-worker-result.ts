import z from "zod"

export const ToolRequestKind = z.enum(["retrieval", "verification"])
export type ToolRequestKind = z.infer<typeof ToolRequestKind>

export const ToolRequest = z
  .object({
    kind: ToolRequestKind,
    input: z.string().min(1),
  })
  .strict()

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
