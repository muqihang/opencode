import { $ } from "bun"
import fs from "fs/promises"
import os from "os"
import path from "path"
import z from "zod"
import { Archive } from "@/util/archive"
import { EvidenceWriter } from "@/evidence/writer"
import { WorkbenchCache } from "@/file/workbench-cache"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { stableJson } from "@/util/stable-json"
import { artifactCandidates, resolveTenantScope } from "@/util/tenant-context"
import { fileURLToPath } from "url"

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".log",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".xml",
  ".html",
  ".css",
  ".scss",
  ".less",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".swift",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".m",
  ".mm",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".bat",
  ".cmd",
  ".sql",
  ".r",
  ".lua",
])

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

function artifactRoots(sessionId: string) {
  const scope = resolveTenantScope()
  return artifactCandidates({
    base: baseDir(),
    sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  })
}

async function exists(file: string) {
  return fs
    .stat(file)
    .then(() => true)
    .catch(() => false)
}

async function firstExisting(candidates: string[]) {
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }
  return candidates[0]!
}

async function resolveInputPath(sessionId: string, inputId: string, name: string) {
  const candidates = artifactRoots(sessionId).map((root) => path.join(root, "inputs", inputId, name))
  return firstExisting(candidates)
}

async function resolveInputsFile(sessionId: string) {
  const candidates = artifactRoots(sessionId).map((root) => path.join(root, "inputs", "inputs.json"))
  return firstExisting(candidates)
}

async function resolveDerivedRoot(sessionId: string, inputId: string) {
  const candidates = artifactRoots(sessionId).map((root) => path.join(root, "derived", inputId))
  return firstExisting(candidates)
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

function isUtf8(bytes: Uint8Array) {
  if (bytes.byteLength === 0) return true
  const text = Buffer.from(bytes).toString("utf-8")
  const roundtrip = Buffer.from(text, "utf-8")
  return roundtrip.equals(Buffer.from(bytes))
}

function isTextLike(name: string, bytes: Uint8Array) {
  const ext = path.extname(name).toLowerCase()
  if (TEXT_EXTENSIONS.has(ext)) return true
  return isUtf8(bytes)
}

function archiveKind(name: string) {
  const lower = name.toLowerCase()
  if (lower.endsWith(".zip")) return "zip"
  if (lower.endsWith(".tar")) return "tar"
  if (lower.endsWith(".tar.gz")) return "tar"
  if (lower.endsWith(".tgz")) return "tar"
  return
}

function isDocx(name: string, mime: string) {
  const lower = name.toLowerCase()
  if (lower.endsWith(".docx")) return true
  return mime.toLowerCase().includes("officedocument.wordprocessingml.document")
}

function isPdf(name: string, mime: string) {
  const lower = name.toLowerCase()
  if (lower.endsWith(".pdf")) return true
  if (mime.toLowerCase().includes("pdf")) return true
  return false
}

function isImage(name: string, mime: string) {
  if (mime.toLowerCase().startsWith("image/")) return true
  const ext = path.extname(name).toLowerCase()
  return [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff", ".webp"].includes(ext)
}

function decodeXml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
}

function extractDocxParagraphs(xml: string) {
  const paragraphs: string[] = []
  for (const match of xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)) {
    const block = match[0]
    const text = Array.from(block.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g), (item) =>
      decodeXml(item[1]),
    ).join("")
    if (text.length > 0) paragraphs.push(text)
  }
  return paragraphs
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

async function collectFiles(dir: string, files: string[]) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectFiles(target, files)
      continue
    }
    if (entry.isFile()) files.push(target)
  }
}

async function deriveText(options: {
  writer: Awaited<ReturnType<typeof EvidenceWriter.open>>
  inputId: string
  name: string
  bytes: Uint8Array
}) {
  if (!isTextLike(options.name, options.bytes)) return
  const text = Buffer.from(options.bytes).toString("utf-8")
  const chunk = {
    chunk_index: 0,
    start: 0,
    end: options.bytes.byteLength,
    content_hash: sha(options.bytes),
    snippet_preview: text.slice(0, 200),
  }
  await options.writer.artifact({
    kind: "file-derived-text",
    path: `derived/${options.inputId}/text.txt`,
    data: text,
  })
  await options.writer.artifact({
    kind: "file-derived-chunks",
    path: `derived/${options.inputId}/chunks.json`,
    data: stableJson([chunk]),
  })
}

