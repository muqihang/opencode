import { describe, expect, test } from "bun:test"
import { AssistantClaims } from "../../src/protocol/assistant-claims"

describe("protocol.assistant-claims", () => {
  test("parses valid fact claims with pointers (path+sha256+anchor)", () => {
    const parsed = AssistantClaims.safeParse({
      specVersion: "assistant-claims/1.0",
      policyVersion: "v1",
      claims: [
        {
          id: "c1",
          kind: "fact",
          text: "repo has a plan doc",
          pointers: [
            {
              path: "context/ctx-1/blocks/block_capsule.json",
              sha256: "0".repeat(64),
              anchor: { lineStart: 1, lineEnd: 1 },
            },
          ],
        },
      ],
    })
    expect(parsed.success).toBe(true)
  })

  test("rejects unknown top-level fields (strict schema)", () => {
    const parsed = AssistantClaims.safeParse({
      specVersion: "assistant-claims/1.0",
      policyVersion: "v1",
      claims: [],
      extra: "nope",
    })
    expect(parsed.success).toBe(false)
  })

  test("rejects fact claim without pointers", () => {
    const parsed = AssistantClaims.safeParse({
      specVersion: "assistant-claims/1.0",
      policyVersion: "v1",
      claims: [{ id: "c2", kind: "fact", text: "something", pointers: [] }],
    })
    expect(parsed.success).toBe(false)
  })

  test("allows plan/opinion claims without citations but requires explicit kind", () => {
    const plan = AssistantClaims.safeParse({
      specVersion: "assistant-claims/1.0",
      policyVersion: "v1",
      claims: [{ id: "c3", kind: "plan", text: "next we will run tests", pointers: [] }],
    })
    expect(plan.success).toBe(true)

    const opinion = AssistantClaims.safeParse({
      specVersion: "assistant-claims/1.0",
      policyVersion: "v1",
      claims: [{ id: "c4", kind: "opinion", text: "this might be risky", pointers: [] }],
    })
    expect(opinion.success).toBe(true)
  })
})

