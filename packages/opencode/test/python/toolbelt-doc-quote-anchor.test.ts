import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { stableJson } from "../../src/util/stable-json"

const sha256 = (text: string) => {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(text)
  return hash.digest("hex")
}

describe("toolbelt.doc-quote-anchor", () => {
  test("anchors substring with line range", async () => {
    const python = Bun.which("python3")
    if (!python) return
    const script = path.join(__dirname, "../../src/python/scripts/doc-quote-anchor.py")
    await using tmp = await tmpdir({})
    const sessionId = "session-2"
    const root = path.join(tmp.path, ".opencode", "artifacts", sessionId)
    const derived = path.join(root, "derived", "input-2")
    await fs.mkdir(derived, { recursive: true })
    await fs.mkdir(path.join(root, "python"), { recursive: true })
    const text = "alpha\nhello world\nomega\n"
    const textPath = path.join(derived, "text.txt")
    await Bun.write(textPath, text)

    const input = {
      specVersion: "doc-quote-anchor/1.0",
      policyVersion: "v1",
      quotes: [
        {
          text: "hello world",
          sourcePointer: { path: "derived/input-2/text.txt", sha256: sha256(text) },
        },
        {
          text: "missing quote",
          sourcePointer: { path: "derived/input-2/text.txt", sha256: sha256(text) },
        },
      ],
      topK: 3,
    }
    const inputPath = path.join(root, "python", "input.json")
    const outputPath = path.join(root, "python", "output.json")
    await Bun.write(inputPath, JSON.stringify(input))
    await $`${python} ${script} --input ${inputPath} --output ${outputPath}`.quiet()
    const data = JSON.parse(await Bun.file(outputPath).text())

    expect(data.cacheKey).toBe(sha256(stableJson(input)))
    expect(data.items.length).toBe(2)
    expect(data.items[0].anchors.length).toBeGreaterThan(0)
    expect(data.items[0].anchors[0].anchor.lineStart).toBe(2)
    expect(data.items[0].anchors[0].anchor.lineEnd).toBe(2)
    expect(data.items[1].status).toBe("unknown")
    expect(data.ok).toBe(data.summary.total === data.summary.matched)
  })
})