async function extractArchive(kind: "zip" | "tar", source: string, destination: string) {
  type ExtractArchiveResult = { ok: true } | { ok: false; error: string }

  if (kind === "zip") {
    return Archive.extractZip(source, destination)
      .then<ExtractArchiveResult>(() => ({ ok: true }))
      .catch<ExtractArchiveResult>((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }))
  }

  const result = await $`tar -xf ${source}`.cwd(destination).quiet().nothrow()
  if (result.exitCode === 0) return { ok: true }
  const message = result.stderr?.toString().trim() || `tar exit ${result.exitCode}`
  return { ok: false, error: message }
}

async function deriveArchive(options: {
  writer: Awaited<ReturnType<typeof EvidenceWriter.open>>
  sessionId: string
  inputId: string
  name: string
}) {
  const kind = archiveKind(options.name)
  if (!kind) return
  const source = await resolveInputPath(options.sessionId, options.inputId, options.name)
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-unpack-"))
  const extracted = await extractArchive(kind, source, tempRoot)

  if (!extracted.ok) {
    const errorEntry = await options.writer.artifact({
      kind: "file-unpack-error",
      path: `derived/${options.inputId}/unpacked/unpack.error.json`,
      data: stableJson({
        error: extracted.error,
        input: options.name,
      }),
    })
    await options.writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: options.sessionId,
      severity: "error",
      actor: "file:workbench",
      type: "doc.unpack_archive",
      summary: "archive unpack failed",
      data: {
        inputId: options.inputId,
        error_artifact: errorEntry.path,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
    return
  }

  const files: string[] = []
  await collectFiles(tempRoot, files)
  const entries: Array<{ path: string; sha256: string }> = []
  for (const file of files) {
    const rel = path.relative(tempRoot, file).replaceAll("\\", "/")
    const bytes = await Bun.file(file).bytes()
    await options.writer.artifact({
      kind: "file-unpacked",
      path: `derived/${options.inputId}/unpacked/${rel}`,
      data: bytes,
    })
    entries.push({
      path: rel,
      sha256: sha(bytes),
    })
  }

  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path))
  const listEntry = await options.writer.artifact({
    kind: "file-unpacked-list",
    path: `derived/${options.inputId}/unpacked/filelist.json`,
    data: stableJson(sorted),
  })
  await options.writer.event({
    specVersion: "event/1.0",
    ts: new Date().toISOString(),
    sessionId: options.sessionId,
    severity: "info",
    actor: "file:workbench",
    type: "doc.unpack_archive",
    summary: "archive unpacked",
    data: {
      inputId: options.inputId,
      filelist: listEntry.path,
      entries: sorted.length,
    },
    redaction: { applied: true, policyVersion: "v1" },
  })
}

function padPage(page: number) {
  return String(page).padStart(4, "0")
}

function pdfPagesError(code: string, message: string, hint: string) {
  return { code, message, hint }
}

type PdfPagesError = { code: string; message: string; hint: string }
type PdfPageCountResult = { ok: true; pages: number } | { ok: false; error: PdfPagesError }
type PdfPageText = {
  page_number: number
  text_path: string
  text_sha256: string
  content_hash: string
  snippet_preview: string
}
type PdfPagesExtractResult =
  | { ok: true; pages: PdfPageText[] }
  | { ok: false; pages: PdfPageText[]; error: PdfPagesError }

