import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { buildOnlineGateAlert, runOnlineGateDashboard } from "../../src/eval/online-gate"

type Fixture = {
  now: string
  events: unknown[]
  summaries: Array<{
    sessionId: string
    messageId: string
    criticFinalStatus: "sufficient" | "degraded"
  }>
}

const stamp = (iso: string, type: string, sessionId: string, data?: Record<string, unknown>) =>
  JSON.stringify({
    specVersion: "event/1.0",
    ts: iso,
    sessionId,
    severity: "info",
    actor: "test:online_gate",
    type,
    summary: type,
    data,
    redaction: { applied: true, policyVersion: "v1" },
  })

const writeFixture = async (root: string, fx: Fixture) => {
  const evidence = path.join(root, ".opencode", "evidence", "tenant-a", "org-a", "session-a")
  const artifacts = path.join(root, ".opencode", "artifacts", "tenant-a", "org-a", "session-a", "worker-turn")
  await fs.mkdir(evidence, { recursive: true })
  await fs.mkdir(artifacts, { recursive: true })
  await Bun.write(path.join(evidence, "events.jsonl"), `${fx.events.map((item) => JSON.stringify(item)).join("\n")}\n`)
  await Promise.all(
    fx.summaries.map((item) =>
      Bun.write(
        path.join(artifacts, `${item.messageId}.worker-turn-summary.json`),
        JSON.stringify({
          specVersion: "worker-turn-summary/1.0",
          sessionId: item.sessionId,
          messageId: item.messageId,
          criticFinalStatus: item.criticFinalStatus,
        }),
      ),
    ),
  )
}

const healthyFixture = (): Fixture => {
  const now = "2026-02-12T12:00:00.000Z"
  const ids = Array.from({ length: 10 }, (_, i) => `m${i + 1}`)
  const secureIds = Array.from({ length: 20 }, (_, i) => `m${i + 1}`)
  const plans = ids.map((id, i) => {
    const ts = i < 5 ? `2026-02-12T11:${String(i + 10).padStart(2, "0")}:00.000Z` : `2026-02-12T02:${String(i + 10).padStart(2, "0")}:00.000Z`
    return JSON.parse(stamp(ts, "orchestrator.planned", "session-a", { messageId: id, orchestratorEnabled: true })) as Record<
      string,
      unknown
    >
  })
  const secure = secureIds.map((id, i) => {
    const ts =
      i < 5
        ? `2026-02-12T11:${String(30 + i).padStart(2, "0")}:00.000Z`
        : `2026-02-12T0${Math.floor(i / 6)}:${String((i * 3) % 60).padStart(2, "0")}:00.000Z`
    const type = id === "m5" ? "secure_output.degraded" : "secure_output.completed"
    return JSON.parse(stamp(ts, type, "session-a", { messageId: id, claims_artifact: `secure-output/${id}.claims.json` })) as Record<
      string,
      unknown
    >
  })
  const retrieval = [
    { messageId: "m1", retrievalCacheKey: "k1" },
    { messageId: "m1", retrievalCacheKey: "k1" },
    { messageId: "m2", retrievalCacheKey: "k2" },
    { messageId: "m3", retrievalCacheKey: "k3" },
    { messageId: "m4", retrievalCacheKey: "k4" },
    { messageId: "m5", retrievalCacheKey: "k5" },
    { messageId: "m6", retrievalCacheKey: "k6" },
    { messageId: "m7", retrievalCacheKey: "k7" },
    { messageId: "m8", retrievalCacheKey: "k8" },
    { messageId: "m9", retrievalCacheKey: "k9" },
  ].map((item, i) =>
    JSON.parse(
      stamp(`2026-02-12T11:${String(i + 20).padStart(2, "0")}:30.000Z`, "retrieval.started", "session-a", item),
    ) as Record<string, unknown>,
  )
  const summaries: Fixture["summaries"] = ids.map((id) => ({
    sessionId: "session-a",
    messageId: id,
    criticFinalStatus: id === "m10" ? "degraded" : "sufficient",
  }))
  return {
    now,
    events: [...plans, ...secure, ...retrieval],
    summaries,
  }
}

const breachFixture = (): Fixture => {
  const now = "2026-02-12T12:00:00.000Z"
  const ids = Array.from({ length: 6 }, (_, i) => `b${i + 1}`)
  const plans = ids.map((id, i) =>
    JSON.parse(
      stamp(`2026-02-12T11:${String(i + 10).padStart(2, "0")}:00.000Z`, "orchestrator.planned", "session-a", {
        messageId: id,
        orchestratorEnabled: true,
      }),
    ) as Record<string, unknown>,
  )
  const secure = ids.map((id, i) =>
    JSON.parse(
      stamp(`2026-02-12T11:${String(i + 20).padStart(2, "0")}:00.000Z`, i >= 4 ? "secure_output.degraded" : "secure_output.completed", "session-a", {
        messageId: id,
        claims_artifact: `secure-output/${id}.claims.json`,
      }),
    ) as Record<string, unknown>,
  )
  const repeated = Array.from({ length: 6 }, (_, i) => i).flatMap((i) => {
    const hour = String(11 - i).padStart(2, "0")
    return [
      JSON.parse(stamp(`2026-02-12T${hour}:00:00.000Z`, "retrieval.started", "session-a", { messageId: `h${i}`, retrievalCacheKey: `key-${i}` })) as Record<
        string,
        unknown
      >,
      JSON.parse(stamp(`2026-02-12T${hour}:10:00.000Z`, "retrieval.started", "session-a", { messageId: `h${i}`, retrievalCacheKey: `key-${i}` })) as Record<
        string,
        unknown
      >,
    ]
  })
  const summaries: Fixture["summaries"] = ids.map((id, i) => ({
    sessionId: "session-a",
    messageId: id,
    criticFinalStatus: i >= 3 ? "degraded" : "sufficient",
  }))

  return {
    now,
    events: [...plans, ...secure, ...repeated],
    summaries,
  }
}

