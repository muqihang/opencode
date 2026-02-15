import { parse as parseJsonc } from "jsonc-parser"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function truthyDefaultTrue(key: string) {
  const value = process.env[key]
  if (value === undefined) return true
  const normalized = value.trim().toLowerCase()
  return normalized === "true" || normalized === "1"
}

export namespace Flag {
  type PluginPolicyAction = "allow" | "ask" | "deny"
  type PluginPolicyMap = Record<string, PluginPolicyAction>

  export const OPENCODE_AUTO_SHARE = truthy("OPENCODE_AUTO_SHARE")
  export const OPENCODE_GIT_BASH_PATH = process.env["OPENCODE_GIT_BASH_PATH"]
  export const OPENCODE_CONFIG = process.env["OPENCODE_CONFIG"]
  export declare const OPENCODE_CONFIG_DIR: string | undefined
  export const OPENCODE_CONFIG_CONTENT = process.env["OPENCODE_CONFIG_CONTENT"]
  export const OPENCODE_DISABLE_AUTOUPDATE = truthy("OPENCODE_DISABLE_AUTOUPDATE")
  export const OPENCODE_DISABLE_PRUNE = truthy("OPENCODE_DISABLE_PRUNE")
  export const OPENCODE_DISABLE_TERMINAL_TITLE = truthy("OPENCODE_DISABLE_TERMINAL_TITLE")
  export const OPENCODE_PERMISSION = process.env["OPENCODE_PERMISSION"]
  export const OPENCODE_DISABLE_DEFAULT_PLUGINS = truthy("OPENCODE_DISABLE_DEFAULT_PLUGINS")
  export const OPENCODE_DISABLE_LSP_DOWNLOAD = truthy("OPENCODE_DISABLE_LSP_DOWNLOAD")
  export const OPENCODE_ENABLE_EXPERIMENTAL_MODELS = truthy("OPENCODE_ENABLE_EXPERIMENTAL_MODELS")
  export const OPENCODE_DISABLE_AUTOCOMPACT = truthy("OPENCODE_DISABLE_AUTOCOMPACT")
  export const OPENCODE_DISABLE_MODELS_FETCH = truthy("OPENCODE_DISABLE_MODELS_FETCH")
  export const OPENCODE_DISABLE_CLAUDE_CODE = truthy("OPENCODE_DISABLE_CLAUDE_CODE")
  export const OPENCODE_DISABLE_GEMINI_CACHED_CONTENT = truthy("OPENCODE_DISABLE_GEMINI_CACHED_CONTENT")
  export const OPENCODE_DISABLE_CLAUDE_CODE_PROMPT =
    OPENCODE_DISABLE_CLAUDE_CODE || truthy("OPENCODE_DISABLE_CLAUDE_CODE_PROMPT")
  export const OPENCODE_DISABLE_CLAUDE_CODE_SKILLS =
    OPENCODE_DISABLE_CLAUDE_CODE || truthy("OPENCODE_DISABLE_CLAUDE_CODE_SKILLS")
  export declare const OPENCODE_DISABLE_PROJECT_CONFIG: boolean
  export declare const OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A2: boolean
  export declare const OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES: boolean
  export declare const OPENCODE_EXPERIMENTAL_ORCHESTRATOR_WORKER_TIMEOUT_MS: number | undefined
  export declare const OPENCODE_EXPERIMENTAL_COMPACTION_LLM_TIMEOUT_MS: number | undefined
  export declare const OPENCODE_EXPERIMENTAL_ORCHESTRATOR_WORKER_DEBUG_SUMMARY: boolean
  export declare const OPENCODE_RETRIEVAL_HYBRID_STRATEGY: string | undefined
  export declare const OPENCODE_RETRIEVAL_HYBRID_COMPENSATION_GATE: string | undefined
  export declare const OPENCODE_RETRIEVAL_HYBRID_ROLLBACK: string | undefined
  export const OPENCODE_FAKE_VCS = process.env["OPENCODE_FAKE_VCS"]
  export const OPENCODE_CLIENT = process.env["OPENCODE_CLIENT"] ?? "cli"
  export const OPENCODE_SERVER_PASSWORD = process.env["OPENCODE_SERVER_PASSWORD"]
  export const OPENCODE_SERVER_USERNAME = process.env["OPENCODE_SERVER_USERNAME"]

