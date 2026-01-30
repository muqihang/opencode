import path from "path"
import { Instance } from "@/project/instance"

export function toLogicalPath(input: { repoPath: string }): string {
  const base = Instance.worktree === "/" ? Instance.directory : Instance.worktree
  const rel = path.relative(base, input.repoPath)
  return rel.split(path.sep).join(path.posix.sep)
}

export function toWorkdirPath(input: { repoPath: string; workdir: string }): string {
  const logical = toLogicalPath({ repoPath: input.repoPath })
  return path.resolve(input.workdir, logical)
}
