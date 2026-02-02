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

describe("toolbelt.redaction-scan", () => {
  test("finds pii without leaking raw value", async () => {
    const python = Bun.which("python3")
    if (!python) return
    const script = path.join(__dirname, "../../src/python/scripts/redaction-scan.py")
    await using tmp = await tmpdir({})
    const sessionId = "session-4"
    const root = path.join(tmp.path, ".opencode", "artifacts", sessionId)
    const derived = path.join(root, "derived", "input-4")
    await fs.mkdir(derived, { recursive: true })
    await fs.mkdir(path.join(root, "python"), { recursive: true })
    const textPath = path.join(derived, "pii.txt")
    const text = "email test@example.com ok"
    await Bun.write(textPath, text)

    const input = {
      specVersion: "redaction-scan/1.0",
      policyVersion: "v1",
      pointers: [{ path: "derived/input-4/pii.txt" }],
      rules: { pii: true, secrets: true },
    }
    const inputPath = path.join(root, "python", "input.json")
    const outputPath = path.join(root, "python", "output.json")
    await Bun.write(inputPath, JSON.stringify(input))
    await $`${python} ${script} --input ${inputPath} --output ${outputPath}`.quiet()
    const data = JSON.parse(await Bun.file(outputPath).text())
    expect(data.cacheKey).toBe(sha256(stableJson(input)))
    expect(data.findings.length).toBeGreaterThan(0)
    expect(data.findings[0].sample_redacted).not.toContain("test@example.com")
    expect(data.ok).toBe(data.summary.high === 0)
  })
})
