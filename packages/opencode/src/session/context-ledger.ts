import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Instance } from "@/project/instance"
import { Sha256 } from "@/protocol/shared"
import { stableJson } from "@/util/stable-json"

const CapsulePtr = z
  .object({
    path: z.string().min(1),
    sha256: Sha256,
  })
  .strict()

const Handoff = z
  .object({
    childSessionId: z.string().min(1),
    capsulePath: z.string().min(1),
    capsuleSha256: Sha256,
    importedAtUtc: z.string().min(1),
  })
  .strict()

const AssistedMeta = z
  .object({
    ok: z.boolean(),
    generatedAtUtc: z.string().min(1),
    model: z.string().min(1).optional(),
    compactionId: z.string().min(1).optional(),
  })
  .strict()

const Ledger = z
  .object({
    specVersion: z.literal("context-ledger/1.0"),
    sessionId: z.string().min(1),
    updatedAtUtc: z.string().min(1),
    lastContextPackId: z.string().min(1).optional(),
    lastAnchorSnapshot: CapsulePtr.optional(),
    lastCapsuleSession: CapsulePtr.optional(),
    lastCapsuleRendered: CapsulePtr.optional(),
    lastCapsuleAssisted: CapsulePtr.optional(),
    lastCapsuleAssistedRendered: CapsulePtr.optional(),
    lastCapsuleAssistedInput: CapsulePtr.optional(),
    lastCapsuleAssistedMeta: AssistedMeta.optional(),
    handoffs: z.array(Handoff).optional(),
  })
  .strict()

type Ledger = z.infer<typeof Ledger>
type Patch = Partial<
  Pick<
    Ledger,
    | "lastContextPackId"
    | "lastAnchorSnapshot"
    | "lastCapsuleSession"
    | "lastCapsuleRendered"
    | "lastCapsuleAssisted"
    | "lastCapsuleAssistedRendered"
    | "lastCapsuleAssistedInput"
    | "lastCapsuleAssistedMeta"
    | "handoffs"
  >
>

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

  async update(input: { sessionId: string; patch: Patch }) {
    const file = ledgerPath(input.sessionId)
    await fs.mkdir(path.dirname(file), { recursive: true })

    const prev = await ContextLedger.read(input.sessionId)
    const next = Ledger.parse({
      ...prev,
      ...(input.patch.lastContextPackId === undefined ? {} : { lastContextPackId: input.patch.lastContextPackId }),
      ...(input.patch.lastAnchorSnapshot === undefined ? {} : { lastAnchorSnapshot: input.patch.lastAnchorSnapshot }),
      ...(input.patch.lastCapsuleSession === undefined ? {} : { lastCapsuleSession: input.patch.lastCapsuleSession }),
      ...(input.patch.lastCapsuleRendered === undefined ? {} : { lastCapsuleRendered: input.patch.lastCapsuleRendered }),
      ...(input.patch.lastCapsuleAssisted === undefined ? {} : { lastCapsuleAssisted: input.patch.lastCapsuleAssisted }),
      ...(input.patch.lastCapsuleAssistedRendered === undefined
        ? {}
        : { lastCapsuleAssistedRendered: input.patch.lastCapsuleAssistedRendered }),
      ...(input.patch.lastCapsuleAssistedInput === undefined
        ? {}
        : { lastCapsuleAssistedInput: input.patch.lastCapsuleAssistedInput }),
      ...(input.patch.lastCapsuleAssistedMeta === undefined
        ? {}
        : { lastCapsuleAssistedMeta: input.patch.lastCapsuleAssistedMeta }),
      ...(input.patch.handoffs === undefined ? {} : { handoffs: input.patch.handoffs }),
      specVersion: "context-ledger/1.0",
      sessionId: input.sessionId,
      updatedAtUtc: new Date().toISOString(),
    })
    await Bun.write(file, stableJson(next))
    return next
  },

  async write(input: { sessionId: string; lastContextPackId: string; lastAnchorSnapshot?: z.infer<typeof CapsulePtr> }) {
    await ContextLedger.update({
      sessionId: input.sessionId,
      patch: {
        lastContextPackId: input.lastContextPackId,
        lastAnchorSnapshot: input.lastAnchorSnapshot,
      },
    })
  },
}
