import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { GateRunner } from "../../src/gate/gate"
import { EvidenceWriter } from "../../src/evidence/writer"
import { EvidencePack } from "../../src/protocol/evidence-pack"
import { Instance } from "../../src/project/instance"
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

describe("gate.runner", () => {
  test("runs gates and records checks", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "gate_session"
        const filePath = path.join(tmp.path, "file.txt")
        await Bun.write(filePath, "ok")
        await $`git add file.txt`.cwd(tmp.path).quiet()
        await $`git commit -m "base"`.cwd(tmp.path).quiet()

        const result = await GateRunner.run({
          sessionId,
          workdir: tmp.path,
          changedFiles: ["file.txt"],
          lint: true,
          diffCheck: true,
        })

        expect(result.checks.length).toBeGreaterThan(0)
        for (const artifact of result.artifacts) {
          const absolute = path.join(Instance.worktree, artifact)
          expect(await Bun.file(absolute).exists()).toBe(true)
        }

        const writer = await EvidenceWriter.open({ sessionId })
        await writer.pack({ handoff: "gate" })

        const evidenceDir = await evidenceRoot(sessionId)
        const pack = EvidencePack.parse(JSON.parse(await Bun.file(path.join(evidenceDir, "pack.json")).text()))
        expect(pack.checks.length).toBeGreaterThan(0)
      },
    })
  })
})
