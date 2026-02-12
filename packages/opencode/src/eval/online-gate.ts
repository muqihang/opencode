import fs from "fs/promises"
import path from "path"
import { stableJson } from "@/util/stable-json"

export const ONLINE_GATE_SPEC = "online-gate/1.0" as const

export const ONLINE_GATE_THRESHOLD = {
  g2: {
    worker_lift_rate: 0.7,
    duplicate_retrieval_rate: 0.15,
    secure_output_pass_rate: 0.95,
    critic_degraded_rate: 0.15,
  },
  h2: {
    critic_degraded_rate_worse_pp: 0.05,
    secure_output_pass_rate_drop_pp: 0.03,
    duplicate_retrieval_rate_6h: 0.15,
  },
} as const

const HOUR_MS = 60 * 60 * 1000

type SummaryStatus = "sufficient" | "degraded"

type OnlineEvent = {
  ts: string
  tsMs: number
  sessionId: string
  type: string
  messageId?: string
  retrievalCacheKey?: string
  orchestratorEnabled?: boolean
}

type MetricStatus = "pass" | "warn" | "fail"

type HourlyDuplicate = {
  windowStart: string
  windowEnd: string
  value: number
  total: number
  duplicate: number
}

export type OnlineGateDashboard = {
  specVersion: typeof ONLINE_GATE_SPEC
  generatedAt: string
  source: {
    evidenceDir: string
    artifactsDir: string
  }
  baseline?: {
    secure_output_pass_rate?: number
    critic_degraded_rate?: number
  }
  thresholds: typeof ONLINE_GATE_THRESHOLD
  metrics: {
    worker_lift_rate: {
      value1h: number
      value24h: number
      eligible1h: number
      enhanced1h: number
      eligible24h: number
      enhanced24h: number
    }
    duplicate_retrieval_rate: {
      value1h: number
      total1h: number
      duplicate1h: number
      hourly6h: HourlyDuplicate[]
    }
    secure_output_pass_rate: {
      value24h: number
      completed24h: number
      degraded24h: number
    }
    critic_degraded_rate: {
      value24h: number
      degraded24h: number
      total24h: number
    }
  }
}

export type OnlineGateAlert = {
  specVersion: typeof ONLINE_GATE_SPEC
  generatedAt: string
  status: MetricStatus
  gatePassed: boolean
  breaches: string[]
  notes: string[]
}

type RunOnlineGateDashboardInput = {
  evidenceDir: string
  artifactsDir: string
  now?: string
  dashboardPath: string
  summaryPath: string
  alertPath: string
  baseline?: {
    secure_output_pass_rate?: number
    critic_degraded_rate?: number
  }
}

const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000

const rate = (numerator: number, denominator: number) => {
  if (denominator === 0) return 0
  return round(numerator / denominator)
}

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

const asText = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : undefined)

const asBool = (value: unknown) => (typeof value === "boolean" ? value : undefined)

const parseJson = (value: string) => {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return
  }
}

const scan = async (root: string, pattern: string) => {
  const dir = await fs.stat(root).catch(() => null)
  if (!dir?.isDirectory()) return [] as string[]
  const files: string[] = []
  for await (const rel of new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true })) {
    files.push(path.join(root, rel))
  }
  return files.toSorted()
}

const parseEvent = (line: string): OnlineEvent | undefined => {
  const raw = parseJson(line)
  const rec = asRecord(raw)
  const ts = asText(rec.ts)
  const type = asText(rec.type)
  const sessionId = asText(rec.sessionId)
  if (!ts || !type || !sessionId) return
  const tsMs = Date.parse(ts)
  if (!Number.isFinite(tsMs)) return
  const data = asRecord(rec.data)
  const messageId = asText(data.messageId) ?? asText(data.messageID)
  const retrievalCacheKey = asText(data.retrievalCacheKey)
  const orchestratorEnabled = asBool(data.orchestratorEnabled) ?? asBool(data.enabled)
  return {
    ts,
    tsMs,
    type,
    sessionId,
    messageId,
    retrievalCacheKey,
    orchestratorEnabled,
  }
}