async function pdfPageCount(source: string): Promise<PdfPageCountResult> {
  const available = Boolean(Bun.which("pdfinfo"))
  if (!available) {
    return {
      ok: false,
      error: pdfPagesError(
        "dependency_unavailable",
        "pdfinfo not available",
        "pdftotext/pdfinfo missing or unavailable",
      ),
    }
  }
  const result = await $`pdfinfo ${source}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    const message =
      result.stderr?.toString().trim() ||
      result.stdout?.toString().trim() ||
      `pdfinfo exit ${result.exitCode}`
    return {
      ok: false,
      error: pdfPagesError("extract_failed", message, "pdftotext/pdfinfo failed to read PDF"),
    }
  }
  const output = result.stdout?.toString() ?? ""
  const match = output.match(/Pages:\\s+(\\d+)/i)
  if (!match) {
    return {
      ok: false,
      error: pdfPagesError("parse_failed", "pdfinfo missing page count", "pdftotext/pdfinfo output incomplete"),
    }
  }
  const count = Number(match[1])
  if (!Number.isFinite(count) || count < 1) {
    return {
      ok: false,
      error: pdfPagesError("parse_failed", "pdfinfo page count invalid", "pdftotext/pdfinfo output invalid"),
    }
  }
  return { ok: true, pages: count }
}

async function extractPdfPages(options: {
  writer: Awaited<ReturnType<typeof EvidenceWriter.open>>
  sessionId: string
  inputId: string
  source: string
  pages: number
}): Promise<PdfPagesExtractResult> {
  const available = Boolean(Bun.which("pdftotext"))
  if (!available) {
    return {
      ok: false,
      pages: [],
      error: pdfPagesError(
        "dependency_unavailable",
        "pdftotext not available",
        "pdftotext missing or unavailable",
      ),
    }
  }
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-pdf-pages-"))
  const pages: PdfPageText[] = []
  for (const page of Array.from({ length: options.pages }, (_, index) => index + 1)) {
    const output = path.join(tempRoot, `page-${padPage(page)}.txt`)
    const result = await $`pdftotext -f ${page} -l ${page} ${options.source} ${output}`.quiet().nothrow()
    if (result.exitCode !== 0) {
      const message =
        result.stderr?.toString().trim() ||
        result.stdout?.toString().trim() ||
        `pdftotext exit ${result.exitCode}`
      return {
        ok: false,
        pages,
        error: pdfPagesError("extract_failed", message, "pdftotext failed to extract page text"),
      }
    }
    const bytes = await Bun.file(output).bytes()
    const text = Buffer.from(bytes).toString("utf-8")
    const rel = `pdf/pages/${padPage(page)}.txt`
    await options.writer.artifact({
      kind: "file-pdf-page-text",
      path: `derived/${options.inputId}/${rel}`,
      data: bytes,
    })
    const hash = sha(bytes)
    pages.push({
      page_number: page,
      text_path: rel,
      text_sha256: hash,
      content_hash: hash,
      snippet_preview: text.slice(0, 200),
    })
  }
  return { ok: true, pages }
}

async function derivePdfPages(options: {
  writer: Awaited<ReturnType<typeof EvidenceWriter.open>>
  sessionId: string
  inputId: string
  name: string
  mime: string
}) {
  if (!isPdf(options.name, options.mime)) return
  const source = await resolveInputPath(options.sessionId, options.inputId, options.name)
  const count = await pdfPageCount(source)
  if (!count.ok) {
    const entry = await options.writer.artifact({
      kind: "file-pdf-pages",
      path: `derived/${options.inputId}/pdf.pages.json`,
      data: stableJson({
        specVersion: "pdf-pages/1.0",
        inputId: options.inputId,
        generatedAtUtc: new Date().toISOString(),
        ok: false,
        tool: { name: "pdftotext", mode: "per-page" },
        pages: [],
        error: count.error,
      }),
    })
    await options.writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: options.sessionId,
      severity: "error",
      actor: "file:workbench",
      type: "doc.pdf_pages",
      summary: "pdf pages extraction failed",
      data: {
        inputId: options.inputId,
        pages: entry.path,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
    return
  }

  const extracted = await extractPdfPages({
    writer: options.writer,
    sessionId: options.sessionId,
    inputId: options.inputId,
    source,
    pages: count.pages,
  })
  const entry = await options.writer.artifact({
    kind: "file-pdf-pages",
    path: `derived/${options.inputId}/pdf.pages.json`,
    data: stableJson(
      extracted.ok
        ? {
            specVersion: "pdf-pages/1.0",
            inputId: options.inputId,
            generatedAtUtc: new Date().toISOString(),
            ok: true,
            tool: { name: "pdftotext", mode: "per-page" },
            pages: extracted.pages,
          }
        : {
            specVersion: "pdf-pages/1.0",
            inputId: options.inputId,
            generatedAtUtc: new Date().toISOString(),
            ok: false,
            tool: { name: "pdftotext", mode: "per-page" },
            pages: extracted.pages,
            error: extracted.error,
          },
    ),
  })
  const ok = extracted.ok
  await options.writer.event({
    specVersion: "event/1.0",
    ts: new Date().toISOString(),
    sessionId: options.sessionId,
    severity: ok ? "info" : "error",
    actor: "file:workbench",
    type: "doc.pdf_pages",
    summary: ok ? "pdf pages extracted" : "pdf pages extraction failed",
    data: {
      inputId: options.inputId,
      pages: entry.path,
    },
    redaction: { applied: true, policyVersion: "v1" },
  })
}

async function derivePdf(options: {
  writer: Awaited<ReturnType<typeof EvidenceWriter.open>>
  sessionId: string
  inputId: string
  name: string
  mime: string
}) {
  if (!isPdf(options.name, options.mime)) return
  const source = await resolveInputPath(options.sessionId, options.inputId, options.name)
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-pdf-"))
  const output = path.join(tempRoot, "text.txt")
  const result = await $`pdftotext ${source} ${output}`.quiet().nothrow()

  if (result.exitCode === 0) {
    const file = Bun.file(output)
    const exists = await file.exists()
    if (exists) {
      const text = await file.text()
      const textEntry = await options.writer.artifact({
        kind: "file-derived-text",
        path: `derived/${options.inputId}/text.txt`,
        data: text,
      })
      await options.writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: options.sessionId,
        severity: "info",
        actor: "file:workbench",
        type: "doc.extract_pdf_text",
        summary: "pdf text extracted",
        data: {
          inputId: options.inputId,
          text: textEntry.path,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })
      return
    }
  }

  const message =
    result.stderr?.toString().trim() ||
    result.stdout?.toString().trim() ||
    `pdftotext exit ${result.exitCode}`
  const errorEntry = await options.writer.artifact({
    kind: "file-pdf-error",
    path: `derived/${options.inputId}/pdf.extract.error.json`,
    data: stableJson({
      error: message,
      hint: "pdftotext failed or is unavailable",
    }),
  })
  await options.writer.event({
    specVersion: "event/1.0",
    ts: new Date().toISOString(),
    sessionId: options.sessionId,
    severity: "error",
    actor: "file:workbench",
    type: "doc.extract_pdf_text",
    summary: "pdf text extraction failed",
    data: {
      inputId: options.inputId,
      error_artifact: errorEntry.path,
    },
    redaction: { applied: true, policyVersion: "v1" },
  })
}

async function deriveOcrImage(options: {
  writer: Awaited<ReturnType<typeof EvidenceWriter.open>>
  sessionId: string
  inputId: string
  name: string
  mime: string
  language: string
}) {
  if (!isImage(options.name, options.mime)) return
  const source = await resolveInputPath(options.sessionId, options.inputId, options.name)
  const available = Boolean(Bun.which("tesseract"))
  if (!available) {
    const errorEntry = await options.writer.artifact({
      kind: "file-ocr-error",
      path: `derived/${options.inputId}/ocr.error.json`,
      data: stableJson({
        ok: false,
        error: {
          code: "dependency_unavailable",
          message: "tesseract not available",
          hint: "tesseract missing or unavailable",
        },
        tool: { name: "tesseract", language: options.language },
      }),
    })
    await options.writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: options.sessionId,
      severity: "error",
      actor: "file:workbench",
      type: "doc.ocr_image",
      summary: "ocr failed",
      data: {
        inputId: options.inputId,
        error_artifact: errorEntry.path,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
    return
  }

  const result = await $`tesseract ${source} stdout -l ${options.language}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    const message =
      result.stderr?.toString().trim() ||
      result.stdout?.toString().trim() ||
      `tesseract exit ${result.exitCode}`
    const errorEntry = await options.writer.artifact({
      kind: "file-ocr-error",
      path: `derived/${options.inputId}/ocr.error.json`,
      data: stableJson({
        ok: false,
        error: {
          code: "ocr_failed",
          message,
          hint: "tesseract failed to process image",
        },
        tool: { name: "tesseract", language: options.language },
      }),
    })
    await options.writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: options.sessionId,
      severity: "error",
      actor: "file:workbench",
      type: "doc.ocr_image",
      summary: "ocr failed",
      data: {
        inputId: options.inputId,
        error_artifact: errorEntry.path,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
    return
  }

  const text = result.stdout?.toString() ?? ""
  const bytes = Buffer.from(text, "utf-8")
  const textEntry = await options.writer.artifact({
    kind: "file-ocr-text",
    path: `derived/${options.inputId}/ocr.text.txt`,
    data: text,
  })
  const metaEntry = await options.writer.artifact({
    kind: "file-ocr-meta",
    path: `derived/${options.inputId}/ocr.meta.json`,
    data: stableJson({
      specVersion: "ocr-meta/1.0",
      inputId: options.inputId,
      generatedAtUtc: new Date().toISOString(),
      ok: true,
      tool: { name: "tesseract", language: options.language },
      text: {
        path: textEntry.path,
        sha256: sha(bytes),
      },
    }),
  })
  await options.writer.event({
    specVersion: "event/1.0",
    ts: new Date().toISOString(),
    sessionId: options.sessionId,
    severity: "info",
    actor: "file:workbench",
    type: "doc.ocr_image",
    summary: "ocr completed",
    data: {
      inputId: options.inputId,
      text: textEntry.path,
      meta: metaEntry.path,
    },
    redaction: { applied: true, policyVersion: "v1" },
  })
}

