import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { GateRunner } from "../../src/gate/gate"
import { EvidenceWriter } from "../../src/evidence/writer"
import { EvidencePack } from "../../src/protocol/evidence-pack"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

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

        const packPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          sessionId,
          "pack.json",
        )
        const pack = EvidencePack.parse(JSON.parse(await Bun.file(packPath).text()))
        expect(pack.checks.length).toBeGreaterThan(0)
      },
    })
  })
})
