import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { PythonTool } from "../../src/tool/python"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionWorktree } from "../../src/worktree/session"
import { EvidenceManifest } from "../../src/protocol/evidence-manifest"
import { tmpdir } from "../fixture/fixture"
import { evidenceCandidates, resolveTenantScope } from "../../src/util/tenant-context"


async function evidenceRoot(sessionId: string) {
  const scope = resolveTenantScope()
  const candidates = evidenceCandidates({
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

const ctx = {
  sessionID: "",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

describe("tool.python workdir policy", () => {
  test("primary shared skips patch capture, child isolated captures patch", async () => {
    const python = Bun.which("python3")
    if (!python) return

    await using tmp = await tmpdir({
      git: true,
      config: {
        workdir: { primary: "shared", child: "isolated" },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PythonTool.init()

        await Bun.write(path.join(tmp.path, "tracked.txt"), "base")
        await $`git add tracked.txt`.cwd(tmp.path).quiet()
        await $`git commit -m "tracked"`.cwd(tmp.path).quiet()

        const primary = await Session.create({})
        const primaryWorkdir = await SessionWorktree.ensure({ sessionId: primary.id })
        await Bun.write(path.join(primaryWorkdir, "tracked.txt"), "dirty")
        await tool.execute(
          {
            script_id: "summarize-json",
            input_json: { ok: true },
            description: "Summarize JSON primary",
          },
          { ...ctx, sessionID: primary.id },
        )
        const primaryEvidence = await evidenceRoot(primary.id)
        const primaryManifest = EvidenceManifest.parse(JSON.parse(await Bun.file(path.join(primaryEvidence, "manifest.json")).text()))
        const primaryPatch = primaryManifest.entries.find((entry) => entry.kind === "worktree-patch")
        expect(primaryPatch).toBeUndefined()

        const child = await Session.create({ parentID: primary.id })
        const childWorkdir = await SessionWorktree.ensure({ sessionId: child.id })
        await Bun.write(path.join(childWorkdir, "tracked.txt"), "dirty")
        await tool.execute(
          {
            script_id: "summarize-json",
            input_json: { ok: true },
            description: "Summarize JSON child",
          },
          { ...ctx, sessionID: child.id },
        )
        const childEvidence = await evidenceRoot(child.id)
        const childManifest = EvidenceManifest.parse(JSON.parse(await Bun.file(path.join(childEvidence, "manifest.json")).text()))
        const childPatch = childManifest.entries.find((entry) => entry.kind === "worktree-patch")
        expect(childPatch).toBeDefined()
      },
    })
  })
})
