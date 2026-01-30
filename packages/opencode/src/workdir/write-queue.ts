import { EventV1 } from "@/protocol/event"

type Writer = {
  event: (input: EventV1) => Promise<void>
}

type Entry = {
  sessionId: string
  targetDir: string
  reason: string
  intentFiles: string[]
  writer: Writer
  work: () => Promise<void>
}

const queues = new Map<string, Promise<void>>()
const counts = new Map<string, number>()

function inc(key: string) {
  const value = (counts.get(key) ?? 0) + 1
  counts.set(key, value)
  return value
}

function dec(key: string) {
  const value = (counts.get(key) ?? 1) - 1
  if (value <= 0) {
    counts.delete(key)
    return 0
  }
  counts.set(key, value)
  return value
}

async function emit(input: {
  entry: Entry
  type: "workdir.write_queued" | "workdir.write_started" | "workdir.write_completed"
  queueLength: number
  status?: "ok" | "error"
}) {
  await input.entry.writer.event({
    specVersion: "event/1.0",
    ts: new Date().toISOString(),
    sessionId: input.entry.sessionId,
    severity: "info",
    actor: "workdir:queue",
    type: input.type,
    summary: input.type.replace(/_/g, " "),
    data: {
      targetDir: input.entry.targetDir,
      reason: input.entry.reason,
      intentFiles: input.entry.intentFiles,
      queueLength: input.queueLength,
      status: input.status,
    },
    redaction: { applied: true, policyVersion: "v1" },
  })
}

export const WorkdirWriteQueue = {
  async run(input: Entry) {
    const key = input.targetDir
    const queued = inc(key)
    await emit({ entry: input, type: "workdir.write_queued", queueLength: queued })

    const prev = queues.get(key) ?? Promise.resolve()
    const next = prev.then(async () => {
      await emit({ entry: input, type: "workdir.write_started", queueLength: counts.get(key) ?? 0 })
      const done = async (status: "ok" | "error") => {
        const remaining = dec(key)
        await emit({
          entry: input,
          type: "workdir.write_completed",
          queueLength: remaining,
          status,
        })
      }
      return input.work().then(
        async () => {
          await done("ok")
        },
        async (error) => {
          await done("error")
          throw error
        },
      )
    })
    queues.set(key, next)
    void next.finally(() => {
      if (queues.get(key) === next) queues.delete(key)
    })
    return next
  },
}
