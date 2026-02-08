import { PluginManifest, type PluginManifest as PluginManifestType } from "@/protocol/plugin-manifest"
import {
  mergePolicyPrecedence,
  type PolicyAction,
  type PolicyConflictReason,
  type PolicyMap,
} from "@/session/orchestrator/policy"

type ContractReason =
  | "invalid_manifest"
  | "core_version_incompatible"
  | "compatibility_matrix_miss"
  | "compatibility_matrix_blocked"
  | "policy_conflict_denied"

type PolicyInput = {
  core?: PolicyMap
  tenant?: PolicyMap
  runtimeHint?: PolicyMap
}

type ValidateInput = {
  specifier: string
  module: Record<string, unknown>
  coreVersion: string
  policy?: PolicyInput
}

type ValidateResult = {
  ok: boolean
  specifier: string
  reason?: ContractReason
  detail?: string
  manifest?: PluginManifestType
  conflicts: PolicyConflictReason[]
  policy: Record<string, PolicyAction>
}

type Triple = readonly [number, number, number]

const compare = (left: Triple, right: Triple) => {
  if (left[0] !== right[0]) return left[0] > right[0] ? 1 : -1
  if (left[1] !== right[1]) return left[1] > right[1] ? 1 : -1
  if (left[2] !== right[2]) return left[2] > right[2] ? 1 : -1
  return 0
}

const parsePart = (part: string) => {
  if (!/^\d+$/.test(part)) return
  const value = Number(part)
  if (!Number.isInteger(value) || value < 0) return
  return value
}

const parseVersion = (input: string): Triple | undefined => {
  const value = input.trim().replace(/^v/i, "")
  if (!value) return

  const clean = value.split("-")[0]?.split("+")[0]
  if (!clean) return

  const part = clean.split(".")
  if (part.length === 0 || part.length > 3) return

  const major = parsePart(part[0] ?? "")
  if (major === undefined) return

  const minor = parsePart(part[1] ?? "0")
  if (minor === undefined) return

  const patch = parsePart(part[2] ?? "0")
  if (patch === undefined) return

  return [major, minor, patch]
}

const caretUpper = (version: Triple): Triple => {
  if (version[0] > 0) return [version[0] + 1, 0, 0]
  if (version[1] > 0) return [0, version[1] + 1, 0]
  return [0, 0, version[2] + 1]
}

const tildeUpper = (version: Triple): Triple => [version[0], version[1] + 1, 0]

const evalComparator = (input: { version: Triple; token: string }) => {
  if (input.token === "*" || input.token.toLowerCase() === "x") return true

  if (input.token.startsWith("^")) {
    const lower = parseVersion(input.token.slice(1))
    if (!lower) return false
    return compare(input.version, lower) >= 0 && compare(input.version, caretUpper(lower)) < 0
  }

  if (input.token.startsWith("~")) {
    const lower = parseVersion(input.token.slice(1))
    if (!lower) return false
    return compare(input.version, lower) >= 0 && compare(input.version, tildeUpper(lower)) < 0
  }

  const match = input.token.match(/^(>=|<=|>|<|=)?\s*(.+)$/)
  if (!match) return false

  const operator = (match[1] ?? "=") as ">=" | "<=" | ">" | "<" | "="
  const target = parseVersion(match[2] ?? "")
  if (!target) return false

  const diff = compare(input.version, target)
  if (operator === ">=") return diff >= 0
  if (operator === "<=") return diff <= 0
  if (operator === ">") return diff > 0
  if (operator === "<") return diff < 0
  return diff === 0
}

const evalClause = (input: { version: Triple; clause: string }) => {
  const tokens = input.clause
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)

  if (tokens.length === 0) return false
  return tokens.every((token) => evalComparator({ version: input.version, token }))
}

const satisfiesRange = (input: { version: string; range: string }) => {
  const version = parseVersion(input.version)
  if (!version) return false

  const clauses = input.range
    .split("||")
    .map((item) => item.trim())
    .filter(Boolean)

  if (clauses.length === 0) return false
  return clauses.some((clause) => evalClause({ version, clause }))
}

