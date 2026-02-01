import { describe, expect, test } from "bun:test"
import { childSessions, subtasksCount } from "./subtasks"

describe("session.subtasks", () => {
  test("childSessions filters by parentID", () => {
    const sessions = [
      { id: "p" },
      { id: "c1", parentID: "p", title: "a" },
      { id: "c2", parentID: "p", title: "b" },
      { id: "c3", parentID: "x", title: "c" },
    ]

    const children = childSessions(sessions, "p")
    expect(children.map((s) => s.id)).toEqual(["c1", "c2"])
  })

  test("subtasksCount counts running from session_status", () => {
    const children = [{ id: "c1" }, { id: "c2" }, { id: "c3" }]
    const status = {
      c1: { type: "busy" },
      c2: { type: "idle" },
    }

    expect(subtasksCount(children, status)).toEqual({ running: 1, total: 3 })
  })
})