const loadEvents = async (evidenceDir: string) => {
  const files = await scan(evidenceDir, "**/events.jsonl")
  const lines = await Promise.all(files.map((file) => Bun.file(file).text().catch(() => "")))
  const events = lines
    .flatMap((text) => text.split("\n"))
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseEvent(line))
    .filter((item): item is OnlineEvent => Boolean(item))
  return events.toSorted((a, b) => a.tsMs - b.tsMs)
}

const parseSummary = (value: unknown): { messageId: string; criticFinalStatus: SummaryStatus } | undefined => {
  const rec = asRecord(value)
  const messageId = asText(rec.messageId)
  const status = asText(rec.criticFinalStatus)
  if (!messageId || !status) return
  const criticFinalStatus = status === "sufficient" ? "sufficient" : "degraded"
  return { messageId, criticFinalStatus }
}

const loadSummaries = async (artifactsDir: string) => {
  const files = await scan(artifactsDir, "**/*.worker-turn-summary.json")
  const entries = await Promise.all(files.map((file) => Bun.file(file).json().catch(() => undefined)))
  return entries.reduce((map, item) => {
    const summary = parseSummary(item)
    if (!summary) return map
    map.set(summary.messageId, summary.criticFinalStatus)
    return map
  }, new Map<string, SummaryStatus>())
}

const inHours = (input: { event: OnlineEvent; nowMs: number; hours: number }) =>
  input.event.tsMs >= input.nowMs - input.hours * HOUR_MS && input.event.tsMs <= input.nowMs

const eligibleFromPlanned = (input: { events: OnlineEvent[]; nowMs: number; hours: number }) =>
  new Set(
    input.events
      .filter((event) => event.type === "orchestrator.planned")
      .filter((event) => inHours({ event, nowMs: input.nowMs, hours: input.hours }))
      .filter((event) => event.orchestratorEnabled === true)
      .map((event) => event.messageId)
      .filter((item): item is string => Boolean(item)),
  )

const eligibleFromLifecycle = (input: { events: OnlineEvent[]; nowMs: number; hours: number }) =>
  new Set(
    input.events
      .filter((event) => event.type === "orchestrator.worker.lifecycle")
      .filter((event) => inHours({ event, nowMs: input.nowMs, hours: input.hours }))
      .map((event) => event.messageId)
      .filter((item): item is string => Boolean(item)),
  )

const eligibleMessages = (input: { events: OnlineEvent[]; nowMs: number; hours: number }) => {
  const planned = eligibleFromPlanned(input)
  if (planned.size > 0) return planned
  return eligibleFromLifecycle(input)
}

const completedMessages = (input: { events: OnlineEvent[]; nowMs: number; hours: number }) =>
  new Set(
    input.events
      .filter((event) => event.type === "secure_output.completed")
      .filter((event) => inHours({ event, nowMs: input.nowMs, hours: input.hours }))
      .map((event) => event.messageId)
      .filter((item): item is string => Boolean(item)),
  )

const secureCounts = (input: { events: OnlineEvent[]; nowMs: number; hours: number }) => {
  const secure = input.events
    .filter((event) => event.type === "secure_output.completed" || event.type === "secure_output.degraded")
    .filter((event) => inHours({ event, nowMs: input.nowMs, hours: input.hours }))
  const completed = secure.filter((event) => event.type === "secure_output.completed").length
  const degraded = secure.filter((event) => event.type === "secure_output.degraded").length
  return {
    completed,
    degraded,
    value: rate(completed, completed + degraded),
  }
}

const duplicateCounts = (events: OnlineEvent[]) => {
  const seen = new Map<string, number>()
  const total = events.length
  const duplicate = events.reduce((sum, event) => {
    const key = `${event.messageId}#${event.retrievalCacheKey}`
    const next = (seen.get(key) ?? 0) + 1
    seen.set(key, next)
    return next > 1 ? sum + 1 : sum
  }, 0)
  return {
    total,
    duplicate,
    value: rate(duplicate, total),
  }
}

