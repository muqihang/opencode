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

describe("toolbelt.citation-check", () => {
  test("emits stable output + cacheKey + sorted items", async () => {
    const python = Bun.which("python3")
    if (!python) return
    const script = path.join(__dirname, "../../src/python/scripts/citation-check.py")
    await using tmp = await tmpdir({})
    const sessionId = "session-1"
    const root = path.join(tmp.path, ".opencode", "artifacts", sessionId)
    const derived = path.join(root, "derived", "input-1")
    await fs.mkdir(derived, { recursive: true })
    await fs.mkdir(path.join(root, "python"), { recursive: true })

    const okPath = path.join(derived, "a.txt")
    const hashPath = path.join(derived, "c.txt")
    const anchorPath = path.join(derived, "d.txt")
    const unknownPath = path.join(derived, "e.txt")

    await Bun.write(okPath, "hello\nworld\n")
    await Bun.write(hashPath, "goodbye\n")
    await Bun.write(anchorPath, "alpha\n")
    await Bun.write(unknownPath, "beta\n")

    const okSha = sha256(await Bun.file(okPath).text())
    const badSha = sha256("mismatch")

    const input = {
      specVersion: "citation-check/1.0",
      policyVersion: "v1",
      pointers: [
        { path: "derived/input-1/a.txt", sha256: okSha, anchor: { lineStart: 1, lineEnd: 1 } },
        { path: "derived/input-1/b.txt", sha256: okSha },
        { path: "derived/input-1/c.txt", sha256: badSha },
        { path: "derived/input-1/d.txt", sha256: okSha, anchor: { lineStart: 5, lineEnd: 6 } },
        { path: "derived/input-1/e.txt", sha256: okSha, anchor: { foo: "bar" } },
        { path: "derived/input-1/../evil.txt", sha256: okSha },
      ],
    }

    const inputPath = path.join(root, "python", "input.json")
    const outputPath = path.join(root, "python", "output.json")
    await Bun.write(inputPath, JSON.stringify(input))
    await $`${python} ${script} --input ${inputPath} --output ${outputPath}`.quiet()
    const data = JSON.parse(await Bun.file(outputPath).text())

    expect(data.specVersion).toBe("citation-check/1.0")
    expect(data.policyVersion).toBe("v1")
    expect(data.cacheKey).toBe(sha256(stableJson(input)))
    expect(Array.isArray(data.items)).toBe(true)
    const paths = data.items.map((item: { pointer: { path: string } }) => item.pointer.path)
    const sorted = [...paths].sort()
    expect(paths).toEqual(sorted)
    expect(data.summary.total).toBe(6)
    expect(data.ok).toBe(data.summary.total === data.summary.ok)
  })
})
