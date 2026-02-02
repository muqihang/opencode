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

describe("toolbelt.table-check", () => {
  test("computes expr with Decimal and detects mismatch", async () => {
    const python = Bun.which("python3")
    if (!python) return
    const script = path.join(__dirname, "../../src/python/scripts/table-check.py")
    await using tmp = await tmpdir({})
    const sessionId = "session-3"
    const root = path.join(tmp.path, ".opencode", "artifacts", sessionId)
    const derived = path.join(root, "derived", "input-3")
    await fs.mkdir(derived, { recursive: true })
    await fs.mkdir(path.join(root, "python"), { recursive: true })
    const textPath = path.join(derived, "numbers.txt")
    await Bun.write(textPath, "10\n20\n")
    const input = {
      specVersion: "table-check/1.0",
      policyVersion: "v1",
      cases: [
        {
          title: "sum",
          inputs: [{ pointer: { path: "derived/input-3/numbers.txt" } }],
          checks: [{ kind: "expr", expr: "input0 * 2", expected: "50" }],
        },
      ],
    }
    const inputPath = path.join(root, "python", "input.json")
    const outputPath = path.join(root, "python", "output.json")
    await Bun.write(inputPath, JSON.stringify(input))
    await $`${python} ${script} --input ${inputPath} --output ${outputPath}`.quiet()
    const data = JSON.parse(await Bun.file(outputPath).text())
    expect(data.cacheKey).toBe(sha256(stableJson(input)))
    expect(data.summary.mismatches).toBe(1)
    expect(data.ok).toBe(data.summary.mismatches === 0)
  })
})
