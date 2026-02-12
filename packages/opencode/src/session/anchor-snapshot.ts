import path from "path"
import z from "zod"
import { IsoDateTimeUtc, Sha256 } from "@/protocol/shared"

const Pointer = z
  .object({
    path: z.string().min(1),
    sha256: Sha256,
  })
  .strict()

const Mode = z.enum(["assist", "heavy", "fork", "chat", "unknown"])

const Schema = z
  .object({
    specVersion: z.literal("anchor-snapshot/1.0"),
    sessionId: z.string().min(1),
    messageId: z.string().min(1),
    planId: z.string().min(1),
    generatedAtUtc: IsoDateTimeUtc,
    repo: z
      .object({
        head: z.string().min(1),
        dirty: z.boolean(),
      })
      .strict(),
    model: z
      .object({
        providerId: z.string().min(1),
        modelId: z.string().min(1),
      })
      .strict(),
    context: z
      .object({
        lastContextPackId: z.string().min(1).optional(),
        orchestratorMode: Mode,
      })
      .strict(),
    toolsetFingerprint: z.string().min(1),
  })
  .strict()

type Snapshot = z.infer<typeof Schema>
type Pointer = z.infer<typeof Pointer>

type CheckPass = { ok: true }
type CheckFail = { ok: false; reasonZh: string; nextStepsZh: string }

const fail = (reasonZh: string): CheckFail => ({
  ok: false,
  reasonZh,
  nextStepsZh: "请先重建 context-pack 与 anchor-snapshot，再重试恢复链路。",
})

export const AnchorSnapshot = {
  Schema,
  Pointer,

  build(input: Omit<Snapshot, "specVersion">): Snapshot {
    return Schema.parse({
      specVersion: "anchor-snapshot/1.0",
      ...input,
    })
  },

  checkReplay(input: { sessionId: string; lastContextPackId?: string; pointer?: Pointer }): CheckPass | CheckFail {
    if (!input.lastContextPackId) return { ok: true }
    if (input.pointer) return { ok: true }
    return fail(`恢复链路 fail-closed：session=${input.sessionId} 缺少 anchor-snapshot。`)
  },

  async read(input: { baseDir: string; pointer: Pointer }): Promise<Snapshot | undefined> {
    const file = path.join(input.baseDir, input.pointer.path)
    const text = await Bun.file(file).text().catch(() => "")
    if (!text) return

    const data = (() => {
      try {
        return JSON.parse(text) as unknown
      } catch {
        return undefined
      }
    })()
    if (!data) return

    const parsed = Schema.safeParse(data)
    if (!parsed.success) return
    return parsed.data
  },
}

export type AnchorSnapshot = Snapshot
