import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { runWorkbenchRetrieval } from "../../src/retrieval/workbench"

test("workbench retrieval emits pointers for pdf/docx/chunks/archive", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionId = "session_wb"
      const inputId = "input-1"
      const derived = path.join(
        Instance.worktree,
        ".opencode",
        "artifacts",
        sessionId,
        "derived",
        inputId,
      )
      await fs.mkdir(path.join(derived, "pages"), { recursive: true })
      await fs.mkdir(path.join(derived, "unpacked"), { recursive: true })

      await Bun.write(path.join(derived, "chunks.json"), JSON.stringify([{ chunk_index: 0 }]))
      await Bun.write(path.join(derived, "docx.structure.json"), JSON.stringify({ paragraphCount: 1 }))
      await Bun.write(
        path.join(derived, "pdf.pages.json"),
        JSON.stringify({ pages: [{ page_number: 1, text_path: "pages/1.txt" }] }),
      )
      await Bun.write(path.join(derived, "pages/1.txt"), "hello\n")
      await Bun.write(path.join(derived, "unpacked/filelist.json"), JSON.stringify({ files: [] }))

      const hits = await runWorkbenchRetrieval({
        sessionId,
        inputId,
        derivedRoot: derived,
        retrievalId: "retrieval-wb",
      })

      expect(hits.length).toBeGreaterThan(0)
      expect(hits.some((hit) => hit.pointer.path.endsWith("pdf.pages.json"))).toBe(true)
      expect(hits.some((hit) => hit.pointer.path.endsWith("docx.structure.json"))).toBe(true)
      expect(hits.some((hit) => hit.pointer.path.endsWith("chunks.json"))).toBe(true)
      expect(hits.some((hit) => hit.pointer.path.endsWith("unpacked/filelist.json"))).toBe(true)
    },
  })
})
