import z from "zod"
import { RoutingWorkerResult } from "@/protocol/routing-worker-result"

const Input = z
  .object({
    root: z.string().min(1),
    topK: z.number().int().positive(),
    intent: z.string().min(1),
    signal: z.instanceof(AbortSignal).optional(),
  })
  .strict()

type Result = z.infer<typeof RoutingWorkerResult>["result"]
type Capsule = z.infer<typeof RoutingWorkerResult>["capsule"]
type ErrorItem = z.infer<typeof RoutingWorkerResult>["errors"][number]

const baseCapsule = (handoff: string): Capsule => ({
  handoff,
  pointers: [],
  openQuestions: [],
})

const unavailable = (message: string) => {
  const result: Result = {
    kind: "kb-rag",
    hits: [],
    queries: [],
  }
  const errors: ErrorItem[] = [
    {
      message,
      code: "kb_unavailable",
    },
  ]
  return {
    status: "unavailable" as const,
    result,
    capsule: baseCapsule(message),
    errors,
  }
}

export const WorkerB = {
  async run(input: z.infer<typeof Input>) {
    const data = Input.parse(input)
    if (data.signal?.aborted) {
      return unavailable("worker aborted")
    }
    return unavailable("kb not configured")
  },
}
