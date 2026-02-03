import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { CapsuleAssistedVerifier } from "../../src/session/capsule-assisted-verifier"

const sha256Text = (text: string) => {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(text)
  return hash.digest("hex")
}

describe("capsule.assisted.verifier", () => {
  test("accepts a known item when evidence exists and sha matches", async () => {
    await using tmp = await tmpdir({ git: true })
    const baseDir = tmp.path

    const body = "hello\n"
    await Bun.write(path.join(baseDir, "a.txt"), body)

    const result = await CapsuleAssistedVerifier.verify({
      baseDir,
      budget: { maxBytes: 8_000, maxItems: 10, maxAnchors: 10 },
      anchors: [{ path: "a.txt", sha256: sha256Text(body), kind: "file" }],
      items: [{ type: "decision", status: "known", text: "Use a.txt as the single source", evidenceIndices: [0] }],
    })

    expect(result.ok).toBe(true)
    expect(result.coverage.known).toBe(1)
    expect(result.items[0]?.status).toBe("known")
    expect(result.failures.length).toBe(0)
  })

  test("downgrades known items without evidence to unknown", async () => {
    await using tmp = await tmpdir({ git: true })
    const baseDir = tmp.path

    const body = "hello\n"
    await Bun.write(path.join(baseDir, "a.txt"), body)

    const result = await CapsuleAssistedVerifier.verify({
      baseDir,
      budget: { maxBytes: 8_000, maxItems: 10, maxAnchors: 10 },
      anchors: [{ path: "a.txt", sha256: sha256Text(body), kind: "file" }],
      items: [{ type: "decision", status: "known", text: "This must be verified", evidenceIndices: [] }],
    })

    expect(result.ok).toBe(false)
    expect(result.coverage.known).toBe(0)
    expect(result.items[0]?.status).toBe("unknown")
    expect(result.failures.some((f) => f.code === "ref_unresolvable")).toBe(true)
  })

  test("downgrades items when sha mismatches", async () => {
    await using tmp = await tmpdir({ git: true })
    const baseDir = tmp.path

    const body = "hello\n"
    await Bun.write(path.join(baseDir, "a.txt"), body)

    const result = await CapsuleAssistedVerifier.verify({
      baseDir,
      budget: { maxBytes: 8_000, maxItems: 10, maxAnchors: 10 },
      anchors: [{ path: "a.txt", sha256: sha256Text("wrong\n"), kind: "file" }],
      items: [{ type: "question", status: "known", text: "Is a.txt updated?", evidenceIndices: [0] }],
    })

    expect(result.ok).toBe(false)
    expect(result.coverage.known).toBe(0)
    expect(result.items[0]?.status).toBe("unknown")
    expect(result.failures.some((f) => f.code === "sha_mismatch")).toBe(true)
  })

  test("downgrades items that look unsafe (code blocks)", async () => {
    await using tmp = await tmpdir({ git: true })
    const baseDir = tmp.path

    const body = "hello\n"
    await Bun.write(path.join(baseDir, "a.txt"), body)

    const result = await CapsuleAssistedVerifier.verify({
      baseDir,
      budget: { maxBytes: 8_000, maxItems: 10, maxAnchors: 10 },
      anchors: [{ path: "a.txt", sha256: sha256Text(body), kind: "file" }],
      items: [{ type: "decision", status: "known", text: "```rm -rf /```", evidenceIndices: [0] }],
    })

    expect(result.ok).toBe(false)
    expect(result.items[0]?.status).toBe("unknown")
    expect(result.failures.some((f) => f.code === "content_unsafe")).toBe(true)
  })
})

