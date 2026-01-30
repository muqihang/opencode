import { $ } from "bun"
import path from "path"
import z from "zod"

const FileEntry = z
  .object({
    path: z.string().min(1),
    sha256: z.string().min(1),
    size: z.number().int().nonnegative().optional(),
  })
  .strict()

export const WorktreeChangeSet = z
  .object({
    specVersion: z.literal("worktree-changeset/1.0"),
    sessionId: z.string().min(1),
    workdir: z.string().min(1),
    baseCommit: z.string(),
    dirtyFingerprint: z.string(),
    files: z
      .object({
        added: z.array(FileEntry),
        modified: z.array(FileEntry),
        deleted: z.array(FileEntry),
      })
      .strict(),
  })
  .strict()

export type WorktreeChangeSet = z.infer<typeof WorktreeChangeSet>

function sha(input: ArrayBuffer | string) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(input)
  return hash.digest("hex")
}

function list(text: string | undefined) {
  return (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

async function fileEntry(input: { workdir: string; file: string }) {
  const target = path.join(input.workdir, input.file)
  const file = Bun.file(target)
  const exists = await file.exists()
  if (!exists) {
    return FileEntry.parse({
      path: input.file,
      sha256: sha(""),
      size: 0,
    })
  }
  const data = await file.arrayBuffer()
  return FileEntry.parse({
    path: input.file,
    sha256: sha(data),
    size: file.size,
  })
}

export async function createWorktreeChangeSet(input: {
  workdir: string
  sessionId: string
  patch: string
}): Promise<WorktreeChangeSet> {
  const head = await $`git rev-parse HEAD`.quiet().nothrow().cwd(input.workdir)
  const baseCommit = head.exitCode === 0 ? head.stdout?.toString().trim() ?? "" : ""

  const diff = await $`git diff --name-only`.quiet().nothrow().cwd(input.workdir)
  const diffCached = await $`git diff --name-only --cached`.quiet().nothrow().cwd(input.workdir)
  const addedDiff = await $`git diff --name-only --diff-filter=A`.quiet().nothrow().cwd(input.workdir)
  const addedCached = await $`git diff --name-only --cached --diff-filter=A`
    .quiet()
    .nothrow()
    .cwd(input.workdir)
  const deletedDiff = await $`git diff --name-only --diff-filter=D`.quiet().nothrow().cwd(input.workdir)
  const deletedCached = await $`git diff --name-only --cached --diff-filter=D`
    .quiet()
    .nothrow()
    .cwd(input.workdir)
  const untracked = await $`git ls-files --others --exclude-standard`
    .quiet()
    .nothrow()
    .cwd(input.workdir)

  const addedSet = new Set([
    ...list(addedDiff.stdout?.toString()),
    ...list(addedCached.stdout?.toString()),
    ...list(untracked.stdout?.toString()),
  ])
  const deletedSet = new Set([
    ...list(deletedDiff.stdout?.toString()),
    ...list(deletedCached.stdout?.toString()),
  ])
  const modifiedSet = new Set([
    ...list(diff.stdout?.toString()),
    ...list(diffCached.stdout?.toString()),
  ])

  const modified = Array.from(modifiedSet)
    .filter((name) => !addedSet.has(name))
    .filter((name) => !deletedSet.has(name))
    .sort()
  const added = Array.from(addedSet).sort()
  const deleted = Array.from(deletedSet).sort()

  const addedEntries = await Promise.all(added.map((file) => fileEntry({ workdir: input.workdir, file })))
  const modifiedEntries = await Promise.all(
    modified.map((file) => fileEntry({ workdir: input.workdir, file })),
  )
  const deletedEntries = await Promise.all(
    deleted.map((file) => fileEntry({ workdir: input.workdir, file })),
  )

  return WorktreeChangeSet.parse({
    specVersion: "worktree-changeset/1.0",
    sessionId: input.sessionId,
    workdir: input.workdir,
    baseCommit,
    dirtyFingerprint: sha(input.patch),
    files: {
      added: addedEntries,
      modified: modifiedEntries,
      deleted: deletedEntries,
    },
  })
}
