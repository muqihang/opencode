import path from "path"
import { stableJson } from "@/util/stable-json"
import { sha256Text } from "@/routing/cache"
import { CapsuleAssistedItem, CapsuleAssistedAnchor, CapsuleAssistedBudget, CapsuleAssistedCoverage, CapsuleAssistedVerifyFailure } from "./capsule-assisted-protocol"

const normRel = (value: string) => value.replace(/\\/g, "/").replace(/\/+/g, "/")

const badRel = (value: string) => {
  const norm = normRel(value)
  if (!norm) return true
  if (/^[a-zA-Z]:/.test(norm)) return true
  if (path.posix.isAbsolute(norm)) return true
  if (norm.split("/").some((p) => p === "..")) return true
  return false
}

const size = (text: string) => Buffer.byteLength(text, "utf-8")

const sha256File = async (filePath: string) => {
  const bytes = await Bun.file(filePath).arrayBuffer().catch(() => undefined)
  if (!bytes) return undefined
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(Buffer.from(bytes))
  return hash.digest("hex")
}

const trimLines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .trim()

const shorten = (text: string, limit: number) => {
  const t = trimLines(text)
  if (t.length <= limit) return t
  return t.slice(0, Math.max(0, limit - 1)) + "…"
}

const dedupeNums = (vals: number[]) => {
  const seen = new Set<number>()
  return vals.filter((n) => (seen.has(n) ? false : (seen.add(n), true)))
}

const unsafeText = (text: string) => {
  const t = text.toLowerCase()
  if (t.includes("```")) return "包含代码块（```）"
  if (t.includes("<system") || t.includes("</system")) return "包含疑似提示注入标签（system）"
  if (t.includes("<tool") || t.includes("</tool")) return "包含疑似提示注入标签（tool）"
  if (t.includes("<assistant") || t.includes("</assistant")) return "包含疑似提示注入标签（assistant）"
  if (t.includes("<user") || t.includes("</user")) return "包含疑似提示注入标签（user）"
  if (t.includes("ignore previous instructions") || t.includes("忽略之前的指令") || t.includes("忽略上述指令"))
    return "包含疑似提示注入指令（ignore previous instructions）"
  if (
    t.includes("rm -rf") ||
    t.includes("curl ") ||
    t.includes("wget ") ||
    t.includes("| sh") ||
    t.includes("| bash") ||
    t.includes("powershell ")
  )
    return "包含高风险命令片段"
  if (t.includes("<script") || t.includes("</script>")) return "包含可执行脚本片段"
  return undefined
}

const maxLine = (text: string, limit: number) => {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
  const joined = lines.join(" ")
  if (joined.length <= limit) return joined
  return joined.slice(0, Math.max(0, limit - 1)) + "…"
}

const byType = (items: CapsuleAssistedItem[]) => {
  const decisions = items.filter((i) => i.type === "decision")
  const questions = items.filter((i) => i.type === "question")
  return [...decisions, ...questions]
}

