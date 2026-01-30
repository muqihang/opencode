import path from "path"
import fs from "fs/promises"
import z from "zod"
import { stableJson } from "@/util/stable-json"
import { RoutingWorkerResult } from "@/protocol/routing-worker-result"
import { RoutingWorkerId } from "@/protocol/routing-run-request"
import { Instance } from "@/project/instance"
import type { RoutingConfig } from "./config"

const LIMIT = 200
const memory = new Map<string, z.infer<typeof RoutingWorkerResult>>()

export const sha256Text = (text: string): string => {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(text)
  return hash.digest("hex")
}

const cacheDir = () => path.join(Instance.worktree, ".opencode", "cache", "routing")

const cachePath = (key: string) => path.join(cacheDir(), `${key}.json`)

const remember = (key: string, value: z.infer<typeof RoutingWorkerResult>) => {
  memory.set(key, value)
  if (memory.size <= LIMIT) return
  for (const item of memory.keys()) {
    memory.delete(item)
    if (memory.size <= LIMIT) return
  }
}

export const routingConfigFingerprint = (config: RoutingConfig): string => {
  const payload = stableJson({
    specVersion: "routing-config-fingerprint/1.0",
    budgets: {
      maxWallClockMs: config.maxWallClockMs,
      workerTimeoutMs: config.workerTimeoutMs,
      topK: config.topK,
    },
    workers: config.workers,
    versions: config.versions,
    indexVersions: {
      repoIndex: "repo-index/1.0",
      kbIndex: "kb-index/1.0",
      graphIndex: "graph-index/1.0",
    },
  })
  return sha256Text(payload)
}

export const routingRepoFingerprint = (input: {
  vcs: "git" | "none"
  head: string
  dirty: boolean
  diffFingerprint: string
}): string => {
  if (input.vcs !== "git") return sha256Text("none")
  const base = input.dirty
    ? `git:${input.head}+dirty:${input.diffFingerprint}`
    : `git:${input.head}`
  return sha256Text(base)
}

export const routingCacheKey = (input: {
  workerId: z.infer<typeof RoutingWorkerId>
  scope: { projectId: string; worktreeRoot: string }
  repoFingerprint: string
  intentFingerprint: string
  configFingerprint: string
}) => {
  const payload = stableJson({
    specVersion: "routing-cache-key/1.0",
    workerId: input.workerId,
    scope: input.scope,
    repoFingerprint: input.repoFingerprint,
    intentFingerprint: input.intentFingerprint,
    configFingerprint: input.configFingerprint,
  })
  return sha256Text(payload)
}

export const readRoutingCache = async (
  key: string,
): Promise<z.infer<typeof RoutingWorkerResult> | undefined> => {
  const hit = memory.get(key)
  if (hit) return hit
  const text = await Bun.file(cachePath(key))
    .text()
    .catch(() => "")
  if (!text) return
  const data = await Bun.file(cachePath(key))
    .json()
    .catch(() => undefined)
  if (!data) return
  const parsed = RoutingWorkerResult.safeParse(data)
  if (!parsed.success) return
  remember(key, parsed.data)
  return parsed.data
}

export const writeRoutingCache = async (key: string, value: z.infer<typeof RoutingWorkerResult>) => {
  await fs.mkdir(cacheDir(), { recursive: true })
  await Bun.write(cachePath(key), stableJson(value))
  remember(key, value)
}
