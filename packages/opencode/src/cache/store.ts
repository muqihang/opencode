import fs from "fs/promises"
import path from "path"
import { stableJson } from "@/util/stable-json"
import { sha256Text } from "@/routing/cache"
import { Lock } from "@/util/lock"
import { Identifier } from "@/id/id"

type Scope = {
  projectId: string
  worktreeRoot: string
}

type Limits = {
  memoryMaxEntries: number
  diskMaxEntries: number
}

type Clock = {
  nowMs: () => number
}

type Emit = (input: {
  type: "cache.read" | "cache.write" | "cache.hit" | "cache.miss"
  decision: "hit" | "miss" | "expired" | "disabled" | "forced_rebuild" | "evicted"
  tier: "memory" | "disk" | "none"
  namespace: string
  key: string
  scope: Scope
  meta?: {
    ttlMs?: number
    ageMs?: number
    sizeBytes?: number
    sha256?: string
  }
}) => void

type Policy = {
  enabled: boolean
  force: boolean
}

type GetResult<T> = {
  status: "hit" | "miss" | "expired" | "disabled" | "forced_rebuild"
  tier: "memory" | "disk" | "none"
  value: T
}

type ReadResult<T> =
  | { status: "hit"; tier: "memory" | "disk"; value: T }
  | { status: "expired"; tier: "memory" | "disk" }
  | { status: "miss"; tier: "none" }

type Entry<T> = {
  specVersion: "cache-entry/1.0"
  createdAtUtc: string
  lastAccessUtc: string
  expiresAtUtc: string
  sha256: string
  sizeBytes: number
  value: T
}

type IndexEntry = {
  createdAtUtc: string
  lastAccessUtc: string
  expiresAtUtc: string
  sha256: string
  sizeBytes: number
}

type Index = {
  specVersion: "cache-index/1.0"
  entries: Record<string, IndexEntry>
}

const iso = (ms: number) => new Date(ms).toISOString()

const safeJson = (text: string) => {
  try {
    return { ok: true as const, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false as const }
  }
}

const sizeBytes = (text: string) => Buffer.byteLength(text, "utf-8")

