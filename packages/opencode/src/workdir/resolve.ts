import path from "path"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { SessionWorktree } from "@/worktree/session"

export type WorkdirMode = "shared" | "isolated"
export type WorkdirKind = "primary" | "child"

const defaults = {
  primary: "shared",
  child: "isolated",
} as const satisfies Record<WorkdirKind, WorkdirMode>

export async function resolveWorkdirMode(input: { kind: WorkdirKind }): Promise<WorkdirMode> {
  const config = await Config.get()
  const policy = config.workdir ?? {}
  return input.kind === "child"
    ? (policy.child ?? defaults.child)
    : (policy.primary ?? defaults.primary)
}

export async function resolveWorkdirPath(input: {
  sessionId: string
  mode: WorkdirMode
}): Promise<string> {
  const shared = Instance.worktree === "/" ? Instance.directory : Instance.worktree
  if (input.mode === "shared") return shared
  if (Instance.project.vcs !== "git") return shared
  return SessionWorktree.ensure({ sessionId: input.sessionId })
}

export function mapLogicalToWorkdirPath(input: { logicalPath: string; workdir: string }): string {
  return path.resolve(input.workdir, input.logicalPath)
}
