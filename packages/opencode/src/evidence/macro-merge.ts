import fs from "fs/promises"
import path from "path"
import z from "zod"
import { EvidenceWriter } from "@/evidence/writer"
import { EvidenceManifest } from "@/protocol/evidence-manifest"
import { EvidencePack } from "@/protocol/evidence-pack"
import type { EvidencePack as EvidencePackType } from "@/protocol/evidence-pack"
import { EventV1 } from "@/protocol/event"
import { Instance } from "@/project/instance"
import { stableJson } from "@/util/stable-json"

const MergeInput = z
  .object({
    parentSessionId: z.string().min(1),
    childSessionIds: z.array(z.string().min(1)).min(1),
  })
  .strict()

type Artifact = EvidencePackType["artifacts"][number]

type Claim = EvidencePackType["claims"][number]

type Check = EvidencePackType["checks"][number]

type Risk = EvidencePackType["risks"][number]

type Rollback = EvidencePackType["rollback"]

type Capsule = EvidencePackType["capsule"]

type Task = EvidencePackType["task"]

type Environment = EvidencePackType["environment"]

function sha(input: string) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(input)
  return hash.digest("hex")
}

function artifactKey(artifact: Artifact) {
  if (artifact.sha256) return `sha:${artifact.sha256}`
  return `path:${artifact.path}`
}

function sortArtifacts(items: Artifact[]) {
  return [...items].sort((a, b) => {
    const shaA = a.sha256 ?? ""
    const shaB = b.sha256 ?? ""
    if (shaA !== shaB) return shaA.localeCompare(shaB)
    return a.path.localeCompare(b.path)
  })
}

function sortClaims(items: Claim[]) {
  return [...items].sort((a, b) => a.id.localeCompare(b.id))
}

function sortChecks(items: Check[]) {
  return [...items].sort((a, b) => a.id.localeCompare(b.id))
}

function sortRisks(items: Risk[]) {
  return [...items].sort((a, b) => {
    const summary = a.summary.localeCompare(b.summary)
    if (summary !== 0) return summary
    const left = (a.evidence ?? []).join("|")
    const right = (b.evidence ?? []).join("|")
    return left.localeCompare(right)
  })
}

function baseDir() {
  return Instance.worktree === "/" ? Instance.directory : Instance.worktree
}

async function readPack(file: string) {
  const text = await Bun.file(file).text().catch(() => "")
  if (!text) return undefined
  return EvidencePack.parse(JSON.parse(text))
}

async function readManifest(file: string, packId: string) {
  const text = await Bun.file(file).text().catch(() => "")
  if (!text) {
    return EvidenceManifest.parse({
      specVersion: "evidence-manifest/1.0",
      packId,
      generatedAtUtc: new Date().toISOString(),
      entries: [],
    })
  }
  return EvidenceManifest.parse(JSON.parse(text))
}

async function readEvents(file: string) {
  const text = await Bun.file(file).text().catch(() => "")
  if (!text) return []
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => EventV1.parse(JSON.parse(line)))
}

async function writeAtomic(file: string, data: string) {
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true })
  const tmp = `${file}.${Date.now()}.tmp`
  await Bun.write(tmp, data)
  const hash = sha(data)
  const size = Buffer.byteLength(data, "utf-8")
  await fs.rename(tmp, file)
  return { hash, size }
}

async function artifactsFromChild(options: {
  childSessionId: string
  pack: EvidencePackType
  manifest: EvidenceManifest
}) {
  if (options.pack.artifacts.length > 0) {
    return options.pack.artifacts.map((artifact) => ({
      id: `artifact:${artifact.sha256 ?? sha(artifact.path)}`,
      kind: artifact.kind,
      path: artifact.path,
      sha256: artifact.sha256,
    }))
  }
  const prefix = `.opencode/artifacts/${options.childSessionId}/`
  return options.manifest.entries
    .filter((entry) => entry.path.replace(/\\/g, "/").startsWith(prefix))
    .map((entry) => ({
      id: `artifact:${entry.sha256}`,
      kind: entry.kind,
      path: entry.path,
      sha256: entry.sha256,
    }))
}

