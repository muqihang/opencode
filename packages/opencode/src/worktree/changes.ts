import { $ } from "bun"
import { EventV1 } from "@/protocol/event"
import { stableJson } from "@/util/stable-json"
import { createWorktreeChangeSet } from "@/worktree/changeset"

type Writer = {
  artifact: (input: { kind: string; path?: string; data: string }) => Promise<{
    path: string
    sha256: string
    kind: string
    size?: number
  }>
  event: (input: EventV1) => Promise<void>
}

export async function captureWorktreePatch(input: {
  workdir: string
  sessionId: string
  writer: Writer
}) {
  const diff = await $`git diff --patch --no-color`.quiet().nothrow().cwd(input.workdir)
  if (diff.exitCode > 1) return
  let patch = diff.stdout?.toString() ?? ""

  const staged = await $`git diff --patch --no-color --cached`.quiet().nothrow().cwd(input.workdir)
  if (staged.exitCode <= 1) {
    patch += staged.stdout?.toString() ?? ""
  }

  const untracked = await $`git ls-files --others --exclude-standard`
    .quiet()
    .nothrow()
    .cwd(input.workdir)
  if (untracked.exitCode === 0) {
    const files = untracked.stdout
      ?.toString()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    for (const file of files ?? []) {
      const add = await $`git diff --patch --no-color --no-index /dev/null ${file}`
        .quiet()
        .nothrow()
        .cwd(input.workdir)
      if (add.exitCode <= 1) {
        patch += add.stdout?.toString() ?? ""
      }
    }
  }
  if (!patch.trim()) return

  const entry = await input.writer.artifact({
    kind: "worktree-patch",
    path: "worktree/changes.patch",
    data: patch,
  })
  const changeset = await createWorktreeChangeSet({
    workdir: input.workdir,
    sessionId: input.sessionId,
    patch,
  })
  const changesEntry = await input.writer.artifact({
    kind: "worktree-changeset",
    path: "worktree/changes.json",
    data: stableJson(changeset),
  })

  await input.writer.event({
    specVersion: "event/1.0",
    ts: new Date().toISOString(),
    sessionId: input.sessionId,
    severity: "info",
    actor: "worktree:changes",
    type: "worktree.patch_captured",
    summary: "worktree patch captured",
    data: {
      artifact: entry.path,
      sha256: entry.sha256,
    },
    redaction: { applied: true, policyVersion: "v1" },
  })

  await input.writer.event({
    specVersion: "event/1.0",
    ts: new Date().toISOString(),
    sessionId: input.sessionId,
    severity: "info",
    actor: "worktree:changes",
    type: "worktree.changeset_captured",
    summary: "worktree changeset captured",
    data: {
      artifact: changesEntry.path,
      sha256: changesEntry.sha256,
    },
    redaction: { applied: true, policyVersion: "v1" },
  })
}