const duplicate1h = (input: { events: OnlineEvent[]; nowMs: number }) => {
  const list = input.events
    .filter((event) => event.type === "retrieval.started")
    .filter((event) => inHours({ event, nowMs: input.nowMs, hours: 1 }))
    .filter((event) => Boolean(event.messageId) && Boolean(event.retrievalCacheKey))
  return duplicateCounts(list)
}

const duplicatePerHour = (input: { events: OnlineEvent[]; nowMs: number; hourOffset: number }): HourlyDuplicate => {
  const windowEndMs = input.nowMs - input.hourOffset * HOUR_MS
  const windowStartMs = windowEndMs - HOUR_MS
  const list = input.events
    .filter((event) => event.type === "retrieval.started")
    .filter((event) => event.tsMs >= windowStartMs && event.tsMs <= windowEndMs)
    .filter((event) => Boolean(event.messageId) && Boolean(event.retrievalCacheKey))
  const metric = duplicateCounts(list)
  return {
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(windowEndMs).toISOString(),
    value: metric.value,
    total: metric.total,
    duplicate: metric.duplicate,
  }
}

const duplicate6h = (input: { events: OnlineEvent[]; nowMs: number }) =>
  Array.from({ length: 6 }, (_, i) => duplicatePerHour({ events: input.events, nowMs: input.nowMs, hourOffset: 5 - i }))

const workerLift = (input: {
  events: OnlineEvent[]
  summaries: Map<string, SummaryStatus>
  nowMs: number
  hours: number
}) => {
  const eligible = eligibleMessages({ events: input.events, nowMs: input.nowMs, hours: input.hours })
  const completed = completedMessages({ events: input.events, nowMs: input.nowMs, hours: input.hours })
  const enhanced = Array.from(eligible).filter((messageId) => {
    const status = input.summaries.get(messageId)
    if (status !== "sufficient") return false
    return completed.has(messageId)
  }).length
  return {
    eligible: eligible.size,
    enhanced,
    value: rate(enhanced, eligible.size),
  }
}

const criticDegraded24h = (input: {
  events: OnlineEvent[]
  summaries: Map<string, SummaryStatus>
  nowMs: number
}) => {
  const eligible = eligibleMessages({ events: input.events, nowMs: input.nowMs, hours: 24 })
  const scoped = Array.from(eligible).filter((messageId) => input.summaries.has(messageId))
  const targets = scoped.length > 0 ? scoped : Array.from(input.summaries.keys())
  const degraded = targets.filter((messageId) => input.summaries.get(messageId) !== "sufficient").length
  return {
    total: targets.length,
    degraded,
    value: rate(degraded, targets.length),
  }
}

const fmt = (value: number) => value.toFixed(4)

const renderMetricRow = (input: { metric: string; value: number; threshold: string; status: MetricStatus }) =>
  `| ${input.metric} | ${fmt(input.value)} | ${input.threshold} | ${input.status} |`