const emptyFixture = (): Fixture => ({
  now: "2026-02-12T12:00:00.000Z",
  events: [],
  summaries: [],
})

describe("eval.online gate", () => {
  test("computes dashboard metrics and writes auditable outputs", async () => {
    await using tmp = await tmpdir()
    const fx = healthyFixture()
    await writeFixture(tmp.path, fx)

    const dashboardPath = path.join(tmp.path, "online-gate-dashboard.json")
    const summaryPath = path.join(tmp.path, "online-gate-dashboard.md")
    const alertPath = path.join(tmp.path, "online-gate-alert.json")

    const result = await runOnlineGateDashboard({
      evidenceDir: path.join(tmp.path, ".opencode", "evidence"),
      artifactsDir: path.join(tmp.path, ".opencode", "artifacts"),
      now: fx.now,
      dashboardPath,
      summaryPath,
      alertPath,
    })

    expect(result.dashboard.metrics.worker_lift_rate.value24h).toBeCloseTo(0.8)
    expect(result.dashboard.metrics.worker_lift_rate.value1h).toBeCloseTo(0.8)
    expect(result.dashboard.metrics.duplicate_retrieval_rate.value1h).toBeCloseTo(0.1)
    expect(result.dashboard.metrics.secure_output_pass_rate.value24h).toBeCloseTo(0.95)
    expect(result.dashboard.metrics.critic_degraded_rate.value24h).toBeCloseTo(0.1)
    expect(result.alert.status).toBe("pass")
    expect(await Bun.file(dashboardPath).exists()).toBe(true)
    expect(await Bun.file(summaryPath).exists()).toBe(true)
    expect(await Bun.file(alertPath).exists()).toBe(true)

    const summary = await Bun.file(summaryPath).text()
    expect(summary.includes("worker_lift_rate")).toBe(true)
    expect(summary.includes("duplicate_retrieval_rate")).toBe(true)
  })

  test("triggers fail alerts for g2/h2 breaches", async () => {
    await using tmp = await tmpdir()
    const fx = breachFixture()
    await writeFixture(tmp.path, fx)

    const dashboardPath = path.join(tmp.path, "online-gate-dashboard.json")
    const summaryPath = path.join(tmp.path, "online-gate-dashboard.md")
    const alertPath = path.join(tmp.path, "online-gate-alert.json")

    const result = await runOnlineGateDashboard({
      evidenceDir: path.join(tmp.path, ".opencode", "evidence"),
      artifactsDir: path.join(tmp.path, ".opencode", "artifacts"),
      now: fx.now,
      dashboardPath,
      summaryPath,
      alertPath,
      baseline: {
        secure_output_pass_rate: 0.95,
        critic_degraded_rate: 0.1,
      },
    })

    expect(result.alert.status).toBe("fail")
    expect(result.alert.gatePassed).toBe(false)
    expect(result.alert.breaches.includes("g2.worker_lift_rate")).toBe(true)
    expect(result.alert.breaches.includes("g2.duplicate_retrieval_rate")).toBe(true)
    expect(result.alert.breaches.includes("g2.secure_output_pass_rate")).toBe(true)
    expect(result.alert.breaches.includes("g2.critic_degraded_rate")).toBe(true)
    expect(result.alert.breaches.includes("h2.duplicate_retrieval_rate_6h")).toBe(true)
    expect(result.alert.breaches.includes("h2.secure_output_pass_rate_drop"))
    expect(result.alert.breaches.includes("h2.critic_degraded_rate_worse"))
  })

  test("keeps empty window behavior stable with warn status", async () => {
    await using tmp = await tmpdir()
    const fx = emptyFixture()
    await writeFixture(tmp.path, fx)

    const dashboardPath = path.join(tmp.path, "online-gate-dashboard.json")
    const summaryPath = path.join(tmp.path, "online-gate-dashboard.md")
    const alertPath = path.join(tmp.path, "online-gate-alert.json")

    const result = await runOnlineGateDashboard({
      evidenceDir: path.join(tmp.path, ".opencode", "evidence"),
      artifactsDir: path.join(tmp.path, ".opencode", "artifacts"),
      now: fx.now,
      dashboardPath,
      summaryPath,
      alertPath,
    })

    expect(result.dashboard.metrics.worker_lift_rate.value1h).toBe(0)
    expect(result.dashboard.metrics.duplicate_retrieval_rate.value1h).toBe(0)
    expect(result.dashboard.metrics.secure_output_pass_rate.value24h).toBe(0)
    expect(result.dashboard.metrics.critic_degraded_rate.value24h).toBe(0)

    const alert = buildOnlineGateAlert({
      dashboard: result.dashboard,
    })
    expect(alert.status).toBe("warn")
    expect(alert.notes.some((item) => item.includes("insufficient window data"))).toBe(true)
  })
})
