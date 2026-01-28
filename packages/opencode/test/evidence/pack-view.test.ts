import { describe, expect, test } from "bun:test"
import { renderEvidencePackViewMarkdown } from "../../src/evidence/pack-view"

describe("evidence.pack-view", () => {
  test("renders a short view with pointers", () => {
    const md = renderEvidencePackViewMarkdown({
      sessionId: "session_test",
      packId: "EP-session_test",
      enforcement: "soft",
      backend: "soft",
      pointers: [
        {
          kind: "event-log",
          path: ".opencode/evidence/session_test/events.jsonl",
          sha256: "a".repeat(64),
        },
        {
          kind: "stdout",
          path: ".opencode/artifacts/session_test/stdout.txt",
          sha256: "b".repeat(64),
        },
      ],
    })
    expect(md).toContain("# Evidence Pack")
    expect(md).toContain("session_test")
    expect(md).toContain("backend: soft")
    expect(md).toContain(".opencode/evidence/session_test/events.jsonl")
  })
})