const renderOnlineGateSummary = (input: { dashboard: OnlineGateDashboard; alert: OnlineGateAlert }) => {
  const dashboard = input.dashboard
  const alert = input.alert
  const lines = [
    "# Online Gate Dashboard",
    "",
    `- specVersion: ${dashboard.specVersion}`,
    `- generatedAt: ${dashboard.generatedAt}`,
    `- status: ${alert.status}`,
    `- gatePassed: ${alert.gatePassed ? "yes" : "no"}`,
    `- evidenceDir: ${dashboard.source.evidenceDir}`,
    `- artifactsDir: ${dashboard.source.artifactsDir}`,
    "",
    "## Metrics",
    "",
    `- worker_lift_rate (1h): ${fmt(dashboard.metrics.worker_lift_rate.value1h)} (${dashboard.metrics.worker_lift_rate.enhanced1h}/${dashboard.metrics.worker_lift_rate.eligible1h})`,
    `- worker_lift_rate (24h): ${fmt(dashboard.metrics.worker_lift_rate.value24h)} (${dashboard.metrics.worker_lift_rate.enhanced24h}/${dashboard.metrics.worker_lift_rate.eligible24h})`,
    `- duplicate_retrieval_rate (1h): ${fmt(dashboard.metrics.duplicate_retrieval_rate.value1h)} (${dashboard.metrics.duplicate_retrieval_rate.duplicate1h}/${dashboard.metrics.duplicate_retrieval_rate.total1h})`,
    `- secure_output_pass_rate (24h): ${fmt(dashboard.metrics.secure_output_pass_rate.value24h)} (${dashboard.metrics.secure_output_pass_rate.completed24h}/${dashboard.metrics.secure_output_pass_rate.completed24h + dashboard.metrics.secure_output_pass_rate.degraded24h})`,
    `- critic_degraded_rate (24h): ${fmt(dashboard.metrics.critic_degraded_rate.value24h)} (${dashboard.metrics.critic_degraded_rate.degraded24h}/${dashboard.metrics.critic_degraded_rate.total24h})`,
    "",
    "## Gate Checks",
    "",
    "| metric | actual | threshold | status |",
    "| --- | ---: | ---: | --- |",
    renderMetricRow({
      metric: "worker_lift_rate(1h)",
      value: dashboard.metrics.worker_lift_rate.value1h,
      threshold: `>= ${fmt(dashboard.thresholds.g2.worker_lift_rate)}`,
      status:
        dashboard.metrics.worker_lift_rate.value1h >= dashboard.thresholds.g2.worker_lift_rate
          ? "pass"
          : dashboard.metrics.worker_lift_rate.eligible1h === 0
            ? "warn"
            : "fail",
    }),
    renderMetricRow({
      metric: "duplicate_retrieval_rate(1h)",
      value: dashboard.metrics.duplicate_retrieval_rate.value1h,
      threshold: `<= ${fmt(dashboard.thresholds.g2.duplicate_retrieval_rate)}`,
      status:
        dashboard.metrics.duplicate_retrieval_rate.value1h <= dashboard.thresholds.g2.duplicate_retrieval_rate
          ? "pass"
          : dashboard.metrics.duplicate_retrieval_rate.total1h === 0
            ? "warn"
            : "fail",
    }),
    renderMetricRow({
      metric: "secure_output_pass_rate(24h)",
      value: dashboard.metrics.secure_output_pass_rate.value24h,
      threshold: `>= ${fmt(dashboard.thresholds.g2.secure_output_pass_rate)}`,
      status:
        dashboard.metrics.secure_output_pass_rate.value24h >= dashboard.thresholds.g2.secure_output_pass_rate
          ? "pass"
          : dashboard.metrics.secure_output_pass_rate.completed24h + dashboard.metrics.secure_output_pass_rate.degraded24h === 0
            ? "warn"
            : "fail",
    }),
    renderMetricRow({
      metric: "critic_degraded_rate(24h)",
      value: dashboard.metrics.critic_degraded_rate.value24h,
      threshold: `<= ${fmt(dashboard.thresholds.g2.critic_degraded_rate)}`,
      status:
        dashboard.metrics.critic_degraded_rate.value24h <= dashboard.thresholds.g2.critic_degraded_rate
          ? "pass"
          : dashboard.metrics.critic_degraded_rate.total24h === 0
            ? "warn"
            : "fail",
    }),
    "",
    "## Breaches",
    "",
    ...(alert.breaches.length > 0 ? alert.breaches.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Notes",
    "",
    ...(alert.notes.length > 0 ? alert.notes.map((item) => `- ${item}`) : ["- none"]),
  ]
  return `${lines.join("\n")}\n`
}

export const buildOnlineGateAlert = (input: { dashboard: OnlineGateDashboard }): OnlineGateAlert => {
  const dashboard = input.dashboard
  const breaches: string[] = []
  const notes: string[] = []

  const worker1hHas = dashboard.metrics.worker_lift_rate.eligible1h > 0
  const worker24hHas = dashboard.metrics.worker_lift_rate.eligible24h > 0
  const worker1hPass = dashboard.metrics.worker_lift_rate.value1h >= dashboard.thresholds.g2.worker_lift_rate
  const worker24hPass = dashboard.metrics.worker_lift_rate.value24h >= dashboard.thresholds.g2.worker_lift_rate
  const workerFail = (worker1hHas && !worker1hPass) || (worker24hHas && !worker24hPass)
  if (workerFail) breaches.push("g2.worker_lift_rate")

  const duplicate1hHas = dashboard.metrics.duplicate_retrieval_rate.total1h > 0
  const duplicate1hPass = dashboard.metrics.duplicate_retrieval_rate.value1h <= dashboard.thresholds.g2.duplicate_retrieval_rate
  if (duplicate1hHas && !duplicate1hPass) breaches.push("g2.duplicate_retrieval_rate")

  const secure24hHas = dashboard.metrics.secure_output_pass_rate.completed24h + dashboard.metrics.secure_output_pass_rate.degraded24h > 0
  const secure24hPass = dashboard.metrics.secure_output_pass_rate.value24h >= dashboard.thresholds.g2.secure_output_pass_rate
  if (secure24hHas && !secure24hPass) breaches.push("g2.secure_output_pass_rate")

  const critic24hHas = dashboard.metrics.critic_degraded_rate.total24h > 0
  const critic24hPass = dashboard.metrics.critic_degraded_rate.value24h <= dashboard.thresholds.g2.critic_degraded_rate
  if (critic24hHas && !critic24hPass) breaches.push("g2.critic_degraded_rate")

  const sixHourDuplicateBreach =
    dashboard.metrics.duplicate_retrieval_rate.hourly6h.length === 6 &&
    dashboard.metrics.duplicate_retrieval_rate.hourly6h.every(
      (item) => item.total > 0 && item.value > dashboard.thresholds.h2.duplicate_retrieval_rate_6h,
    )
  if (sixHourDuplicateBreach) breaches.push("h2.duplicate_retrieval_rate_6h")

  const baselineCritic = dashboard.baseline?.critic_degraded_rate
  const criticHasWindow = dashboard.metrics.critic_degraded_rate.total24h > 0
  const criticDelta = baselineCritic === undefined ? undefined : round(dashboard.metrics.critic_degraded_rate.value24h - baselineCritic)
  if (criticHasWindow && criticDelta !== undefined && criticDelta > dashboard.thresholds.h2.critic_degraded_rate_worse_pp) {
    breaches.push("h2.critic_degraded_rate_worse")
  }

  const baselineSecure = dashboard.baseline?.secure_output_pass_rate
  const secureHasWindow = dashboard.metrics.secure_output_pass_rate.completed24h + dashboard.metrics.secure_output_pass_rate.degraded24h > 0
  const secureDrop = baselineSecure === undefined ? undefined : round(baselineSecure - dashboard.metrics.secure_output_pass_rate.value24h)
  if (secureHasWindow && secureDrop !== undefined && secureDrop > dashboard.thresholds.h2.secure_output_pass_rate_drop_pp) {
    breaches.push("h2.secure_output_pass_rate_drop")
  }

  const insufficient = [
    dashboard.metrics.worker_lift_rate.eligible1h === 0 ? "worker_lift_rate(1h)" : "",
    dashboard.metrics.worker_lift_rate.eligible24h === 0 ? "worker_lift_rate(24h)" : "",
    dashboard.metrics.duplicate_retrieval_rate.total1h === 0 ? "duplicate_retrieval_rate(1h)" : "",
    dashboard.metrics.secure_output_pass_rate.completed24h + dashboard.metrics.secure_output_pass_rate.degraded24h === 0
      ? "secure_output_pass_rate(24h)"
      : "",
    dashboard.metrics.critic_degraded_rate.total24h === 0 ? "critic_degraded_rate(24h)" : "",
  ].filter(Boolean)

  if (insufficient.length > 0) {
    notes.push(`insufficient window data: ${insufficient.join(",")}`)
  }

  if (baselineCritic === undefined || baselineSecure === undefined) {
    notes.push("baseline missing for full h2 relative checks")
  }

  if (baselineCritic !== undefined && !criticHasWindow) {
    notes.push("insufficient window data for baseline-relative check: critic_degraded_rate(24h)")
  }

  if (baselineSecure !== undefined && !secureHasWindow) {
    notes.push("insufficient window data for baseline-relative check: secure_output_pass_rate(24h)")
  }

  const status: MetricStatus = breaches.length > 0 ? "fail" : notes.some((item) => item.startsWith("insufficient window data:")) ? "warn" : "pass"

  return {
    specVersion: ONLINE_GATE_SPEC,
    generatedAt: dashboard.generatedAt,
    status,
    gatePassed: status === "pass",
    breaches,
    notes,
  }
}

const calcDashboard = (input: {
  events: OnlineEvent[]
  summaries: Map<string, SummaryStatus>
  now: string
  evidenceDir: string
  artifactsDir: string
  baseline?: {
    secure_output_pass_rate?: number
    critic_degraded_rate?: number
  }
}) => {
  const nowMs = Date.parse(input.now)
  const lift1h = workerLift({ events: input.events, summaries: input.summaries, nowMs, hours: 1 })
  const lift24h = workerLift({ events: input.events, summaries: input.summaries, nowMs, hours: 24 })
  const duplicate1 = duplicate1h({ events: input.events, nowMs })
  const secure24 = secureCounts({ events: input.events, nowMs, hours: 24 })
  const critic24 = criticDegraded24h({ events: input.events, summaries: input.summaries, nowMs })

  return {
    specVersion: ONLINE_GATE_SPEC,
    generatedAt: input.now,
    source: {
      evidenceDir: path.resolve(input.evidenceDir),
      artifactsDir: path.resolve(input.artifactsDir),
    },
    baseline: input.baseline,
    thresholds: ONLINE_GATE_THRESHOLD,
    metrics: {
      worker_lift_rate: {
        value1h: lift1h.value,
        value24h: lift24h.value,
        eligible1h: lift1h.eligible,
        enhanced1h: lift1h.enhanced,
        eligible24h: lift24h.eligible,
        enhanced24h: lift24h.enhanced,
      },
      duplicate_retrieval_rate: {
        value1h: duplicate1.value,
        total1h: duplicate1.total,
        duplicate1h: duplicate1.duplicate,
        hourly6h: duplicate6h({ events: input.events, nowMs }),
      },
      secure_output_pass_rate: {
        value24h: secure24.value,
        completed24h: secure24.completed,
        degraded24h: secure24.degraded,
      },
      critic_degraded_rate: {
        value24h: critic24.value,
        degraded24h: critic24.degraded,
        total24h: critic24.total,
      },
    },
  } satisfies OnlineGateDashboard
}

export const runOnlineGateDashboard = async (input: RunOnlineGateDashboardInput) => {
  const now = input.now ?? new Date().toISOString()
  const events = await loadEvents(input.evidenceDir)
  const summaries = await loadSummaries(input.artifactsDir)
  const dashboard = calcDashboard({
    events,
    summaries,
    now,
    evidenceDir: input.evidenceDir,
    artifactsDir: input.artifactsDir,
    baseline: input.baseline,
  })
  const alert = buildOnlineGateAlert({ dashboard })
  await fs.mkdir(path.dirname(input.dashboardPath), { recursive: true })
  await fs.mkdir(path.dirname(input.summaryPath), { recursive: true })
  await fs.mkdir(path.dirname(input.alertPath), { recursive: true })
  await Bun.write(input.dashboardPath, stableJson(dashboard))
  await Bun.write(input.summaryPath, renderOnlineGateSummary({ dashboard, alert }))
  await Bun.write(input.alertPath, stableJson(alert))
  return { dashboard, alert }
}
