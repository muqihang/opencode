import { describe, expect, test } from "bun:test"
import path from "path"
import { PythonTool } from "../../src/tool/python"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { EventV1 } from "../../src/protocol/event"
import { evidenceCandidates, resolveTenantScope } from "../../src/util/tenant-context"

async function eventsPath(sessionId: string) {
  const scope = resolveTenantScope()
  const candidates = evidenceCandidates({
    base: Instance.worktree,
    sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  }).map((dir) => path.join(dir, "events.jsonl"))
  for (const candidate of candidates) {
    const exists = await Bun.file(candidate).exists()
    if (exists) return candidate
  }
  return candidates[0]!
}

const ctx = {
  sessionID: "python_test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

describe("tool.python", () => {
  test("runs built-in script via sandbox", async () => {
    const python = Bun.which("python3")
    if (!python) return

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PythonTool.init()
        const result = await tool.execute(
          {
            script_id: "summarize-json",
            input_json: { ok: true },
            description: "Summarize JSON",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output_artifact).toBeDefined()

        const eventsPathValue = await eventsPath(ctx.sessionID)
        const text = await Bun.file(eventsPathValue).text()
        const types = text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => EventV1.parse(JSON.parse(line)).type)
        expect(types).toContain("tool.started")
        expect(types).toContain("tool.completed")
      },
    })
  })
})