export const CapsuleAssistedVerifier = {
  async verify(input: {
    baseDir: string
    budget: CapsuleAssistedBudget
    anchors: CapsuleAssistedAnchor[]
    items: CapsuleAssistedItem[]
    failures?: CapsuleAssistedVerifyFailure[]
  }): Promise<{
    ok: boolean
    items: CapsuleAssistedItem[]
    coverage: CapsuleAssistedCoverage
    failures: CapsuleAssistedVerifyFailure[]
    degradedReasonZh?: string
    digest: { inputSha256: string; anchorsSha256: string; itemsSha256: string }
  }> {
    const failures: CapsuleAssistedVerifyFailure[] = input.failures ? [...input.failures] : []

    const anchors = input.anchors.slice(0, input.budget.maxAnchors).map((a) => ({
      ...a,
      path: normRel(a.path),
      anchor: a.anchor ? String(a.anchor) : undefined,
    }))

    const anchorDigest = sha256Text(stableJson({ specVersion: "capsule-assisted-anchors-digest/1.0", anchors }))

    const baseItems = byType(input.items).slice(0, input.budget.maxItems)
    const normalized = baseItems.map((item) => {
      const text = maxLine(item.text ?? "", 240)
      const reason = unsafeText(text)
      const indices = Array.isArray(item.evidenceIndices) ? item.evidenceIndices : []
      const nums = dedupeNums(indices.filter((n) => Number.isInteger(n) && n >= 0))

      if (reason) {
        failures.push({ code: "content_unsafe", messageZh: `条目已降级：${reason}` })
        return {
          ...item,
          text: shorten(text, 240),
          status: "unknown" as const,
          unknownReasonZh: item.unknownReasonZh?.trim() ? item.unknownReasonZh.trim() : `无法核验：${reason}`,
          evidenceIndices: [],
        }
      }

      const limited = nums.filter((n) => n < anchors.length)
      const bad = nums.filter((n) => n >= anchors.length)
      if (bad.length > 0) {
        failures.push({ code: "ref_unresolvable", messageZh: `引用索引越界：${bad.join(",")}` })
      }

      const status = item.status === "known" && limited.length > 0 ? ("known" as const) : ("unknown" as const)
      const unknownReasonZh =
        status === "unknown"
          ? item.unknownReasonZh?.trim()
            ? item.unknownReasonZh.trim()
            : "缺少可核验证据引用"
          : undefined

      if (item.status === "known" && status === "unknown") {
        failures.push({ code: "ref_unresolvable", messageZh: "已将无证据的 known 条目降级为 unknown" })
      }

      return {
        ...item,
        text: shorten(text, 240),
        status,
        unknownReasonZh,
        evidenceIndices: status === "known" ? limited : [],
      }
    })

    const itemsDigest = sha256Text(stableJson({ specVersion: "capsule-assisted-items-digest/1.0", items: normalized }))

    const refs = new Set<number>()
    for (const item of normalized) {
      if (item.status !== "known") continue
      for (const idx of item.evidenceIndices) refs.add(idx)
    }

    const files = [...refs]
      .map((idx) => ({ idx, anchor: anchors[idx] }))
      .filter((x) => x.anchor && !badRel(x.anchor.path))

    const badAnchors = [...refs]
      .map((idx) => anchors[idx])
      .filter((a) => !a || badRel(a.path))

    if (badAnchors.length > 0) {
      failures.push({ code: "ref_unresolvable", messageZh: "存在非法引用路径（已阻止注入）" })
    }

    const checks = await Promise.all(
      files.map(async ({ idx, anchor }) => {
        const abs = path.join(input.baseDir, anchor.path)
        const ok = await Bun.file(abs).exists()
        if (!ok) return { idx, ok: false as const, code: "ref_unresolvable" as const, messageZh: `引用文件不存在：${anchor.path}` }
        const actual = await sha256File(abs)
        if (!actual) return { idx, ok: false as const, code: "sha_mismatch" as const, messageZh: `无法读取引用文件：${anchor.path}` }
        if (actual !== anchor.sha256) {
          return { idx, ok: false as const, code: "sha_mismatch" as const, messageZh: `SHA256 不匹配：${anchor.path}` }
        }
        return { idx, ok: true as const }
      }),
    )

    const bad = checks.filter((c) => !c.ok).map((c) => c.idx)
    const fixed = normalized.map((item) => {
      if (item.status !== "known") return item
      const hit = item.evidenceIndices.some((idx) => bad.includes(idx))
      if (!hit) return item
      const reason = "引用文件缺失或内容已变化（sha 不匹配）"
      failures.push({ code: "sha_mismatch", messageZh: "已将 sha 不匹配的条目降级为 unknown" })
      return { ...item, status: "unknown" as const, unknownReasonZh: item.unknownReasonZh ?? `无法核验：${reason}`, evidenceIndices: [] }
    })

    for (const c of checks) {
      if (c.ok) continue
      failures.push({ code: c.code, messageZh: c.messageZh, evidencePath: anchors[c.idx]?.path })
    }

    const bytes = size(stableJson({ anchors, items: fixed }))
    if (bytes > input.budget.maxBytes) {
      failures.push({ code: "budget_exceeded", messageZh: `内容超预算：${bytes} bytes（上限 ${input.budget.maxBytes}）` })
    }

    const coverage = CapsuleAssistedCoverage.parse({
      known: fixed.filter((i) => i.status === "known").length,
      unknown: fixed.filter((i) => i.status === "unknown").length,
      anchors: anchors.length,
    })

    const ok = coverage.known > 0 && failures.every((f) => f.code !== "budget_exceeded") && badAnchors.length === 0
    const degradedReasonZh =
      ok
        ? undefined
        : coverage.known === 0
          ? "没有可核验的已知条目（全部为 unknown）"
          : failures.find((f) => f.code === "budget_exceeded")?.messageZh ?? "验证未通过：引用或预算不满足"

    return {
      ok,
      items: fixed,
      coverage,
      failures,
      degradedReasonZh,
      digest: {
        inputSha256: sha256Text(stableJson({ specVersion: "capsule-assisted-verify-input/1.0", budget: input.budget })),
        anchorsSha256: anchorDigest,
        itemsSha256: itemsDigest,
      },
    }
  },
}
