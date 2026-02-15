import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { stableJson } from "@/util/stable-json"

const Msg = z
  .object({
    cycle: z.number().int().nonnegative(),
    stopped: z.boolean(),
    degraded: z.array(z.string().min(1)),
    updatedAtUtc: z.string().min(1),
  })
  .strict()

const Store = z
  .object({
    specVersion: z.literal("orchestrator-progress/1.0"),
    sessionId: z.string().min(1),
    version: z.number().int().nonnegative(),
    updatedAtUtc: z.string().min(1),
    messages: z.record(z.string().min(1), Msg),
  })
  .strict()

const ReserveInput = z
  .object({
    sessionId: z.string().min(1),
    messageId: z.string().min(1),
    worker: z.boolean(),
  })
  .strict()

const UpdateInput = z
  .object({
    sessionId: z.string().min(1),
    messageId: z.string().min(1),
    stop: z.boolean().optional(),
    degraded: z.string().min(1).optional(),
  })
  .strict()

type Store = z.infer<typeof Store>
type Msg = z.infer<typeof Msg>

const baseDir = () => (Instance.worktree === "/" ? Instance.directory : Instance.worktree)

const storePath = (sessionId: string) =>
  path.join(baseDir(), ".opencode", "context", sessionId, "orchestrator-progress.json")

const now = () => new Date().toISOString()

const emptyMsg = (): Msg =>
  Msg.parse({
    cycle: 0,
    stopped: false,
    degraded: [],
    updatedAtUtc: now(),
  })

const emptyStore = (sessionId: string): Store =>
  Store.parse({
    specVersion: "orchestrator-progress/1.0",
    sessionId,
    version: 0,
    updatedAtUtc: now(),
    messages: {},
  })

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function readStore(sessionId: string): Promise<Store> {
  const file = storePath(sessionId)
  const text = await Bun.file(file).text().catch(() => "")
  if (!text) return emptyStore(sessionId)

  const data = (() => {
    try {
      return JSON.parse(text) as unknown
    } catch {
      return undefined
    }
  })()
  if (!data) return emptyStore(sessionId)

  const parsed = Store.safeParse(data)
  if (!parsed.success) return emptyStore(sessionId)
  if (parsed.data.sessionId !== sessionId) return emptyStore(sessionId)
  return parsed.data
}

async function writeStore(input: { file: string; data: Store }) {
  await fs.mkdir(path.dirname(input.file), { recursive: true })
  const tmp = `${input.file}.${Identifier.ascending("tool")}.tmp`
  await Bun.write(tmp, stableJson(input.data))
  await fs.rename(tmp, input.file)
}

async function withLock<T>(input: { sessionId: string; fn: () => Promise<T> }) {
  const file = storePath(input.sessionId)
  const lock = `${file}.lock`
  const spins = 200
  await fs.mkdir(path.dirname(lock), { recursive: true })

  for (const attempt of Array.from({ length: spins }).keys()) {
    const made = await fs.mkdir(lock).then(
      () => true,
      () => false,
    )
    if (made) {
      try {
        return await input.fn()
      } finally {
        await fs.rm(lock, { recursive: true, force: true }).catch(() => {})
      }
    }
    if (attempt + 1 >= spins) break
    await delay(5)
  }

  throw new Error(`orchestrator progress lock timeout: ${input.sessionId}`)
}

const uniq = (items: string[]) => {
  const seen = new Set<string>()
  const out = [] as string[]
  for (const item of items) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

const updateMessage = async <T>(input: {
  sessionId: string
  messageId: string
  fn: (msg: Msg) => { msg: Msg; out: T }
}) => {
  const file = storePath(input.sessionId)
  return withLock({
    sessionId: input.sessionId,
    fn: async () => {
      const prev = await readStore(input.sessionId)
      const old = prev.messages[input.messageId] ?? emptyMsg()
      const next = input.fn(old)
      const store = Store.parse({
        ...prev,
        version: prev.version + 1,
        updatedAtUtc: now(),
        messages: {
          ...prev.messages,
          [input.messageId]: next.msg,
        },
      })
      await writeStore({ file, data: store })
      return {
        old,
        msg: next.msg,
        out: next.out,
      }
    },
  })
}

const workerCycle = (input: { msg: Msg; worker: boolean }) => {
  if (!input.worker) return 1
  if (input.msg.stopped) return Math.max(1, input.msg.cycle)
  return input.msg.cycle + 1
}

export const OrchestratorProgressStore = {
  reserve: async (input: z.infer<typeof ReserveInput>) => {
    const data = ReserveInput.parse(input)
    const saved = await updateMessage({
      sessionId: data.sessionId,
      messageId: data.messageId,
      fn: (old) => {
        const cycle = workerCycle({ msg: old, worker: data.worker })
        const msg = Msg.parse({
          ...old,
          cycle: Math.max(old.cycle, cycle),
          updatedAtUtc: now(),
        })
        return { msg, out: { cycle } }
      },
    })
    return {
      cycle: saved.out.cycle,
      stopped: saved.old.stopped,
      degraded: new Set(saved.old.degraded),
    }
  },

  stop: async (input: { sessionId: string; messageId: string }) => {
    const data = UpdateInput.parse({
      sessionId: input.sessionId,
      messageId: input.messageId,
      stop: true,
    })
    return updateMessage({
      sessionId: data.sessionId,
      messageId: data.messageId,
      fn: (old) => {
        const msg = Msg.parse({
          ...old,
          stopped: true,
          updatedAtUtc: now(),
        })
        return { msg, out: msg }
      },
    })
  },

  degraded: async (input: { sessionId: string; messageId: string; reason: string }) => {
    const data = UpdateInput.parse({
      sessionId: input.sessionId,
      messageId: input.messageId,
      degraded: input.reason,
    })
    return updateMessage({
      sessionId: data.sessionId,
      messageId: data.messageId,
      fn: (old) => {
        const msg = Msg.parse({
          ...old,
          degraded: data.degraded ? uniq([...old.degraded, data.degraded]) : old.degraded,
          updatedAtUtc: now(),
        })
        return { msg, out: msg }
      },
    })
  },
}
