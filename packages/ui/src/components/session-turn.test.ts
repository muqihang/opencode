import { describe, expect, test } from "bun:test"
import { AssistantMessage, Part as PartType } from "@opencode-ai/sdk/v2/client"
import { selectResponsePart } from "./session-turn-response"

const assistant = (id: string, mode: string) =>
  ({
    id,
    mode,
  }) as unknown as AssistantMessage

const text = (id: string, value: string) => ({
  id,
  type: "text",
  text: value,
}) as unknown as PartType

describe("session-turn response selection", () => {
  test("keeps primary assistant response when compaction assistant exists", () => {
    const part = selectResponsePart({
      messages: [assistant("msg_primary", "default"), assistant("msg_compaction", "compaction")],
      parts: {
        msg_primary: [text("part_primary", "Primary assistant delivery")],
        msg_compaction: [text("part_compaction", "# Compaction Summary")],
      },
    })

    expect(part?.id).toBe("part_primary")
    expect(part?.text).toBe("Primary assistant delivery")
  })

  test("returns undefined when no non-compaction assistant response exists", () => {
    const part = selectResponsePart({
      messages: [assistant("msg_compaction", "compaction")],
      parts: {
        msg_compaction: [text("part_compaction", "# Compaction Summary")],
      },
    })

    expect(part).toBeUndefined()
  })
})
