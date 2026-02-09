import { expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { EvidenceWriter } from "../../src/evidence/writer"
import { EvidencePack } from "../../src/protocol/evidence-pack"
import { evidenceCandidates, resolveTenantScope } from "../../src/util/tenant-context"

test("evidence.writer > capsule pointers are persisted in pack", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionId = "capsule-test"
      const writer = await EvidenceWriter.open({ sessionId })
      const entry = await writer.artifact({ kind: "eval-note", path: "eval/note.txt", data: "hello\n" })

      writer.capsule({
        pointers: [{ kind: "artifact", ref: entry.path, label: "note" }],
        openQuestions: [],
      })

      await writer.pack({ handoff: "EVAL: capsule pointers" })

      const scope = resolveTenantScope()
      const candidates = evidenceCandidates({
        base: Instance.worktree,
        sessionId,
        tenantId: scope.tenantId,
        orgId: scope.orgId,
      }).map((dir) => path.join(dir, "pack.json"))
      const file = await (async () => {
        for (const candidate of candidates) {
          const exists = await Bun.file(candidate).exists()
          if (exists) return candidate
        }
        return candidates[0]!
      })()
      const pack = EvidencePack.parse(await Bun.file(file).json())

      expect(pack.capsule.handoff).toBe("EVAL: capsule pointers")
      expect(pack.capsule.pointers).toEqual([{ kind: "artifact", ref: entry.path, label: "note" }])
    },
  })
})

