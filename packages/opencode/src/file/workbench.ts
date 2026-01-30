import path from "path"
import z from "zod"
import { EvidenceWriter } from "@/evidence/writer"
import { Instance } from "@/project/instance"
import { stableJson } from "@/util/stable-json"
import { fileURLToPath } from "url"

const FilePart = z
  .object({
    type: z.literal("file"),
    url: z.string().min(1),
    mime: z.string().min(1),
    filename: z.string().optional(),
  })
  .strict()

const IngestInput = z
  .object({
    sessionId: z.string().min(1),
    part: FilePart,
  })
  .strict()

const InputEntry = z
  .object({
    inputId: z.string().min(1),
    name: z.string().min(1),
    size: z.number().int().nonnegative(),
    sha256: z.string().min(1),
    mime: z.string().min(1),
    addedAt: z.string().min(1),
    events: z.array(z.string().min(1)).optional(),
  })
  .strict()

const InputsFile = z
  .object({
    specVersion: z.literal("file-inputs/1.0"),
    inputs: z.array(InputEntry),
  })
  .strict()

function baseDir() {
  return Instance.worktree === "/" ? Instance.directory : Instance.worktree
}

function sha(bytes: Uint8Array) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(Buffer.from(bytes))
  return hash.digest("hex")
}

function safeName(name: string | undefined, fallback: string) {
  if (name && name.trim()) return path.basename(name)
  if (fallback.trim()) return path.basename(fallback)
  return "file"
}

function sortInputs(items: z.infer<typeof InputEntry>[]) {
  return [...items].sort((a, b) => {
    const byId = a.inputId.localeCompare(b.inputId)
    if (byId !== 0) return byId
    return a.name.localeCompare(b.name)
  })
}

function parseDataUrl(url: string) {
  const match = url.match(/^data:([^;]+);base64,(.*)$/)
  if (!match) {
    throw new Error("Unsupported data URL")
  }
  const mime = match[1]
  const bytes = Buffer.from(match[2], "base64")
  return { mime, bytes }
}

async function readInputs(file: string) {
  const text = await Bun.file(file).text().catch(() => "")
  if (!text) {
    return InputsFile.parse({ specVersion: "file-inputs/1.0", inputs: [] })
  }
  const data = JSON.parse(text) as unknown
  return InputsFile.parse(data)
}

async function loadPart(part: z.infer<typeof FilePart>) {
  if (part.url.startsWith("file://")) {
    const filepath = fileURLToPath(part.url)
    const file = Bun.file(filepath)
    const stat = await file.stat()
    if (stat.isDirectory()) return
    const bytes = await file.bytes()
    const name = safeName(part.filename, path.basename(filepath))
    return { bytes, name, mime: part.mime }
  }

  if (part.url.startsWith("data:")) {
    const parsed = parseDataUrl(part.url)
    const name = safeName(part.filename, "file")
    return { bytes: parsed.bytes, name, mime: parsed.mime || part.mime }
  }

  throw new Error("Unsupported file URL")
}

function applyCacheHit(entry: z.infer<typeof InputEntry>) {
  const existing = entry.events ?? []
  if (existing.includes("cache_hit")) return entry
  return { ...entry, events: [...existing, "cache_hit"] }
}

export const Workbench = {
  async ingest(input: z.infer<typeof IngestInput>) {
    const data = IngestInput.parse(input)
    const part = data.part
    const payload = await loadPart(part)
    if (!payload) return

    const writer = await EvidenceWriter.open({ sessionId: data.sessionId })
    const inputId = sha(payload.bytes)
    const inputsPath = path.join(baseDir(), ".opencode", "artifacts", data.sessionId, "inputs", "inputs.json")
    const current = await readInputs(inputsPath)
    const existing = current.inputs.find((item) => item.inputId === inputId)

    if (existing) {
      const updated = current.inputs.map((item) => (item.inputId === inputId ? applyCacheHit(item) : item))
      await writer.artifact({
        kind: "file-inputs",
        path: "inputs/inputs.json",
        data: stableJson({ specVersion: current.specVersion, inputs: sortInputs(updated) }),
      })
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: data.sessionId,
        severity: "info",
        actor: "file:workbench",
        type: "file.cache_hit",
        summary: "input deduplicated",
        data: {
          inputId,
          name: payload.name,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })
      return
    }

    const entry = InputEntry.parse({
      inputId,
      name: payload.name,
      size: payload.bytes.byteLength,
      sha256: inputId,
      mime: payload.mime,
      addedAt: new Date().toISOString(),
    })
    const inputs = sortInputs([...current.inputs, entry])
    await writer.artifact({
      kind: "file-input",
      path: `inputs/${inputId}/${payload.name}`,
      data: payload.bytes,
    })
    await writer.artifact({
      kind: "file-inputs",
      path: "inputs/inputs.json",
      data: stableJson({ specVersion: current.specVersion, inputs }),
    })
  },
}
