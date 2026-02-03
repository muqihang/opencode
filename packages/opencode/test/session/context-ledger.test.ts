import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { ContextLedger } from "../../src/session/context-ledger"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("session.context-ledger", () => {
  test("persists lastContextPackId per session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = await ContextLedger.read("session_test")
        expect(first.lastContextPackId).toBeUndefined()

        await ContextLedger.write({ sessionId: "session_test", lastContextPackId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" })
        const second = await ContextLedger.read("session_test")
        expect(second.lastContextPackId).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV")
      },
    })
  })
})