const readManifest = (module: Record<string, unknown>) => {
  const named = module["manifest"] ?? module["pluginManifest"]
  if (named !== undefined) return named

  const main = module["default"]
  if (!main || typeof main !== "object" || Array.isArray(main)) return

  const record = main as Record<string, unknown>
  return record["manifest"]
}

const basePolicy = (input?: PolicyInput) =>
  mergePolicyPrecedence({
    core: input?.core,
    tenant: input?.tenant,
    runtimeHint: input?.runtimeHint,
  })

const withReason = (input: {
  base: ValidateResult
  reason: ContractReason
  detail?: string
  manifest?: PluginManifestType
  conflicts?: PolicyConflictReason[]
}): ValidateResult => ({
  ...input.base,
  ok: false,
  reason: input.reason,
  detail: input.detail,
  manifest: input.manifest,
  conflicts: input.conflicts ?? input.base.conflicts,
})

const checkMatrix = (input: { manifest: PluginManifestType; coreVersion: string }) => {
  const matrix = input.manifest.compatibility
  if (!matrix || matrix.length === 0) return { ok: true as const }

  const coreKnown = parseVersion(input.coreVersion) !== undefined
  const pluginKnown = parseVersion(input.manifest.version) !== undefined
  if (!coreKnown || !pluginKnown) return { ok: true as const }

  const matched = matrix.find((item) => {
    const coreOk = satisfiesRange({ version: input.coreVersion, range: item.coreRange })
    if (!coreOk) return false
    if (!item.pluginRange) return true
    return satisfiesRange({ version: input.manifest.version, range: item.pluginRange })
  })

  if (!matched) {
    return {
      ok: false as const,
      reason: "compatibility_matrix_miss" as const,
      detail: "compatibility matrix has no row for current core/plugin version",
    }
  }

  if (matched.status === "blocked") {
    return {
      ok: false as const,
      reason: "compatibility_matrix_blocked" as const,
      detail: matched.reason ?? "compatibility matrix marks this combination as blocked",
    }
  }

  return { ok: true as const }
}

export const validatePluginContract = (input: ValidateInput): ValidateResult => {
  const base = basePolicy(input.policy)
  const initial: ValidateResult = {
    ok: true,
    specifier: input.specifier,
    conflicts: [],
    policy: base.policy,
  }

  const raw = readManifest(input.module)
  if (raw === undefined) return initial

  const manifest = PluginManifest.safeParse(raw)
  if (!manifest.success) {
    const issue = manifest.error.issues[0]
    return withReason({
      base: initial,
      reason: "invalid_manifest",
      detail: issue?.message,
    })
  }

  const data = manifest.data
  const coreKnown = parseVersion(input.coreVersion) !== undefined
  if (coreKnown && !satisfiesRange({ version: input.coreVersion, range: data.coreRange })) {
    return withReason({
      base: initial,
      reason: "core_version_incompatible",
      detail: `core version ${input.coreVersion} does not satisfy ${data.coreRange}`,
      manifest: data,
    })
  }

  const matrix = checkMatrix({ manifest: data, coreVersion: input.coreVersion })
  if (!matrix.ok) {
    return withReason({
      base: initial,
      reason: matrix.reason,
      detail: matrix.detail,
      manifest: data,
    })
  }

  const merged = mergePolicyPrecedence({
    core: input.policy?.core,
    tenant: input.policy?.tenant,
    plugin: data.policy?.patch,
    runtimeHint: input.policy?.runtimeHint,
  })

  const result: ValidateResult = {
    ...initial,
    manifest: data,
    policy: merged.policy,
    conflicts: merged.reasons,
  }

  if (merged.reasons.length > 0) {
    return withReason({
      base: result,
      reason: "policy_conflict_denied",
      detail: "plugin policy patch conflicts with deny policy",
      manifest: data,
      conflicts: merged.reasons,
    })
  }

  return result
}

export type { ValidateInput, ValidateResult, ContractReason, PolicyInput }
