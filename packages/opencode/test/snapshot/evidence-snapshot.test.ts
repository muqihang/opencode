import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { SessionRevert } from "../../src/session/revert"
import { MessageV2 } from "../../src/session/message-v2"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Identifier } from "../../src/id/id"
import { Snapshot } from "../../src/snapshot"
import { EventV1 } from "../../src/protocol/event"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function expectString(value: unknown): asserts value is string {
  expect(value).toBeTypeOf("string")
}

describe("snapshot.evidence", () => {
  test("revert emits snapshot evidence events and artifacts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "note.txt")
        await Bun.write(filePath, "hello")
        const baseSnapshot = await Snapshot.track()
        expect(baseSnapshot).toBeDefined()
        await Bun.write(filePath, "hello world")
        const patch = await Snapshot.patch(baseSnapshot!)
        expect(patch.files.length).toBeGreaterThan(0)

        const session = await Session.create({})
        const sessionID = session.id

        const userMsg = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID,
          agent: "default",
          model: {
            providerID: "openai",
            modelID: "gpt-4",
          },
          time: {
            created: Date.now(),
          },
        })

        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: userMsg.id,
          sessionID,
          type: "text",
          text: "please revert",
        })

        const assistantMsg: MessageV2.Assistant = {
          id: Identifier.ascending("message"),
          role: "assistant",
          sessionID,
          mode: "default",
          agent: "default",
          path: {
            cwd: tmp.path,
            root: tmp.path,
          },
          cost: 0,
          tokens: {
            output: 0,
            input: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: "gpt-4",
          providerID: "openai",
          parentID: userMsg.id,
          time: {
            created: Date.now(),
          },
          finish: "end_turn",
        }

        await Session.updateMessage(assistantMsg)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: assistantMsg.id,
          sessionID,
          type: "patch",
          hash: patch.hash,
          files: patch.files,
        })

        await SessionRevert.revert({
          sessionID,
          messageID: userMsg.id,
        })

        const eventsPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          sessionID,
          "events.jsonl",
        )
        const eventsText = await Bun.file(eventsPath).text()
        const events = eventsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => EventV1.parse(JSON.parse(line)))

        const created = events.find((event) => event.type === "snapshot.created")
        const reverted = events.find((event) => event.type === "snapshot.reverted")
        expect(created).toBeDefined()
        expect(reverted).toBeDefined()

        const createdData = created?.data as Record<string, unknown> | undefined
        const revertedData = reverted?.data as Record<string, unknown> | undefined
        const createdSnapshot = createdData?.snapshot
        const revertedSnapshot = revertedData?.snapshot
        const createdArtifact = createdData?.files_artifact
        const revertedArtifact = revertedData?.files_artifact
        expectString(createdSnapshot)
        expectString(revertedSnapshot)
        expectString(createdArtifact)
        expectString(revertedArtifact)

        const createdArtifactPath = path.join(Instance.worktree, createdArtifact)
        const revertedArtifactPath = path.join(Instance.worktree, revertedArtifact)
        expect(await Bun.file(createdArtifactPath).exists()).toBe(true)
        expect(await Bun.file(revertedArtifactPath).exists()).toBe(true)

        const createdArtifactJson = JSON.parse(await Bun.file(createdArtifactPath).text()) as {
          snapshot: string
          files: string[]
        }
        const revertedArtifactJson = JSON.parse(await Bun.file(revertedArtifactPath).text()) as {
	          snapshot: string
	          files: string[]
	        }
	        expect(createdArtifactJson.snapshot).toBe(createdSnapshot)
	        expect(revertedArtifactJson.snapshot).toBe(revertedSnapshot)
	        expect(createdArtifactJson.files).toContain("note.txt")
	        expect(revertedArtifactJson.files).toContain("note.txt")

        await Session.remove(sessionID)
      },
    })
  })
})
