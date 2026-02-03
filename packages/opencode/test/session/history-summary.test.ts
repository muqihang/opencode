import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionHistorySummary } from "../../src/session/history-summary"

const sessionID = "session_history_summary"

function basePart(messageID: string, id: string) {
  return {
    id,
    sessionID,
    messageID,
  }
}

function userInfo(id: string): MessageV2.User {
  return {
    id,
    sessionID,
    role: "user",
    time: { created: 0 },
    agent: "user",
    model: { providerID: "test", modelID: "test" },
    tools: {},
    mode: "",
  } as unknown as MessageV2.User
}

function assistantInfo(id: string, parentID: string, summary?: boolean): MessageV2.Assistant {
  return {
    id,
    sessionID,
    role: "assistant",
    time: { created: 0 },
    parentID,
    providerID: "test",
    modelID: "test",
    mode: "",
    agent: "agent",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    summary: summary === true,
  } as unknown as MessageV2.Assistant
}

function textMsg(info: MessageV2.User | MessageV2.Assistant, text: string): MessageV2.WithParts {
  const messageID = info.id
  return {
    info,
    parts: [
      {
        ...basePart(messageID, `p-${messageID}`),
        type: "text",
        text,
      },
    ] as MessageV2.Part[],
  }
}

describe("session.history-summary", () => {
  test("preferredText wins over existing summary message and appends handoffText", () => {
    const messages: MessageV2.WithParts[] = [
      textMsg(userInfo("m-user"), "hello"),
      textMsg(assistantInfo("m-summary", "m-user", true), "existing summary"),
    ]

    const built = SessionHistorySummary.build({
      messages,
      preferredText: "preferred capsule",
      handoffText: "handoff hints",
    })

    expect(built.kind).toBe("preferred")
    expect(built.text?.includes("preferred capsule")).toBe(true)
    expect(built.text?.includes("existing summary")).toBe(false)
    expect(built.text?.includes("handoff hints")).toBe(true)
  })

  test("falls back to summary message when preferredText is empty", () => {
    const messages: MessageV2.WithParts[] = [
      textMsg(userInfo("m-user"), "hello"),
      textMsg(assistantInfo("m-summary", "m-user", true), "existing summary"),
    ]

    const built = SessionHistorySummary.build({ messages })
    expect(built.kind).toBe("summary")
    expect(built.text).toBe("existing summary")
  })

  test("appends handoffText within MAX_BYTES budget", () => {
    const messages: MessageV2.WithParts[] = [textMsg(userInfo("m-user"), "hello")]

    const preferred = "a".repeat(SessionHistorySummary.MAX_BYTES + 10)
    const built = SessionHistorySummary.build({
      messages,
      preferredText: preferred,
      handoffText: "handoff",
    })

    const bytes = Buffer.byteLength(built.text ?? "", "utf-8")
    expect(bytes <= SessionHistorySummary.MAX_BYTES).toBe(true)
    expect(built.kind).toBe("preferred")
  })
})

