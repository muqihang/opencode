import { describe, expect, test } from "bun:test"
import { Capsule } from "../../src/session/capsule"

const sha = (s: string) => s.repeat(64).slice(0, 64)

describe("capsule", () => {
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
})
