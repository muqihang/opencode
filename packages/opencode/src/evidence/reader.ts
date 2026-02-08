import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Instance } from "@/project/instance"
import { EvidenceManifest } from "@/protocol/evidence-manifest"
import { EventV1 } from "@/protocol/event"
import { evidenceCandidates, resolveTenantScope } from "@/util/tenant-context"

const ReadEventsInput = z
  .object({
    cursor: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(1000).optional(),
    tenantId: z.string().min(1).optional(),
    orgId: z.string().min(1).optional(),
  })
  .strict()

const ReadManifestInput = z
  .object({
    tenantId: z.string().min(1).optional(),
    orgId: z.string().min(1).optional(),
  })
  .strict()

function baseDir() {
  return Instance.worktree === "/" ? Instance.directory : Instance.worktree
}

async function firstExisting(files: string[]) {
  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null)
    if (stat?.isFile()) return file
  }
  return files[0]
}

async function eventsPath(sessionId: string, input?: { tenantId?: string; orgId?: string }) {
  const scope = resolveTenantScope(input)
  const dirs = evidenceCandidates({
    base: baseDir(),
    sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  })
  const files = dirs.map((dir) => path.join(dir, "events.jsonl"))
  return firstExisting(files)
}

async function manifestPath(sessionId: string, input?: { tenantId?: string; orgId?: string }) {
  const scope = resolveTenantScope(input)
  const dirs = evidenceCandidates({
    base: baseDir(),
    sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  })
  const files = dirs.map((dir) => path.join(dir, "manifest.json"))
  return firstExisting(files)
}

type EventsResult = {
  events: EventV1[]
  nextCursor: number
}

async function readEvents(sessionId: string, opts: z.infer<typeof ReadEventsInput>): Promise<EventsResult> {
  const input = ReadEventsInput.parse(opts)
  const limit = input.limit ?? 200
  const file = await eventsPath(sessionId, { tenantId: input.tenantId, orgId: input.orgId })
  const handle = await fs.open(file, "r").catch(() => null)
  if (!handle) return { events: [], nextCursor: 0 }

  try {
    const stat = await handle.stat().catch(() => null)
    const size = stat?.size ?? 0
    if (input.cursor >= size) return { events: [], nextCursor: size }

    const items: EventV1[] = []
    const tail = { buf: Buffer.alloc(0) }
    const pos = { value: input.cursor }
    const chunk = Buffer.alloc(64 * 1024)

    for (;;) {
      if (items.length >= limit) break
      const out = await handle.read(chunk, 0, chunk.byteLength, pos.value)
      if (out.bytesRead <= 0) break
      pos.value += out.bytesRead
      tail.buf = Buffer.concat([tail.buf, chunk.subarray(0, out.bytesRead)])

      for (;;) {
        if (items.length >= limit) break
        const idx = tail.buf.indexOf(10)
        if (idx < 0) break

        const raw = tail.buf.subarray(0, idx).toString("utf-8").trim()
        tail.buf = tail.buf.subarray(idx + 1)
        if (!raw) continue
        items.push(EventV1.parse(JSON.parse(raw)))
      }
    }

    if (tail.buf.byteLength > 0 && items.length < limit) {
      const raw = tail.buf.toString("utf-8").trim()
      const json = (() => {
        try {
          return raw ? (JSON.parse(raw) as unknown) : undefined
        } catch {
          return undefined
        }
      })()
      const parsed = json ? EventV1.safeParse(json) : { success: false as const }
      if (parsed.success) items.push(parsed.data)
      tail.buf = Buffer.alloc(0)
    }

    return { events: items, nextCursor: pos.value - tail.buf.byteLength }
  } finally {
    await handle.close().catch(() => {})
  }
}

async function readManifest(sessionId: string, input?: z.infer<typeof ReadManifestInput>) {
  const parsed = ReadManifestInput.parse(input ?? {})
  const file = await manifestPath(sessionId, { tenantId: parsed.tenantId, orgId: parsed.orgId })
  const text = await Bun.file(file).text().catch(() => "")
  if (!text) {
    return EvidenceManifest.parse({
      specVersion: "evidence-manifest/1.0",
      packId: `EP-${sessionId}`,
      generatedAtUtc: new Date().toISOString(),
      entries: [],
    })
  }
  return EvidenceManifest.parse(JSON.parse(text) as unknown)
}

export const EvidenceReader = {
  readEvents,
  readManifest,
}
