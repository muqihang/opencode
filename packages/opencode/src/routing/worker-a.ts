import z from "zod"
import { FileIgnore } from "@/file/ignore"
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

const empty = (status: "degraded" | "unavailable" | "error", message: string) => {
  const result: Result = {
    kind: "repo-lsp",
    files: [],
  }
  const errors: ErrorItem[] = [
    {
      message,
    },
  ]
  return {
    status,
    result,
    capsule: baseCapsule(message),
    errors,
  }
}

export const WorkerA = {
  async run(input: z.infer<typeof Input>) {
    const data = Input.parse(input)
    if (data.signal?.aborted) {
      return empty("error", "worker aborted")
    }

    const glob = new Bun.Glob("**/*")
    const files: string[] = []
    for await (const item of glob.scan({
      cwd: data.root,
      onlyFiles: true,
      followSymlinks: false,
    })) {
      if (data.signal?.aborted) {
        return empty("error", "worker aborted")
      }
      if (FileIgnore.match(item)) continue
      files.push(item)
    }

    const ordered = files.toSorted()
    const picked = ordered.slice(0, data.topK)
    const entries = picked.map((item, index) => ({
      path: item,
      reason: "candidate",
      score: data.topK - index,
    }))

    const result: Result = {
      kind: "repo-lsp",
      files: entries,
    }

    return {
      status: "ok" as const,
      result,
      capsule: baseCapsule("repo scan complete"),
      errors: [],
    }
  },
}
