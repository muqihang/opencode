import fs from "fs/promises"
import path from "path"
import { $ } from "bun"
import z from "zod"
import { Instance } from "@/project/instance"

const EnsureInput = z
  .object({
    sessionId: z.string().min(1),
  })
  .strict()

export const SessionWorktree = {
  async ensure(input: z.infer<typeof EnsureInput>) {
    const data = EnsureInput.parse(input)
    if (Instance.project.vcs !== "git") {
      throw new Error("Session worktree requires git project")
    }
    const head = await $`git rev-parse --verify HEAD`.quiet().nothrow().cwd(Instance.worktree)
    if (head.exitCode !== 0) {
      return Instance.directory
    }
    const root = path.join(Instance.worktree, ".opencode", "worktrees")
    const directory = path.join(root, data.sessionId)
    const exists = await fs
      .stat(directory)
      .then((stat) => stat.isDirectory())
      .catch(() => false)
    if (exists) return directory
    await fs.mkdir(root, { recursive: true })

    const add = await $`git worktree add --no-checkout --detach ${directory}`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
    if (add.exitCode !== 0) {
      throw new Error("Failed to create session worktree")
    }
    const reset = await $`git reset --hard`.quiet().nothrow().cwd(directory)
    if (reset.exitCode !== 0) {
      throw new Error("Failed to populate session worktree")
    }
    return directory
  },
}