export async function mergeChildEvidencePacks(input: z.infer<typeof MergeInput>) {
  const data = MergeInput.parse(input)
  const base = baseDir()
  const parentEvidenceDir = path.join(base, ".opencode", "evidence", data.parentSessionId)
  const parentPackPath = path.join(parentEvidenceDir, "pack.json")
  const parentManifestPath = path.join(parentEvidenceDir, "manifest.json")
  const parentEventsPath = path.join(parentEvidenceDir, "events.jsonl")
  const parentPackId = `EP-${data.parentSessionId}`

  await fs.mkdir(parentEvidenceDir, { recursive: true })

  const parentPack =
    (await readPack(parentPackPath)) ??
    EvidencePack.parse({
      specVersion: "evidence-pack/1.0",
      packId: parentPackId,
      task: {
        title: "User request",
        intent: "P0 sandbox",
        successCriteria: ["evidence written"],
      },
      environment: {
        execution: {
          kind: "merge",
          id: `merge:${data.parentSessionId}`,
        },
      },
      claims: [],
      artifacts: [],
      checks: [],
      events: [],
      capsule: {
        handoff: "macro-merge",
        pointers: [],
        openQuestions: [],
      },
      risks: [],
      rollback: {
        strategy: "none",
        steps: [],
      },
    })

  const task: Task = parentPack.task
  const environment: Environment = parentPack.environment
  const capsule: Capsule = parentPack.capsule
  const rollback: Rollback = parentPack.rollback

  const mergedClaims = new Map<string, Claim>()
  for (const claim of parentPack.claims) {
    mergedClaims.set(claim.id, claim)
  }

  const mergedChecks = new Map<string, Check>()
  for (const check of parentPack.checks) {
    mergedChecks.set(check.id, check)
  }

  const mergedRisks: Risk[] = [...parentPack.risks]
  const riskKeys = new Set(
    parentPack.risks.map((risk) => `${risk.summary}|${(risk.evidence ?? []).join("|")}`),
  )

  const aliasMap = new Map<string, Set<string>>()
  const allArtifacts: Artifact[] = [...parentPack.artifacts]

  for (const childSessionId of data.childSessionIds) {
    const childEvidenceDir = path.join(base, ".opencode", "evidence", childSessionId)
    const childPackPath = path.join(childEvidenceDir, "pack.json")
    const childManifestPath = path.join(childEvidenceDir, "manifest.json")
    const childPack = await readPack(childPackPath)
    if (!childPack) continue
    const childManifest = await readManifest(childManifestPath, `EP-${childSessionId}`)

    const childArtifacts = await artifactsFromChild({
      childSessionId,
      pack: childPack,
      manifest: childManifest,
    })

    for (const artifact of childArtifacts) {
      allArtifacts.push(artifact)
      if (artifact.sha256) {
        const set = aliasMap.get(artifact.sha256) ?? new Set<string>()
        set.add(artifact.path)
        aliasMap.set(artifact.sha256, set)
      }
    }

    for (const claim of childPack.claims) {
      const existing = mergedClaims.get(claim.id)
      if (!existing) {
        mergedClaims.set(claim.id, claim)
        continue
      }
      if (stableJson(existing) !== stableJson(claim)) {
        const summary = `claim conflict: ${claim.id}`
        const key = `${summary}|${childSessionId}`
        if (!riskKeys.has(key)) {
          mergedRisks.push({ summary, evidence: [childSessionId] })
          riskKeys.add(key)
        }
      }
    }

    for (const check of childPack.checks) {
      const existing = mergedChecks.get(check.id)
      if (!existing) {
        mergedChecks.set(check.id, check)
        continue
      }
      if (existing.status !== check.status) {
        const summary = `check conflict: ${check.id}`
        const key = `${summary}|${childSessionId}`
        if (!riskKeys.has(key)) {
          mergedRisks.push({ summary, evidence: [childSessionId] })
          riskKeys.add(key)
        }
      }
    }

    for (const risk of childPack.risks) {
      const key = `${risk.summary}|${(risk.evidence ?? []).join("|")}`
      if (riskKeys.has(key)) continue
      mergedRisks.push(risk)
      riskKeys.add(key)
    }
  }

  let aliasArtifactPath: string | undefined
  const aliasPayload: Record<string, string[]> = {}
  for (const [key, paths] of aliasMap.entries()) {
    if (paths.size <= 1) continue
    aliasPayload[key] = Array.from(paths).sort()
  }

  if (Object.keys(aliasPayload).length > 0) {
    const writer = await EvidenceWriter.open({ sessionId: data.parentSessionId })
    const aliasEntry = await writer.artifact({
      kind: "artifact-aliases",
      path: "evidence/artifact-aliases.json",
      data: stableJson({ specVersion: "artifact-aliases/1.0", bySha256: aliasPayload }),
    })
    aliasArtifactPath = aliasEntry.path
    allArtifacts.push({
      id: `artifact:${aliasEntry.sha256}`,
      kind: aliasEntry.kind,
      path: aliasEntry.path,
      sha256: aliasEntry.sha256,
    })
  }

  const mergedArtifactsMap = new Map<string, Artifact>()
  for (const artifact of sortArtifacts(allArtifacts)) {
    const key = artifactKey(artifact)
    if (mergedArtifactsMap.has(key)) continue
    mergedArtifactsMap.set(key, artifact)
  }
  const mergedArtifacts = sortArtifacts(Array.from(mergedArtifactsMap.values()))

  const events = await readEvents(parentEventsPath)

  const pack = EvidencePack.parse({
    specVersion: "evidence-pack/1.0",
    packId: parentPackId,
    task,
    environment,
    claims: sortClaims(Array.from(mergedClaims.values())),
    artifacts: mergedArtifacts,
    checks: sortChecks(Array.from(mergedChecks.values())),
    events,
    capsule,
    risks: sortRisks(mergedRisks),
    rollback,
  })

  const packWrite = await writeAtomic(parentPackPath, stableJson(pack))

  const manifest = await readManifest(parentManifestPath, parentPackId)
  const packEntryPath = path.relative(base, parentPackPath)
  const updatedEntries = manifest.entries.filter((entry) => entry.path !== packEntryPath)
  updatedEntries.push({
    path: packEntryPath,
    sha256: packWrite.hash,
    kind: "evidence-pack",
    size: packWrite.size,
  })
  const nextManifest = EvidenceManifest.parse({
    specVersion: "evidence-manifest/1.0",
    packId: parentPackId,
    generatedAtUtc: new Date().toISOString(),
    entries: updatedEntries.sort((a, b) => a.path.localeCompare(b.path)),
  })
  await writeAtomic(parentManifestPath, stableJson(nextManifest))

  return { pack, aliasArtifactPath }
}
