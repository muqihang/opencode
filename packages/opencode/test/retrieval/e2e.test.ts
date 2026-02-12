import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { $ } from "bun"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { runRetrieval } from "../../src/retrieval/runner"
import { artifactCandidates, resolveTenantScope } from "../../src/util/tenant-context"


async function artifactRoot(sessionId: string) {
  const scope = resolveTenantScope()
  const candidates = artifactCandidates({
    base: Instance.worktree,
    sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  })
  for (const candidate of candidates) {
    const exists = await Bun.file(candidate).exists()
    if (exists) return candidate
  }
  return candidates[0]!
}

test("retrieval outputs pointers compatible with citation-check", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await fs.mkdir(path.join(dir, "src"), { recursive: true })
      await Bun.write(path.join(dir, "src", "alpha.ts"), "export const alpha = 1\n")
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const run = await runRetrieval({
        sessionId: "session_e2e",
        messageId: "msg_e2e",
        intentText: "alpha",
        abort: new AbortController().signal,
      })

      expect(run.evidencePointers.topK.length).toBeGreaterThan(0)

      const first = run.evidencePointers.topK[0]?.path ?? ""
      const root = first.startsWith(".opencode/") ? Instance.worktree : await artifactRoot("session_e2e")
      const pythonDir = path.join(root, "python")
      await fs.mkdir(pythonDir, { recursive: true })

      const inputPath = path.join(pythonDir, "input.json")
      const outputPath = path.join(pythonDir, "output.json")
      await Bun.write(
        inputPath,
        JSON.stringify({
          specVersion: "citation-check/1.0",
          policyVersion: "v1",
          pointers: run.evidencePointers.topK,
        }),
      )

      const python = Bun.which("python3")
      if (!python) return
      const script = path.join(__dirname, "../../src/python/scripts/citation-check.py")
      await $`${python} ${script} --input ${inputPath} --output ${outputPath}`.quiet()
      const out = JSON.parse(await Bun.file(outputPath).text())
      expect(out.ok).toBe(true)
    },
  })
}, { timeout: 20000 })
