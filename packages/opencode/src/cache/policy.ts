type Limits = {
  memoryMaxEntries: number
  diskMaxEntries: number
}

type Namespace = "retrieval" | "verification" | "context-pack" | "context-blocks"

type Effective = {
  storeEnabled: boolean
  forceContextPack: boolean
  strict: boolean
  sources: {
    env: {
      OPENCODE_DISABLE_CACHE_STORE?: string
      OPENCODE_FORCE_REBUILD_CONTEXT_PACK?: string
      OPENCODE_CACHE_STRICT?: string
    }
  }
}

const truthy = (value: string | undefined) => {
  const lower = value?.toLowerCase()
  return lower === "1" || lower === "true"
}

export const CachePolicy = {
  effective(): Effective {
    const env = {
      OPENCODE_DISABLE_CACHE_STORE: process.env["OPENCODE_DISABLE_CACHE_STORE"],
      OPENCODE_FORCE_REBUILD_CONTEXT_PACK: process.env["OPENCODE_FORCE_REBUILD_CONTEXT_PACK"],
      OPENCODE_CACHE_STRICT: process.env["OPENCODE_CACHE_STRICT"],
    }
    return {
      storeEnabled: !truthy(env.OPENCODE_DISABLE_CACHE_STORE),
      forceContextPack: truthy(env.OPENCODE_FORCE_REBUILD_CONTEXT_PACK),
      strict: truthy(env.OPENCODE_CACHE_STRICT),
      sources: { env },
    }
  },

  limits(): Limits {
    return { memoryMaxEntries: 300, diskMaxEntries: 1000 }
  },

  ttlMs(namespace: Namespace) {
    if (namespace === "retrieval") return 30 * 60 * 1000
    if (namespace === "verification") return 24 * 60 * 60 * 1000
    if (namespace === "context-pack" || namespace === "context-blocks") return 2 * 60 * 60 * 1000
    return 0
  },

  policy(namespace: Namespace) {
    const cfg = CachePolicy.effective()
    const force = namespace === "context-pack" || namespace === "context-blocks" ? cfg.forceContextPack : false
    return { enabled: cfg.storeEnabled, force }
  },
}