async function deriveDocx(options: {
  writer: Awaited<ReturnType<typeof EvidenceWriter.open>>
  sessionId: string
  inputId: string
  name: string
  mime: string
}) {
  type ExtractZipResult = { ok: true } | { ok: false; error: string }

  if (!isDocx(options.name, options.mime)) return
  const source = await resolveInputPath(options.sessionId, options.inputId, options.name)
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-docx-"))
  const extracted = await Archive.extractZip(source, tempRoot)
    .then<ExtractZipResult>(() => ({ ok: true }))
    .catch<ExtractZipResult>((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }))
  if (!extracted.ok) {
    const errorEntry = await options.writer.artifact({
      kind: "file-docx-error",
      path: `derived/${options.inputId}/docx.error.json`,
      data: stableJson({
        ok: false,
        error: {
          code: "extract_failed",
          message: extracted.error,
          hint: "failed to unpack docx archive",
        },
      }),
    })
    await options.writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: options.sessionId,
      severity: "error",
      actor: "file:workbench",
      type: "doc.parse_docx",
      summary: "docx parse failed",
      data: {
        inputId: options.inputId,
        error_artifact: errorEntry.path,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
    return
  }

  const documentPath = path.join(tempRoot, "word", "document.xml")
  const documentExists = await Bun.file(documentPath).exists()
  if (!documentExists) {
    const errorEntry = await options.writer.artifact({
      kind: "file-docx-error",
      path: `derived/${options.inputId}/docx.error.json`,
      data: stableJson({
        ok: false,
        error: {
          code: "missing_document",
          message: "document.xml missing in docx",
          hint: "docx missing word/document.xml",
        },
      }),
    })
    await options.writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: options.sessionId,
      severity: "error",
      actor: "file:workbench",
      type: "doc.parse_docx",
      summary: "docx parse failed",
      data: {
        inputId: options.inputId,
        error_artifact: errorEntry.path,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
    return
  }

  const xml = await Bun.file(documentPath).text()
  const paragraphs = extractDocxParagraphs(xml)
  const text = paragraphs.join("\\n")
  await options.writer.artifact({
    kind: "file-derived-text",
    path: `derived/${options.inputId}/text.txt`,
    data: text,
  })
  const built = paragraphs.reduce(
    (state, paragraph, index) => {
      const bytes = Buffer.from(paragraph, "utf-8")
      const start = state.offset
      const end = start + bytes.length
      const chunk = {
        chunk_index: index,
        start,
        end,
        content_hash: sha(bytes),
        snippet_preview: paragraph.slice(0, 200),
      }
      const next = index === paragraphs.length - 1 ? end : end + 1
      return { offset: next, chunks: [...state.chunks, chunk] }
    },
    { offset: 0, chunks: [] as Array<{ chunk_index: number; start: number; end: number; content_hash: string; snippet_preview: string }> },
  )
  await options.writer.artifact({
    kind: "file-derived-chunks",
    path: `derived/${options.inputId}/chunks.json`,
    data: stableJson(built.chunks),
  })
  const structure = {
    specVersion: "docx-structure/1.0",
    inputId: options.inputId,
    generatedAtUtc: new Date().toISOString(),
    paragraphCount: paragraphs.length,
    paragraphs: paragraphs.map((paragraph, index) => {
      const bytes = Buffer.from(paragraph, "utf-8")
      return {
        index,
        sha256: sha(bytes),
        length: paragraph.length,
        snippet_preview: paragraph.slice(0, 200),
      }
    }),
  }
  const structureEntry = await options.writer.artifact({
    kind: "file-docx-structure",
    path: `derived/${options.inputId}/docx.structure.json`,
    data: stableJson(structure),
  })
  await options.writer.event({
    specVersion: "event/1.0",
    ts: new Date().toISOString(),
    sessionId: options.sessionId,
    severity: "info",
    actor: "file:workbench",
    type: "doc.parse_docx",
    summary: "docx parsed",
    data: {
      inputId: options.inputId,
      structure: structureEntry.path,
    },
    redaction: { applied: true, policyVersion: "v1" },
  })
}

export const Workbench = {
  async ingest(input: z.infer<typeof IngestInput>) {
    const data = IngestInput.parse(input)
    const part = data.part
    const payload = await loadPart(part)
    if (!payload) return

    const writer = await EvidenceWriter.open({ sessionId: data.sessionId })
    const inputId = sha(payload.bytes)
    const config = await Config.get()
    const inputsPath = await resolveInputsFile(data.sessionId)
    const current = await readInputs(inputsPath)
    const existing = current.inputs.find((item) => item.inputId === inputId)
    const wantsText = isTextLike(payload.name, payload.bytes)
    const wantsDocx = isDocx(payload.name, payload.mime)
    const wantsArchive = Boolean(archiveKind(payload.name))
    const wantsPdf = isPdf(payload.name, payload.mime)
    const wantsOcr = isImage(payload.name, payload.mime)
    const ocrMode = config.workbench?.ocr?.mode ?? "disabled"
    const ocrEnabled = ocrMode === "tesseract"
    const ocrLanguage = config.workbench?.ocr?.language ?? "eng"

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

    const hits: string[] = []

    async function rehydrate(category: "text" | "archive" | "pdf") {
      const cached = await WorkbenchCache.readCategory({ inputId, category })
      if (!cached) return false
      if (!WorkbenchCache.canReuse({ meta: cached.meta, category })) return false
      for (const item of cached.meta.artifacts) {
        const bytes = await WorkbenchCache.readArtifact({ dir: cached.dir, rel: item.path })
        await writer.artifact({
          kind: item.kind,
          path: `derived/${inputId}/${item.path}`,
          data: bytes,
        })
      }
      hits.push(category)
      return true
    }

    const textHit = wantsText || wantsDocx ? await rehydrate("text") : false
    if (!textHit && wantsText) {
      await deriveText({
        writer,
        inputId,
        name: payload.name,
        bytes: payload.bytes,
      })
      await WorkbenchCache.writeCategoryFromSessionDerived({
        sessionId: data.sessionId,
        inputId,
        category: "text",
        artifacts: [
          { rel: "text.txt", kind: "file-derived-text" },
          { rel: "chunks.json", kind: "file-derived-chunks" },
        ],
      })
    }

    if (!textHit && wantsDocx) {
      await deriveDocx({
        writer,
        sessionId: data.sessionId,
        inputId,
        name: payload.name,
        mime: payload.mime,
      })
      const derivedRoot = await resolveDerivedRoot(data.sessionId, inputId)
      const textPath = path.join(derivedRoot, "text.txt")
      const chunksPath = path.join(derivedRoot, "chunks.json")
      const textExists = await Bun.file(textPath).exists()
      const chunksExists = await Bun.file(chunksPath).exists()
      if (textExists && chunksExists) {
        const artifacts = [
          { rel: "text.txt", kind: "file-derived-text" },
          { rel: "chunks.json", kind: "file-derived-chunks" },
        ]
        const structurePath = path.join(derivedRoot, "docx.structure.json")
        const structureExists = await Bun.file(structurePath).exists()
        if (structureExists) artifacts.push({ rel: "docx.structure.json", kind: "file-docx-structure" })
        await WorkbenchCache.writeCategoryFromSessionDerived({
          sessionId: data.sessionId,
          inputId,
          category: "text",
          artifacts,
        })
      }
    }

    const archiveHit = wantsArchive ? await rehydrate("archive") : false
    if (!archiveHit && wantsArchive) {
      await deriveArchive({
        writer,
        sessionId: data.sessionId,
        inputId,
        name: payload.name,
      })
      const derivedRoot = await resolveDerivedRoot(data.sessionId, inputId)
      const listPath = path.join(derivedRoot, "unpacked", "filelist.json")
      const listExists = await Bun.file(listPath).exists()
      if (listExists) {
        const list = JSON.parse(await Bun.file(listPath).text()) as Array<{ path: string }>
        const artifacts = [
          { rel: "unpacked/filelist.json", kind: "file-unpacked-list" },
          ...list.map((item) => ({ rel: `unpacked/${item.path}`, kind: "file-unpacked" })),
        ]
        await WorkbenchCache.writeCategoryFromSessionDerived({
          sessionId: data.sessionId,
          inputId,
          category: "archive",
          artifacts,
        })
      }
    }

    const pdfHit = wantsPdf ? await rehydrate("pdf") : false
    if (!pdfHit && wantsPdf) {
      await derivePdfPages({
        writer,
        sessionId: data.sessionId,
        inputId,
        name: payload.name,
        mime: payload.mime,
      })
      await derivePdf({
        writer,
        sessionId: data.sessionId,
        inputId,
        name: payload.name,
        mime: payload.mime,
      })
      const derivedRoot = await resolveDerivedRoot(data.sessionId, inputId)
      const artifacts: Array<{ rel: string; kind: string }> = []
      const pagesPath = path.join(derivedRoot, "pdf.pages.json")
      const pagesExists = await Bun.file(pagesPath).exists()
      if (pagesExists) artifacts.push({ rel: "pdf.pages.json", kind: "file-pdf-pages" })
      const pagesDir = path.join(derivedRoot, "pdf", "pages")
      const pagesDirExists = await Bun.file(pagesDir).exists()
      if (pagesDirExists) {
        const files: string[] = []
        await collectFiles(pagesDir, files)
        const rels = files
          .map((file) => path.relative(derivedRoot, file).replaceAll("\\", "/"))
          .sort((a, b) => a.localeCompare(b))
        artifacts.push(...rels.map((rel) => ({ rel, kind: "file-pdf-page-text" })))
      }
      const errorPath = path.join(derivedRoot, "pdf.extract.error.json")
      const errorExists = await Bun.file(errorPath).exists()
      if (errorExists) artifacts.push({ rel: "pdf.extract.error.json", kind: "file-pdf-error" })
      const textPath = path.join(derivedRoot, "text.txt")
      const textExists = await Bun.file(textPath).exists()
      if (textExists) artifacts.push({ rel: "text.txt", kind: "file-derived-text" })
      if (artifacts.length > 0) {
        await WorkbenchCache.writeCategoryFromSessionDerived({
          sessionId: data.sessionId,
          inputId,
          category: "pdf",
          artifacts,
        })
      }
    }

    if (wantsOcr && ocrEnabled) {
      await deriveOcrImage({
        writer,
        sessionId: data.sessionId,
        inputId,
        name: payload.name,
        mime: payload.mime,
        language: ocrLanguage,
      })
    }

    if (hits.length > 0) {
      const updated = inputs.map((item) => (item.inputId === inputId ? applyCacheHit(item) : item))
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
        summary: "derived cache hit",
        data: {
          inputId,
          name: payload.name,
          scope: "global",
          categories: hits,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })
    }
  },
}
