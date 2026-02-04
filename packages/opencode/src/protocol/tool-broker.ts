import z from "zod"
import { ToolRequest } from "./llm-worker-result"

export const ToolBroker = z
  .object({
    specVersion: z.literal("tool-broker/1.0"),
    toolRequests: z.array(ToolRequest),
  })
  .strict()

export type ToolBroker = z.infer<typeof ToolBroker>
