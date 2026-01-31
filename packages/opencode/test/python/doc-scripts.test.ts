import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { ScriptRegistry } from "../../src/python/registry"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const scriptIds = ["doc-extract-pdf-text", "doc-unpack-archive", "doc-ocr-image"]

describe("python.doc scripts", () => {
  test("manifest includes doc scripts", async () => {
    const manifest = await ScriptRegistry.manifest()
    for (const id of scriptIds) {
      const entry = manifest.find((item) => item.id === id)
      expect(entry).toBeDefined()
      expect(entry!.sha256.length).toBe(64)
      expect(entry!.path.endsWith(".py")).toBe(true)
    }
  })

  test("registry resolves doc scripts", async () => {
    await Instance.provide({
      directory: path.join(__dirname, "../.."),
      fn: async () => {
        for (const id of scriptIds) {
          const script = await ScriptRegistry.resolve({ scriptId: id })
          expect(script.id).toBe(id)
          expect(script.sha256.length).toBe(64)
          expect(script.path.endsWith(`${id}.py`)).toBe(true)
        }
      },
    })
  })

  test("doc-unpack-archive contract", async () => {
    const python = Bun.which("python3")
    if (!python) return
    const script = path.join(__dirname, "../../src/python/scripts/doc-unpack-archive.py")
    await using tmp = await tmpdir({})
    const source = path.join(tmp.path, "source.txt")
    await Bun.write(source, "hello")
    const archive = path.join(tmp.path, "archive.tar")
    await $`tar -cf ${archive} -C ${tmp.path} source.txt`.quiet()
    const outputDir = path.join(tmp.path, "derived", "input-1")
    const input = path.join(tmp.path, "input.json")
    const output = path.join(tmp.path, "output.json")
    await Bun.write(
      input,
      JSON.stringify({ input_path: archive, output_dir: outputDir, input_id: "input-1" }),
    )
    await $`${python} ${script} --input ${input} --output ${output}`.quiet()
    const data = JSON.parse(await Bun.file(output).text())
    expect(data.type).toBe("doc.unpack_archive")
    expect(data.ok).toBe(true)
    const extracted = path.join(outputDir, "unpacked", "source.txt")
    const exists = await Bun.file(extracted).exists()
    expect(exists).toBe(true)
    expect(Array.isArray(data.artifacts)).toBe(true)
  })

  test("doc-extract-pdf-text contract", async () => {
    const python = Bun.which("python3")
    if (!python) return
    const script = path.join(__dirname, "../../src/python/scripts/doc-extract-pdf-text.py")
    await using tmp = await tmpdir({})
    const source = path.join(tmp.path, "sample.pdf")
    await Bun.write(source, "not a real pdf")
    const outputDir = path.join(tmp.path, "derived", "input-2")
    const input = path.join(tmp.path, "input.json")
    const output = path.join(tmp.path, "output.json")
    await Bun.write(
      input,
      JSON.stringify({ input_path: source, output_dir: outputDir, input_id: "input-2" }),
    )
    await $`${python} ${script} --input ${input} --output ${output}`.quiet()
    const data = JSON.parse(await Bun.file(output).text())
    expect(data.type).toBe("doc.extract_pdf_text")
    expect(typeof data.ok).toBe("boolean")
    if (data.ok) {
      expect(Array.isArray(data.artifacts)).toBe(true)
    }
    if (!data.ok) {
      expect(data.error).toBeDefined()
    }
  })

  test("doc-ocr-image stub contract", async () => {
    const python = Bun.which("python3")
    if (!python) return
    const script = path.join(__dirname, "../../src/python/scripts/doc-ocr-image.py")
    await using tmp = await tmpdir({})
    const source = path.join(tmp.path, "sample.png")
    await Bun.write(source, "fake")
    const outputDir = path.join(tmp.path, "derived", "input-3")
    const input = path.join(tmp.path, "input.json")
    const output = path.join(tmp.path, "output.json")
    await Bun.write(
      input,
      JSON.stringify({ input_path: source, output_dir: outputDir, input_id: "input-3" }),
    )
    await $`${python} ${script} --input ${input} --output ${output}`.quiet()
    const data = JSON.parse(await Bun.file(output).text())
    expect(data.type).toBe("doc.ocr_image")
    expect(data.ok).toBe(false)
    expect(data.error?.code).toBe("ocr_unavailable")
  })
})
