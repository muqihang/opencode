import path from "path"
import { $ } from "bun"
import { FileIgnore } from "@/file/ignore"
import { stableJson } from "@/util/stable-json"

export type WorkspaceFingerprint = {
  specVersion: "workspace-fingerprint/1.0"
  vcs: "git" | "none"
  head: string
  dirty: boolean
  diffFingerprint: string
  fsFingerprint: string
}

const sha256Text = (text: string): string => {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(text)
  return hash.digest("hex")
}

const isInternalPath = (value: string) =>
  value === ".git" || value.startsWith(".git/") || value === ".opencode" || value.startsWith(".opencode/")

const gitDiff = async (root: string) => {
  const proc = await $`git diff --patch --no-color`.quiet().nothrow().cwd(root)
  if (proc.exitCode > 1) return ""
  return proc.stdout?.toString() ?? ""
}

const gitDiffCached = async (root: string) => {
  const proc = await $`git diff --patch --no-color --cached`.quiet().nothrow().cwd(root)
  if (proc.exitCode > 1) return ""
  return proc.stdout?.toString() ?? ""
}

const gitUntracked = async (root: string) => {
  const proc = await $`git ls-files --others --exclude-standard`.quiet().nothrow().cwd(root)
  if (proc.exitCode !== 0) return [] as string[]
  return (proc.stdout?.toString() ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !isInternalPath(line))
    .toSorted()
}

const gitPatch = async (root: string) => {
  const base = await gitDiff(root)
  const staged = await gitDiffCached(root)
  const untracked = await gitUntracked(root)
  const adds = await Promise.all(
    untracked.map(async (file) => {
      const proc = await $`git diff --patch --no-color --no-index /dev/null ${file}`
        .quiet()
        .nothrow()
        .cwd(root)
      if (proc.exitCode > 1) return ""
      return proc.stdout?.toString() ?? ""
    }),
  )
  return [base, staged, ...adds].join("")
}

const resolveGitFingerprint = async (root: string) => {
  const headProc = await $`git rev-parse HEAD`.quiet().nothrow().cwd(root)
  if (headProc.exitCode !== 0) return
  const head = headProc.stdout?.toString().trim() ?? ""
  if (!head) return
  const statusProc = await $`git status --porcelain`.quiet().nothrow().cwd(root)
  const status = statusProc.exitCode === 0 ? statusProc.stdout?.toString() ?? "" : ""
  const dirty = status.trim().length > 0
  if (!dirty) {
    return { vcs: "git" as const, head, dirty: false, diffFingerprint: "" }
  }
  const patch = await gitPatch(root)
  const diffFingerprint = sha256Text(patch)
  return { vcs: "git" as const, head, dirty: true, diffFingerprint }
}

const resolveFsFingerprint = async (root: string) => {
  const glob = new Bun.Glob("**/*")
  const items: Array<{ path: string; size: number; mtimeMs: number }> = []
  for await (const file of glob.scan({
    cwd: root,
    absolute: true,
    onlyFiles: true,
    followSymlinks: false,
    dot: true,
  })) {
    const rel = path.relative(root, file)
    if (!rel || rel.startsWith("..")) continue
    if (isInternalPath(rel)) continue
    if (FileIgnore.match(rel)) continue
    const stat = await Bun.file(file)
      .stat()
      .catch(() => undefined)
    if (!stat) continue
    items.push({ path: rel, size: stat.size, mtimeMs: stat.mtimeMs })
  }
  const sorted = items.toSorted((a, b) => a.path.localeCompare(b.path))
  const payload = stableJson({
    specVersion: "workspace-fs-fingerprint/1.0",
    items: sorted,
  })
  return sha256Text(payload)
}

export const resolveWorkspaceFingerprint = async (input: { root: string }): Promise<WorkspaceFingerprint> => {
  const git = await resolveGitFingerprint(input.root)
  if (git) {
    return {
      specVersion: "workspace-fingerprint/1.0",
      vcs: "git",
      head: git.head,
      dirty: git.dirty,
      diffFingerprint: git.diffFingerprint,
      fsFingerprint: "",
    }
  }
  const fsFingerprint = await resolveFsFingerprint(input.root)
  return {
    specVersion: "workspace-fingerprint/1.0",
    vcs: "none",
    head: "",
    dirty: false,
    diffFingerprint: "",
    fsFingerprint,
  }
}
