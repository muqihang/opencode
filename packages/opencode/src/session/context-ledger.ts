import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Instance } from "@/project/instance"
import { stableJson } from "@/util/stable-json"

const Ledger = z
  .object({
    specVersion: z.literal("context-ledger/1.0"),
    sessionId: z.string().min(1),
    updatedAtUtc: z.string().min(1),
    lastContextPackId: z.string().min(1).optional(),
  })
  .strict()

type Ledger = z.infer<typeof Ledger>

const baseDir = () => (Instance.worktree === "/" ? Instance.directory : Instance.worktree)

const ledgerPath = (sessionId: string) => path.join(baseDir(), ".opencode", "context", sessionId, "ledger.json")

export const ContextLedger = {
  async read(sessionId: string): Promise<Ledger> {
    const file = ledgerPath(sessionId)
    const text = await Bun.file(file).text().catch(() => "")
    const empty = Ledger.parse({
      specVersion: "context-ledger/1.0",
      sessionId,
      updatedAtUtc: new Date().toISOString(),
    })
    if (!text) return empty

    const data = (() => {
      try {
        return JSON.parse(text) as unknown
      } catch {
        return undefined
      }
    })()
    if (!data) return empty
    const parsed = Ledger.safeParse(data)
    if (!parsed.success) return empty
    if (parsed.data.sessionId !== sessionId) return empty
    return parsed.data
  },

  async write(input: { sessionId: string; lastContextPackId: string }) {
    const file = ledgerPath(input.sessionId)
    await fs.mkdir(path.dirname(file), { recursive: true })
    const next = Ledger.parse({
      specVersion: "context-ledger/1.0",
      sessionId: input.sessionId,
      updatedAtUtc: new Date().toISOString(),
      lastContextPackId: input.lastContextPackId,
    })
    await Bun.write(file, stableJson(next))
  },
}
