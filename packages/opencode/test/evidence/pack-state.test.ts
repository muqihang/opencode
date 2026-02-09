import { describe, expect, test } from "bun:test"
import path from "path"
import { EvidenceWriter } from "../../src/evidence/writer"
import { EvidencePack } from "../../src/protocol/evidence-pack"
import { EvidenceMicroPack } from "../../src/protocol/evidence-micro-pack"
import { Instance } from "../../src/project/instance"
import { evidenceCandidates, resolveTenantScope } from "../../src/util/tenant-context"
import { tmpdir } from "../fixture/fixture"

describe("evidence.pack state", () => {
  test("persists checks/claims/risks/rollback across packs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "state" })

        await writer.claim({
          id: "claim:1",
          type: "behavior",
          statement: "writes evidence packs",
          evidence: ["worktree/changes.patch"],
        })
        await writer.check({
          id: "check:lint",
          command: "echo lint",
          status: "pass",
          artifact: "gate/lint.log.txt",
        })
        await writer.risk({
          summary: "example risk",
          evidence: ["gate/lint.log.txt"],
        })
        await writer.rollback({
          strategy: "manual",
          steps: ["revert commit"],
        })

        await writer.pack({ handoff: "first" })

        const scope = resolveTenantScope()
        const candidates = evidenceCandidates({
          base: Instance.worktree,
          sessionId: "state",
          tenantId: scope.tenantId,
          orgId: scope.orgId,
        }).map((dir) => path.join(dir, "pack.json"))
        const packPath = await (async () => {
          for (const candidate of candidates) {
            const exists = await Bun.file(candidate).exists()
            if (exists) return candidate
          }
          return candidates[0]!
        })()
        const firstPack = EvidencePack.parse(JSON.parse(await Bun.file(packPath).text()))
        expect(firstPack.claims.length).toBe(1)
        expect(firstPack.checks.length).toBe(1)
        expect(firstPack.risks.length).toBe(1)
        expect(firstPack.rollback.strategy).toBe("manual")

        const writer2 = await EvidenceWriter.open({ sessionId: "state" })
        const micro = await writer2.microPack({ parentSessionId: "parent" })
        EvidenceMicroPack.parse(micro)
        expect(micro.claims.length).toBe(1)
        expect(micro.checks.length).toBe(1)

        await writer2.pack({ handoff: "second" })
        const secondPack = EvidencePack.parse(JSON.parse(await Bun.file(packPath).text()))
        expect(secondPack.claims.length).toBe(1)
        expect(secondPack.checks.length).toBe(1)
        expect(secondPack.risks.length).toBe(1)
        expect(secondPack.rollback.strategy).toBe("manual")
      },
    })
  })
})