  // Experimental
  export const OPENCODE_EXPERIMENTAL = truthy("OPENCODE_EXPERIMENTAL")
  export const OPENCODE_EXPERIMENTAL_FILEWATCHER = truthy("OPENCODE_EXPERIMENTAL_FILEWATCHER")
  export const OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const OPENCODE_EXPERIMENTAL_ICON_DISCOVERY =
    OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_ICON_DISCOVERY")
  export const OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT = truthy("OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const OPENCODE_ENABLE_EXA =
    truthy("OPENCODE_ENABLE_EXA") || OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_EXA")
  export const OPENCODE_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH = number("OPENCODE_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH")
  export const OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const OPENCODE_EXPERIMENTAL_OPENAI_CHAT_CACHED_TOKENS =
    OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_OPENAI_CHAT_CACHED_TOKENS")
  export const OPENCODE_EXPERIMENTAL_USAGE_PROVIDER_RAW_ARTIFACT =
    OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_USAGE_PROVIDER_RAW_ARTIFACT")
  export const OPENCODE_EXPERIMENTAL_OXFMT = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_OXFMT")
  export const OPENCODE_EXPERIMENTAL_LSP_TY = truthy("OPENCODE_EXPERIMENTAL_LSP_TY")
  export const OPENCODE_EXPERIMENTAL_LSP_TOOL = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_LSP_TOOL")
  export const OPENCODE_DISABLE_FILETIME_CHECK = truthy("OPENCODE_DISABLE_FILETIME_CHECK")
  export const OPENCODE_EXPERIMENTAL_PLAN_MODE = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_PLAN_MODE")
  export const OPENCODE_MODELS_URL = process.env["OPENCODE_MODELS_URL"]
  export const OPENCODE_EXPERIMENTAL_CAPSULE_CONTEXT = truthy("OPENCODE_EXPERIMENTAL_CAPSULE_CONTEXT")
  export const OPENCODE_EXPERIMENTAL_CAPSULE_LLM = truthy("OPENCODE_EXPERIMENTAL_CAPSULE_LLM")
  export const OPENCODE_DISABLE_HANDOFF_HINTS = truthy("OPENCODE_DISABLE_HANDOFF_HINTS")
  export const OPENCODE_EXPERIMENTAL_ORCHESTRATOR = truthy("OPENCODE_EXPERIMENTAL_ORCHESTRATOR")
  export const OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_B1 =
    OPENCODE_EXPERIMENTAL_ORCHESTRATOR && truthy("OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_B1")
  export const OPENCODE_EXPERIMENTAL_ADAPTIVE_TTC =
    OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_B1 && truthy("OPENCODE_EXPERIMENTAL_ADAPTIVE_TTC")
  export const OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_B2 =
    OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_B1 && truthy("OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_B2")
  export const OPENCODE_EXPERIMENTAL_POINTER_CONTEXT_OS =
    OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_B2 && truthy("OPENCODE_EXPERIMENTAL_POINTER_CONTEXT_OS")
  export const OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A1 =
    OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_B2 && truthy("OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A1")
  export const OPENCODE_EXPERIMENTAL_CLAIM_GRAPH_GATE =
    OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A1 && truthy("OPENCODE_EXPERIMENTAL_CLAIM_GRAPH_GATE")
  export const OPENCODE_EXPERIMENTAL_DUAL_PASS_SYNTHESIS =
    OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A1 && truthy("OPENCODE_EXPERIMENTAL_DUAL_PASS_SYNTHESIS")
  export const OPENCODE_EXPERIMENTAL_ORCHESTRATOR_LLM_WORKERS =
    OPENCODE_EXPERIMENTAL_ORCHESTRATOR && truthy("OPENCODE_EXPERIMENTAL_ORCHESTRATOR_LLM_WORKERS")
  export const OPENCODE_EXPERIMENTAL_ORCHESTRATOR_WORKER_BADGE =
    OPENCODE_EXPERIMENTAL_ORCHESTRATOR && truthy("OPENCODE_EXPERIMENTAL_ORCHESTRATOR_WORKER_BADGE")
  export const OPENCODE_EXPERIMENTAL_ORCHESTRATOR_SHADOW_MODE =
    OPENCODE_EXPERIMENTAL_ORCHESTRATOR && truthy("OPENCODE_EXPERIMENTAL_ORCHESTRATOR_SHADOW_MODE")
  export const OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_OBSERVABILITY =
    OPENCODE_EXPERIMENTAL_ORCHESTRATOR && truthy("OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_OBSERVABILITY")
  export const OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_LLM_WORKERS =
    OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_OBSERVABILITY &&
    truthy("OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_LLM_WORKERS")
  export const OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_SCORER =
    OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_LLM_WORKERS && truthy("OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_SCORER")
  export const OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_DEEPSEEK_THINKING =
    OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_SCORER &&
    truthy("OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_DEEPSEEK_THINKING")
  export const OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_CACHE_AWARE_PROMPT =
    OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_DEEPSEEK_THINKING &&
    truthy("OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_CACHE_AWARE_PROMPT")
  export const OPENCODE_ORCHESTRATOR_UX_MODE = uxMode()
  export const OPENCODE_ORCHESTRATOR_FORK_STRATEGY = forkStrategy()
  export const OPENCODE_PLUGIN_CORE_VERSION = process.env["OPENCODE_PLUGIN_CORE_VERSION"]
  export const OPENCODE_PLUGIN_POLICY_CORE = pluginPolicy("OPENCODE_PLUGIN_POLICY_CORE")
  export const OPENCODE_PLUGIN_POLICY_RUNTIME_HINT = pluginPolicy("OPENCODE_PLUGIN_POLICY_RUNTIME_HINT")

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }

