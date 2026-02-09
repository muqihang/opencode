import { describe, expect, test } from "bun:test"
import path from "path"
import { PythonTool } from "../../src/tool/python"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { artifactCandidates, resolveTenantScope } from "../../src/util/tenant-context"


async function artifactPath(sessionId: string, rel: string) {
  const scope = resolveTenantScope()
  const candidates = artifactCandidates({
    base: Instance.worktree,
    sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  }).map((root) => path.join(root, rel))
  for (const candidate of candidates) {
    const exists = await Bun.file(candidate).exists()
    if (exists) return candidate
  }
  return candidates[0]!
}

describe("tool.python env evidence", () => {
  test("writes python version artifact", async () => {
    const python = Bun.which("python3")
    if (!python) return
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PythonTool.init()
        const ctx = {
          sessionID: "env",
          messageID: "",
          callID: "",
          agent: "build",
          abort: AbortSignal.any([]),
          metadata: () => {},
          ask: async () => {},
        }
        await tool.execute(
          { script_id: "summarize-json", input_json: { ok: true }, description: "Summarize JSON" },
          ctx,
        )
        const versionPath = await artifactPath("env", path.join("python", "python-version.txt"))
        const exists = await Bun.file(versionPath).exists()
        expect(exists).toBe(true)
      },
    })
  })
})
