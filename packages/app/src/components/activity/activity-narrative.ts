import type { ActivityItem, ActivityStatus, EventV1 } from "@/lib/chronology/types"

export interface NarrativeResult {
  titleZh: string
  subtitleZh?: string
  badgeZh?: string
  severity?: "info" | "warning" | "error" | "success"
  isNoise?: boolean
  isMilestone?: boolean
}

export type NarrativePointer = {
  key: string
  value: string
}

function extractCommand(events: readonly EventV1[]): string | undefined {
  for (const e of events) {
    const cmd = e.data?.command
    if (typeof cmd === "string" && cmd.trim()) return cmd
  }
  return
}

function toolNameFromEvents(events: readonly EventV1[]): string | undefined {
  for (const e of events) {
    if (!e.actor.startsWith("tool:")) continue
    const name = e.actor.split(":").slice(1).join(":").trim()
    if (name) return name
  }
  return
}

function toolNameFromTitle(title: string): string | undefined {
  // Example: "Tool: bash (running)"
  const m = title.match(/^Tool:\s*([^(]+?)\s*\(/)
  const name = m?.[1]?.trim()
  if (!name) return
  return name
}

function toolNameFromItem(item: ActivityItem): string | undefined {
  return toolNameFromEvents(item.events) ?? toolNameFromTitle(item.title)
}

function mapTool(item: ActivityItem, events: readonly EventV1[]): NarrativeResult {
  const cmd = extractCommand(events)
  const toolName = toolNameFromItem(item)

  let titleZh = item.status === "done" ? "已执行命令" : "正在执行命令…"
  let subtitleZh: string | undefined = cmd ? cmd : toolName ? `工具：${toolName}` : undefined

  if (cmd) {
    if (/(bun test|vitest|jest)/.test(cmd)) {
      titleZh = item.status === "done" ? "测试已完成" : "正在运行测试…"
    } else if (/\bgit\b/.test(cmd) || cmd.startsWith("git ")) {
      titleZh = item.status === "done" ? "版本控制已处理" : "正在处理版本控制…"
    } else if (/\brg\b|\bgrep\b/.test(cmd)) {
      titleZh = item.status === "done" ? "搜索已完成" : "正在搜索代码…"
    }
  }

  if (item.status === "failed") titleZh = "命令执行失败"
  if (item.status === "needs_attention") titleZh = "命令执行异常"

  return { titleZh, subtitleZh }
}

function mapRouting(item: ActivityItem, events: readonly EventV1[]): NarrativeResult {

  if (events.some((e) => e.type === "routing.timeout")) {

    return { titleZh: "规划超时，已降级", severity: "warning" }

  }



  const cancelEvent = events.find((e) => e.type === "routing.cancelled")

  if (cancelEvent) {

    const reason = cancelEvent.data?.reason

        if (reason === "user_abort") {

          return { titleZh: "规划已取消 (用户终止)", severity: "warning" }

        }

        if (reason === "superseded") {

          return { titleZh: "规划已更新（新任务接管）", severity: "info", isNoise: true }

        }

        return { titleZh: "规划已取消" }

      }

    

      if (item.status === "running") return { titleZh: "正在规划下一步…" }

      return { titleZh: "已完成规划" }

    }

    

    function mapWorkbench(item: ActivityItem, events: readonly EventV1[]): NarrativeResult {

      const isDoc = events.some((e) => e.type.startsWith("doc."))

      if (isDoc) {

        if (item.status === "running") return { titleZh: "正在解析文档…" }

        return { titleZh: "文档解析完成" }

      }

    

      if (item.status === "running") return { titleZh: "正在处理文件…" }

      return { titleZh: "文件处理完成" }

    }

    

        function mapCompaction(item: ActivityItem, events: readonly EventV1[]): NarrativeResult {

    

          if (item.status === "failed") return { titleZh: "上下文压缩失败", severity: "error" }

    

          if (item.status === "running") return { titleZh: "正在压缩上下文…" }

    

    

    

          if (events.some(e => e.type === "compaction.degraded")) {

    

            return { titleZh: "上下文压缩已降级", severity: "warning" }

    

          }

    

          if (events.some(e => e.type === "compaction.timeout")) {

    

            return { titleZh: "上下文压缩超时", severity: "warning" }

    

          }

    

          if (events.some(e => e.type === "compaction.cancelled")) {

    

            return { titleZh: "上下文压缩已取消", severity: "warning" }

    

          }

    

    

    

          return { titleZh: "上下文压缩完成", severity: "success" }

    

        }

    

    

    

        function mapVerification(item: ActivityItem, events: readonly EventV1[]): NarrativeResult {

    

          if (item.status === "failed") return { titleZh: "验证任务失败", severity: "error" }

    

          if (item.status === "running") return { titleZh: "正在验证输出…" }

    

    

    

          if (events.some(e => e.type === "verification.degraded")) {

    

            return { titleZh: "验证已降级 (Best Effort)", severity: "warning" }

    

          }

    

          if (events.some(e => e.type === "verification.timeout")) {

    

            return { titleZh: "验证超时", severity: "warning" }

    

          }

    

          return { titleZh: "验证完成", severity: "success" }

    

        }

    

    

    

        function mapSecureOutput(item: ActivityItem, events: readonly EventV1[]): NarrativeResult {

    

          if (events.some(e => e.type === "protocol.violation")) {

    

            return { titleZh: "安全协议违规", subtitleZh: "输出未符合安全协议（格式解析/校验失败）", severity: "error" }

    

          }

    

          if (item.status === "failed") return { titleZh: "安全输出处理失败", severity: "error" }

    

          if (item.status === "running") return { titleZh: "正在生成安全输出…" }

    

    

    

          if (events.some(e => e.type === "secure_output.degraded")) {

    

            return { titleZh: "安全输出已降级", severity: "warning" }

    

          }

    

          return { titleZh: "安全输出已生成", severity: "success" }

    

        }

    

    

    

        function mapUsage(item: ActivityItem, events: readonly EventV1[]): NarrativeResult {

    

          if (events.some(e => e.type === "usage.normalized")) {

    

            return { titleZh: "用量已归一化", subtitleZh: "Token 统计已对账", isNoise: true }

    

          }

    

          return { titleZh: "用量统计", isNoise: true }

    

        }

    

    

    

        function mapCache(item: ActivityItem, events: readonly EventV1[]): NarrativeResult {

    

          const hit = events.find(e => e.type === "cache.hit")

    

          const miss = events.find(e => e.type === "cache.miss")

    

          const write = events.find(e => e.type === "cache.write")

    

          const config = events.find(e => e.type === "cache.config_effective")

    

    

    

          if (config) {

    

            const enabled = typeof config.data?.storeEnabled === "boolean" ? config.data.storeEnabled : null
            const force = typeof config.data?.forceContextPack === "boolean" ? config.data.forceContextPack : null
            const strict = typeof config.data?.strict === "boolean" ? config.data.strict : null
            const flags = [
              enabled === null ? "" : `SSOT:${enabled ? "开" : "关"}`,
              force === null ? "" : `强制重建:${force ? "开" : "关"}`,
              strict === null ? "" : `严格:${strict ? "开" : "关"}`,
            ].filter((x) => x.length > 0)
            const subtitle = flags.length > 0 ? flags.join(" · ") : "Default"

            return { titleZh: "缓存配置生效", subtitleZh: subtitle, isNoise: true }

    

          }

    

    

    

          if (hit) {

    

            const reason = hit.data?.reason ? `(${hit.data.reason})` : ""

    

            return { titleZh: "命中缓存", subtitleZh: `跳过重复计算 ${reason}`, severity: "success" }

    

          }

    

          if (miss) {

    

            return { titleZh: "缓存未命中", subtitleZh: "执行完整计算", isNoise: true }

    

          }

    

          if (write) {

    

            return { titleZh: "写入缓存", subtitleZh: "已保存计算结果", isNoise: true }

    

          }

    

    

    

          if (item.status === "running") return { titleZh: "正在访问缓存…" }

    

          return { titleZh: "缓存操作完成" }

    

        }

    

    

    

        function mapOther(item: ActivityItem, events: readonly EventV1[]): NarrativeResult {

    

          const type = events[0]?.type || item.title

    

          if (type.startsWith("handoff.")) {
            const data = events[0]?.data as any
            const childSessionId = data?.childSessionId
            const appliedFilesCount = Array.isArray(data?.appliedFiles) ? data.appliedFiles.length : 0

            let subtitleZh: string | undefined
            if (childSessionId) {
              subtitleZh = `会话 ID: ${childSessionId}`
            }
            if (appliedFilesCount > 0) {
              const fileStr = `${appliedFilesCount} 个文件`
              subtitleZh = subtitleZh ? `${subtitleZh} · ${fileStr}` : fileStr
            }

            return {
              titleZh: "已生成交接摘要",
              subtitleZh,
              severity: "success",
              isNoise: false
            }
          }

    

          if (type.startsWith("compaction.")) return mapCompaction(item, events)

    

          if (type.startsWith("verification.")) return mapVerification(item, events)

    

          if (type.startsWith("secure_output.") || type === "protocol.violation") return mapSecureOutput(item, events)

    

          if (type.startsWith("usage.")) return mapUsage(item, events)

    

    

    

          if (type === "context.pack_built") {

    

            return { titleZh: "上下文包已就绪", subtitleZh: "已生成 context-pack.json", isMilestone: true, isNoise: false }

    

          }

    

    

    

          if (type.startsWith("sandbox.") || type.startsWith("policy.")) {

    

            return { titleZh: "系统事件", subtitleZh: type, isNoise: true }

    

          }

    

    

    

          if (type === "worktree.merge_skipped" || type === "evidence.macro_pack_merged") {

    

            const title = type === "worktree.merge_skipped" ? "合并已跳过" : "宏包已合并"

    

            return { titleZh: `里程碑：${title}`, subtitleZh: type, isMilestone: true, isNoise: false }

    

          }

    

    

    

          return { titleZh: "系统活动", subtitleZh: type, isNoise: true }

    

        }



function mapStatus(status: ActivityStatus): { badgeZh?: string; severity?: NarrativeResult["severity"] } {

  switch (status) {

    case "running":

      return { badgeZh: "进行中", severity: "info" }

    case "failed":

      return { badgeZh: "失败", severity: "error" }

    case "needs_attention":

      return { badgeZh: "需要处理", severity: "warning" }

    case "done":

      // Avoid repeating "完成" on every card; the list section + duration already communicate completion.

      return { badgeZh: undefined, severity: "success" }

  }

}



export function mapActivityItem(item: ActivityItem): NarrativeResult {

  let result: NarrativeResult = { titleZh: item.title }



  switch (item.category) {

    case "tool":

      result = mapTool(item, item.events)

      break

    case "routing":

      result = mapRouting(item, item.events)

      break

    case "workbench":

      result = mapWorkbench(item, item.events)

      break
    case "cache":
      result = mapCache(item, item.events)
      break
    case "other":
      result = mapOther(item, item.events)
      break
  }

  const statusMeta = mapStatus(item.status)
  result.badgeZh = statusMeta.badgeZh
  if (!result.severity && statusMeta.severity) {
    result.severity = statusMeta.severity
  }

  if (item.status === "failed" || item.status === "needs_attention") {
    result.isNoise = false
  }

  return result
}

export function getFailureSuggestions(item: ActivityItem): string[] {
  if (item.status !== "failed") return []

  const suggestions: string[] = []
  const events = item.events

  if (events.some(e => e.type.startsWith("cache."))) {
    suggestions.push("尝试禁用缓存重试")
  }

  if (events.some(e => e.type.startsWith("compaction."))) {
    suggestions.push("尝试强制重建上下文")
  }

  if (events.some(e => e.type.startsWith("secure_output.") || e.type === "protocol.violation")) {
    suggestions.push("检查敏感信息策略设置")
  }
  
  if (events.some(e => e.type.startsWith("verification."))) {
    suggestions.push("尝试切换至严格模式")
  }

  if (suggestions.length === 0) {
    suggestions.push("查看详细日志以排查问题")
  }

  return suggestions
}

function isLikelySha(value: string) {
  return /^[a-f0-9]{7,64}$/i.test(value)
}

export function extractPointers(events: readonly EventV1[]): NarrativePointer[] {
  const stringKeys = new Set([
    "artifact",
    "manifestPath",
    "manifest",
    "path",
    "ref",
    "sha",
    "sha256",
    "filePath",
    "directory",
    "namespace",
    "key",
    "decision",
    "tier",
    "reason",
    "cachedContentId",
    "cachedContentKey",
  ])

  const out: NarrativePointer[] = []
  const seen = new Set<string>()

  const push = (key: string, value: string) => {
    const next = value.trim()
    if (!next) return
    const sig = `${key}:${next}`
    if (seen.has(sig)) return
    seen.add(sig)
    out.push({ key, value: next })
  }

  const pushPointerObject = (key: string, value: unknown) => {
    if (!value || typeof value !== "object") return
    const obj = value as Record<string, unknown>
    const path = typeof obj.path === "string" ? obj.path : ""
    const sha256 = typeof obj.sha256 === "string" ? obj.sha256 : ""
    const kind = typeof obj.kind === "string" ? obj.kind : ""
    if (path) push(`${key}.path`, path)
    if (sha256) push(`${key}.sha256`, sha256)
    if (kind) push(`${key}.kind`, kind)
  }

  for (const e of events) {
    if (!e.data) continue
    for (const [k, v] of Object.entries(e.data)) {
      if (typeof v === "string") {
        const value = v.trim()
        const take =
          stringKeys.has(k) ||
          value.includes(".opencode/") ||
          ((k.toLowerCase().includes("sha") || k.toLowerCase().includes("hash")) && isLikelySha(value))
        if (!take) continue
        push(k, value)
        continue
      }

      if (typeof v === "number" || typeof v === "boolean") {
        if (!stringKeys.has(k)) continue
        push(k, String(v))
        continue
      }

      if (k === "artifact") {
        pushPointerObject(k, v)
        continue
      }

      if (k === "cache") {
        const obj = typeof v === "object" && v ? (v as Record<string, unknown>) : null
        const namespace = typeof obj?.namespace === "string" ? obj.namespace : ""
        const key = typeof obj?.key === "string" ? obj.key : ""
        const decision = typeof obj?.status === "string" ? obj.status : typeof obj?.decision === "string" ? obj.decision : ""
        const tier = typeof obj?.tier === "string" ? obj.tier : ""
        if (namespace) push("cache.namespace", namespace)
        if (key) push("cache.key", key)
        if (decision) push("cache.decision", decision)
        if (tier) push("cache.tier", tier)
        continue
      }
    }
  }

  return out
}