  function uxMode() {
    const value = process.env["OPENCODE_ORCHESTRATOR_UX_MODE"]
    if (!value) return undefined
    const normalized = value.toLowerCase()
    if (normalized === "fast" || normalized === "auto" || normalized === "deep") return normalized
    return undefined
  }

  function forkStrategy() {
    const value = process.env["OPENCODE_ORCHESTRATOR_FORK_STRATEGY"]
    if (!value) return undefined
    const normalized = value.toLowerCase()
    if (normalized === "auto" || normalized === "suggest" || normalized === "off") return normalized
    return undefined
  }

  function pluginPolicy(key: string): PluginPolicyMap | undefined {
    const value = process.env[key]
    if (!value) return undefined

    const errors: NonNullable<Parameters<typeof parseJsonc>[1]> = []
    const parsed = parseJsonc(value, errors, { allowTrailingComma: true })
    if (errors.length > 0) return undefined
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined

    const entries = Object.entries(parsed)
    const valid = entries.every((entry) => isPluginPolicyAction(entry[1]))
    if (!valid) return undefined

    return Object.fromEntries(entries) as PluginPolicyMap
  }

  function isPluginPolicyAction(value: unknown): value is PluginPolicyAction {
    return value === "allow" || value === "ask" || value === "deny"
  }
}

Object.defineProperty(Flag, "OPENCODE_RETRIEVAL_HYBRID_STRATEGY", {
  get() {
    return process.env["OPENCODE_RETRIEVAL_HYBRID_STRATEGY"]
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_RETRIEVAL_HYBRID_COMPENSATION_GATE", {
  get() {
    return process.env["OPENCODE_RETRIEVAL_HYBRID_COMPENSATION_GATE"]
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_RETRIEVAL_HYBRID_ROLLBACK", {
  get() {
    return process.env["OPENCODE_RETRIEVAL_HYBRID_ROLLBACK"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES
// This must be evaluated at access time to support runtime env overrides in CLI/tests
Object.defineProperty(Flag, "OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES", {
  get() {
    return truthyDefaultTrue("OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A2
// This must be evaluated at access time to support runtime env overrides in CLI/tests
Object.defineProperty(Flag, "OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A2", {
  get() {
    return truthy("OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A2")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_EXPERIMENTAL_ORCHESTRATOR_WORKER_TIMEOUT_MS
// This must be evaluated at access time to support runtime env overrides in CLI/tests
Object.defineProperty(Flag, "OPENCODE_EXPERIMENTAL_ORCHESTRATOR_WORKER_TIMEOUT_MS", {
  get() {
    const value = process.env["OPENCODE_EXPERIMENTAL_ORCHESTRATOR_WORKER_TIMEOUT_MS"]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_EXPERIMENTAL_COMPACTION_LLM_TIMEOUT_MS
// This must be evaluated at access time to support runtime env overrides in CLI/tests
Object.defineProperty(Flag, "OPENCODE_EXPERIMENTAL_COMPACTION_LLM_TIMEOUT_MS", {
  get() {
    const value = process.env["OPENCODE_EXPERIMENTAL_COMPACTION_LLM_TIMEOUT_MS"]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  },
  enumerable: true,
  configurable: false,
})


// Dynamic getter for OPENCODE_EXPERIMENTAL_ORCHESTRATOR_WORKER_DEBUG_SUMMARY
// This must be evaluated at access time to support runtime env overrides in CLI/tests
Object.defineProperty(Flag, "OPENCODE_EXPERIMENTAL_ORCHESTRATOR_WORKER_DEBUG_SUMMARY", {
  get() {
    return truthy("OPENCODE_EXPERIMENTAL_ORCHESTRATOR_WORKER_DEBUG_SUMMARY")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENCODE_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("OPENCODE_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENCODE_CONFIG_DIR", {
  get() {
    return process.env["OPENCODE_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})
