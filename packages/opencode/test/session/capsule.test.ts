import { describe, expect, test } from "bun:test"
import { Capsule } from "../../src/session/capsule"

const sha = (s: string) => s.repeat(64).slice(0, 64)

describe("capsule", () => {
  test("exports MAX_BYTES and MAX_POINTERS", () => {
    expect(Capsule.MAX_BYTES).toBe(16_000)
    expect(Capsule.MAX_POINTERS).toBeGreaterThan(0)
  })

  test("buildSession sorts pointers deterministically", () => {
    const a = Capsule.buildSession({
      sessionId: "s1",
      generatedAtUtc: "2026-02-03T00:00:00.000Z",
      pointers: [
        { path: "b/file.txt", sha256: sha("b"), kind: "file" },
        { path: "a/file.txt", sha256: sha("a"), kind: "file" },
        { path: "a/file.txt", sha256: sha("c"), kind: "note", anchor: "L10" },
      ],
    })

    expect(a.workingSet.pointers.map((p) => p.path)).toEqual(["a/file.txt", "a/file.txt", "b/file.txt"])
    expect(a.workingSet.pointers.map((p) => p.kind)).toEqual(["file", "note", "file"])
  })

  test("render is stable for the same inputs", () => {
    const first = Capsule.buildSession({
      sessionId: "s1",
      generatedAtUtc: "2026-02-03T00:00:00.000Z",
      pointers: [
        { path: "z.md", sha256: sha("f"), kind: "doc" },
        { path: "a.md", sha256: sha("a"), kind: "doc" },
      ],
      notes: [{ status: "known", value: "note-1" }],
    })

    const second = Capsule.buildSession({
      sessionId: "s1",
      generatedAtUtc: "2026-02-03T00:00:00.000Z",
      pointers: [
        { path: "a.md", sha256: sha("a"), kind: "doc" },
        { path: "z.md", sha256: sha("f"), kind: "doc" },
      ],
      notes: [{ status: "known", value: "note-1" }],
    })

    expect(Capsule.render(first)).toBe(Capsule.render(second))
    expect(Capsule.render(first).includes("# Capsule")).toBe(true)
  })

  test("render truncates pointers stably and annotates (+M more)", () => {
    const total = Capsule.MAX_POINTERS + 20
    const pointers = Array.from({ length: total }, (_, i) => {
      const name = String(i).padStart(6, "0")
      return { path: `p/${name}.txt`, sha256: sha("a"), kind: "file" }
    })

    const a = Capsule.buildSession({
      sessionId: "s1",
      generatedAtUtc: "2026-02-03T00:00:00.000Z",
      pointers,
    })

    const b = Capsule.buildSession({
      sessionId: "s1",
      generatedAtUtc: "2026-02-03T00:00:00.000Z",
      pointers: pointers.slice().reverse(),
    })

    const text = Capsule.render(a)
    expect(Buffer.byteLength(text, "utf-8")).toBeLessThanOrEqual(Capsule.MAX_BYTES)
    expect(text).toBe(Capsule.render(b))
    expect(text.includes("(+")).toBe(true)
    expect(text.includes("more)")).toBe(true)
  })

  test("render degrades under budget without leaking huge notes", () => {
    const pointers = Array.from({ length: 50 }, (_, i) => {
      const name = String(i).padStart(4, "0")
      return { path: `p/${name}.txt`, sha256: sha("b"), kind: "file" }
    })

    const huge = "x".repeat(40_000)
    const session = Capsule.buildSession({
      sessionId: "s1",
      generatedAtUtc: "2026-02-03T00:00:00.000Z",
      pointers,
      notes: [{ status: "known", value: huge }],
    })

    const text = Capsule.render(session)
    expect(Buffer.byteLength(text, "utf-8")).toBeLessThanOrEqual(Capsule.MAX_BYTES)
    expect(text.includes("x".repeat(200))).toBe(false)
  })
})