const writeAtomic = async (file: string, data: string) => {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${Identifier.ascending("cache")}.tmp`
  await Bun.write(tmp, data)
  await fs.rename(tmp, file)
}

const readText = async (file: string) => Bun.file(file).text().catch(() => "")

const readIndex = async (file: string): Promise<Index> => {
  const text = await readText(file)
  if (!text) return { specVersion: "cache-index/1.0", entries: {} }
  const parsed = safeJson(text)
  if (!parsed.ok) return { specVersion: "cache-index/1.0", entries: {} }
  const view = parsed.value
  if (!view || typeof view !== "object") return { specVersion: "cache-index/1.0", entries: {} }
  const record = view as Record<string, unknown>
  const entries = record.entries
  if (!entries || typeof entries !== "object") return { specVersion: "cache-index/1.0", entries: {} }
  return { specVersion: "cache-index/1.0", entries: entries as Record<string, IndexEntry> }
}

const remember = <T>(input: {
  memory: Map<string, Entry<T>>
  key: string
  value: Entry<T>
  limit: number
}) => {
  if (input.limit <= 0) return
  input.memory.delete(input.key)
  input.memory.set(input.key, input.value)
  if (input.memory.size <= input.limit) return
  for (const k of input.memory.keys()) {
    input.memory.delete(k)
    if (input.memory.size <= input.limit) return
  }
}

export const CacheStore = {
  key(input: { namespace: string; scope: Scope; input: unknown }) {
    const payload = stableJson({
      specVersion: "cache-store-key/1.0",
      namespace: input.namespace,
      scope: input.scope,
      input: input.input,
      versions: { stableJson: "v1" },
    })
    return sha256Text(payload)
  },

  open(input: {
    namespace: string
    scope: Scope
    limits: Limits
    clock?: Clock
    emit?: Emit
  }) {
    const clock = input.clock ?? { nowMs: () => Date.now() }
    const emit = input.emit

    const root = path.join(input.scope.worktreeRoot, ".opencode", "cache", "store", input.namespace)
    const indexPath = path.join(root, "index.json")
    const entriesDir = path.join(root, "entries")
    const entryPath = (key: string) => path.join(entriesDir, `${key}.json`)

    const memory = new Map<string, Entry<unknown>>()

    const evictDisk = async (idx: Index) => {
      const limit = input.limits.diskMaxEntries
      if (limit <= 0) return
      const keys = Object.keys(idx.entries)
      if (keys.length <= limit) return

      const sorted = keys
        .map((key) => ({ key, last: Date.parse(idx.entries[key]?.lastAccessUtc ?? "") }))
        .map((item) => ({ key: item.key, last: Number.isFinite(item.last) ? item.last : 0 }))
        .sort((a, b) => a.last - b.last)

      const excess = sorted.length - limit
      const victims = sorted.slice(0, Math.max(0, excess)).map((x) => x.key)
      if (victims.length === 0) return

      for (const key of victims) {
        delete idx.entries[key]
        memory.delete(key)
        await fs.unlink(entryPath(key)).catch(() => {})
        emit?.({
          type: "cache.write",
          decision: "evicted",
          tier: "disk",
          namespace: input.namespace,
          key,
          scope: input.scope,
        })
      }

      await writeAtomic(indexPath, stableJson(idx))
    }

    const readDisk = async <T>(key: string): Promise<Entry<T> | undefined> => {
      const text = await readText(entryPath(key))
      if (!text) return
      const parsed = safeJson(text)
      if (!parsed.ok) return
      const view = parsed.value
      if (!view || typeof view !== "object") return
      const entry = view as Entry<T>
      if (entry.specVersion !== "cache-entry/1.0") return
      return entry
    }

    const writeDisk = async <T>(key: string, entry: Entry<T>) => {
      if (input.limits.diskMaxEntries <= 0) return
      await fs.mkdir(entriesDir, { recursive: true })
      await writeAtomic(entryPath(key), stableJson(entry))

      const idx = await readIndex(indexPath)
      idx.entries[key] = {
        createdAtUtc: entry.createdAtUtc,
        lastAccessUtc: entry.lastAccessUtc,
        expiresAtUtc: entry.expiresAtUtc,
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
      }
      await writeAtomic(indexPath, stableJson(idx))
      await evictDisk(idx)
    }

    const touchIndex = async (key: string, entry: IndexEntry) => {
      const idx = await readIndex(indexPath)
      idx.entries[key] = entry
      await writeAtomic(indexPath, stableJson(idx))
    }

    const removeDisk = async (key: string) => {
      memory.delete(key)
      await fs.unlink(entryPath(key)).catch(() => {})
      const idx = await readIndex(indexPath)
      if (!idx.entries[key]) return
      delete idx.entries[key]
      await writeAtomic(indexPath, stableJson(idx))
    }

    const read = async <T>(key: string, ttlMs: number): Promise<ReadResult<T>> => {
      const now = clock.nowMs()
      const m = input.limits.memoryMaxEntries > 0 ? (memory.get(key) as Entry<T> | undefined) : undefined
      if (m) {
        const expires = Date.parse(m.expiresAtUtc)
        const expired = Number.isFinite(expires) ? now > expires : true
        if (expired) {
          emit?.({
            type: "cache.read",
            decision: "expired",
            tier: "memory",
            namespace: input.namespace,
            key,
            scope: input.scope,
            meta: { ttlMs },
          })
          memory.delete(key)
          return { status: "expired", tier: "memory" }
        }
        const ageMs = Math.max(0, now - Date.parse(m.createdAtUtc))
        emit?.({
          type: "cache.read",
          decision: "hit",
          tier: "memory",
          namespace: input.namespace,
          key,
          scope: input.scope,
          meta: { ttlMs, ageMs, sizeBytes: m.sizeBytes, sha256: m.sha256 },
        })
        emit?.({
          type: "cache.hit",
          decision: "hit",
          tier: "memory",
          namespace: input.namespace,
          key,
          scope: input.scope,
        })
        remember({ memory, key, value: m as Entry<unknown>, limit: input.limits.memoryMaxEntries })
        return { status: "hit", tier: "memory", value: m.value }
      }

      const disk = await readDisk<T>(key)
      if (!disk) {
        emit?.({
          type: "cache.read",
          decision: "miss",
          tier: "none",
          namespace: input.namespace,
          key,
          scope: input.scope,
          meta: { ttlMs },
        })
        emit?.({
          type: "cache.miss",
          decision: "miss",
          tier: "none",
          namespace: input.namespace,
          key,
          scope: input.scope,
        })
        return { status: "miss", tier: "none" }
      }

      const expires = Date.parse(disk.expiresAtUtc)
      const expired = Number.isFinite(expires) ? now > expires : true
      if (expired) {
        emit?.({
          type: "cache.read",
          decision: "expired",
          tier: "disk",
          namespace: input.namespace,
          key,
          scope: input.scope,
          meta: { ttlMs },
        })
        await removeDisk(key)
        return { status: "expired", tier: "disk" }
      }

      const ageMs = Math.max(0, now - Date.parse(disk.createdAtUtc))
      const touched: Entry<T> = {
        ...disk,
        lastAccessUtc: iso(now),
      }
      await writeAtomic(entryPath(key), stableJson(touched))
      await touchIndex(key, {
        createdAtUtc: touched.createdAtUtc,
        lastAccessUtc: touched.lastAccessUtc,
        expiresAtUtc: touched.expiresAtUtc,
        sha256: touched.sha256,
        sizeBytes: touched.sizeBytes,
      })

      emit?.({
        type: "cache.read",
        decision: "hit",
        tier: "disk",
        namespace: input.namespace,
        key,
        scope: input.scope,
        meta: { ttlMs, ageMs, sizeBytes: touched.sizeBytes, sha256: touched.sha256 },
      })
      emit?.({
        type: "cache.hit",
        decision: "hit",
        tier: "disk",
        namespace: input.namespace,
        key,
        scope: input.scope,
      })
      remember({ memory, key, value: touched as Entry<unknown>, limit: input.limits.memoryMaxEntries })
      return { status: "hit", tier: "disk", value: touched.value }
    }

    const store = {
      async getOrCompute<T>(input2: {
        key: string
        ttlMs: number
        policy: Policy
        compute: () => Promise<T>
      }): Promise<GetResult<T>> {
        const lockKey = `cache-store:${input.namespace}:${input2.key}`
        await using lock = await Lock.write(lockKey)
        void lock

        if (!input2.policy.enabled) {
          emit?.({
            type: "cache.read",
            decision: "disabled",
            tier: "none",
            namespace: input.namespace,
            key: input2.key,
            scope: input.scope,
            meta: { ttlMs: input2.ttlMs },
          })
          const value = await input2.compute()
          return { status: "disabled", tier: "none", value }
        }

        if (input2.policy.force) {
          emit?.({
            type: "cache.read",
            decision: "forced_rebuild",
            tier: "none",
            namespace: input.namespace,
            key: input2.key,
            scope: input.scope,
            meta: { ttlMs: input2.ttlMs },
          })
          const value = await input2.compute()
          const now = clock.nowMs()
          const body = stableJson(value)
          const entry: Entry<T> = {
            specVersion: "cache-entry/1.0",
            createdAtUtc: iso(now),
            lastAccessUtc: iso(now),
            expiresAtUtc: iso(now + Math.max(0, input2.ttlMs)),
            sha256: sha256Text(body),
            sizeBytes: sizeBytes(body),
            value,
          }
          remember({ memory, key: input2.key, value: entry as Entry<unknown>, limit: input.limits.memoryMaxEntries })
          await writeDisk(input2.key, entry)
          emit?.({
            type: "cache.write",
            decision: "forced_rebuild",
            tier: "disk",
            namespace: input.namespace,
            key: input2.key,
            scope: input.scope,
            meta: { ttlMs: input2.ttlMs, sizeBytes: entry.sizeBytes, sha256: entry.sha256 },
          })
          return { status: "forced_rebuild", tier: "none", value }
        }

        const cached = await read<T>(input2.key, input2.ttlMs)
        if (cached.status === "hit") return cached

        const value = await input2.compute()
        const now = clock.nowMs()
        const body = stableJson(value)
        const status = cached.status === "expired" ? "expired" : "miss"
        const entry: Entry<T> = {
          specVersion: "cache-entry/1.0",
          createdAtUtc: iso(now),
          lastAccessUtc: iso(now),
          expiresAtUtc: iso(now + Math.max(0, input2.ttlMs)),
          sha256: sha256Text(body),
          sizeBytes: sizeBytes(body),
          value,
        }

        remember({ memory, key: input2.key, value: entry as Entry<unknown>, limit: input.limits.memoryMaxEntries })
        await writeDisk(input2.key, entry)
        emit?.({
          type: "cache.write",
          decision: status,
          tier: "disk",
          namespace: input.namespace,
          key: input2.key,
          scope: input.scope,
          meta: { ttlMs: input2.ttlMs, sizeBytes: entry.sizeBytes, sha256: entry.sha256 },
        })
        return { status, tier: "none", value }
      },
    }

    return store
  },
}
