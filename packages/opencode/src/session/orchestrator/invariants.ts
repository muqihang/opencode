import path from "path"

export type InvariantId =
  | "I1"
  | "I2"
  | "I3"
  | "I4"
  | "I5"
  | "I6"
  | "I7"
  | "I8"
  | "I9"
  | "I10"
  | "I11"
  | "I12"
  | "I13"
  | "I14"

export type InvariantStatus = "已满足" | "未满足"

export type InvariantProbe = {
  path: string
  note: string
  includes?: string[]
  excludes?: string[]
}

export type InvariantSpec = {
  id: InvariantId
  title: string
  probes: InvariantProbe[]
}

export type InvariantProbeResult = {
  path: string
  note: string
  ok: boolean
  exists: boolean
  missingIncludes: string[]
  hitExcludes: string[]
}

export type InvariantAuditRow = {
  id: InvariantId
  title: string
  status: InvariantStatus
  evidencePaths: string[]
  probes: InvariantProbeResult[]
}

export type InvariantAuditReport = {
  summary: {
    total: number
    satisfied: number
    unsatisfied: number
  }
  results: InvariantAuditRow[]
}

const parseText = async (input: { rootDir: string; rel: string }) => {
  const file = Bun.file(path.join(input.rootDir, input.rel))
  const exists = await file.exists()
  if (!exists) {
    return {
      exists,
      text: "",
    }
  }

  const text = await file.text()
  return {
    exists,
    text,
  }
}

const runProbe = async (input: { rootDir: string; probe: InvariantProbe }) => {
  const loaded = await parseText({ rootDir: input.rootDir, rel: input.probe.path })
  const includes = input.probe.includes ?? []
  const excludes = input.probe.excludes ?? []

  const missingIncludes = loaded.exists
    ? includes.filter((token) => !loaded.text.includes(token))
    : includes

  const hitExcludes = loaded.exists
    ? excludes.filter((token) => loaded.text.includes(token))
    : []

  const ok = loaded.exists && missingIncludes.length === 0 && hitExcludes.length === 0

  return {
    path: input.probe.path,
    note: input.probe.note,
    ok,
    exists: loaded.exists,
    missingIncludes,
    hitExcludes,
  } satisfies InvariantProbeResult
}

const toRow = async (input: { rootDir: string; spec: InvariantSpec }) => {
  const probes = await Promise.all(input.spec.probes.map((probe) => runProbe({ rootDir: input.rootDir, probe })))
  const status: InvariantStatus = probes.every((probe) => probe.ok) ? "已满足" : "未满足"
  const evidencePaths = [...new Set(probes.filter((probe) => probe.ok).map((probe) => probe.path))].toSorted()

  return {
    id: input.spec.id,
    title: input.spec.title,
    status,
    evidencePaths,
    probes,
  } satisfies InvariantAuditRow
}

export const auditInvariantSpecs = async (input: {
  rootDir: string
  specs: InvariantSpec[]
}): Promise<InvariantAuditReport> => {
  const results = await Promise.all(input.specs.map((spec) => toRow({ rootDir: input.rootDir, spec })))
  const total = results.length
  const satisfied = results.filter((row) => row.status === "已满足").length
  const unsatisfied = total - satisfied

  return {
    summary: {
      total,
      satisfied,
      unsatisfied,
    },
    results,
  }
}

export const auditV15CoreInvariants = async (input: {
  rootDir: string
}): Promise<InvariantAuditReport> => {
  return auditInvariantSpecs({
    rootDir: input.rootDir,
    specs: V15_CORE_INVARIANTS,
  })
}

export const V15_CORE_INVARIANTS: InvariantSpec[] = [
  {
    id: "I1",
    title: "orchestratorMode=chat 必须 0 worker",
    probes: [
      {
        path: "test/session/orchestrator-plan.test.ts",
        note: "chat 模式回归测试固定 workers 为空",
        includes: ["chat keeps workers empty", "expect(result.plan.workers.length).toBe(0)"],
      },
      {
        path: "src/session/orchestrator/plan.ts",
        note: "resolveWorkers 对非 assist/heavy 模式返回空数组",
        includes: ["const resolveWorkers", "return []"],
      },
    ],
  },
  {
    id: "I2",
    title: "worker 不得直连工具，只能经 broker",
    probes: [
      {
        path: "src/session/orchestrator/index.ts",
        note: "orchestrator 收集 worker toolRequests 并统一进入 runToolBroker",
        includes: [
          "flatMap((result) => result.toolRequests ?? [])",
          "await runToolBroker({",
        ],
      },
      {
        path: "src/protocol/llm-worker-result.ts",
        note: "worker 输出仅允许声明化 toolRequests",
        includes: ["export const ToolRequest", "toolRequests: z.array(ToolRequest).optional()"],
      },
    ],
  },
  {
    id: "I3",
    title: "tool broker 必须 non-interactive",
    probes: [
      {
        path: "src/eval/offline.ts",
        note: "offline eval 固化 toolBrokerNonInteractive 检查",
        includes: ["toolBrokerNonInteractive", "eval:tool-broker.contract"],
      },
      {
        path: "test/eval/offline-regression.test.ts",
        note: "离线评测断言 tool broker 非交互契约",
        includes: ["expect(result.checks.toolBrokerNonInteractive.ok).toBe(true)"],
      },
    ],
  },
  {
    id: "I4",
    title: "bounceMax <= 1，禁止递归回填循环",
    probes: [
      {
        path: "src/session/orchestrator/plan.ts",
        note: "计划阶段固定 bounceMax=1",
        includes: ["bounceMax: 1 as const"],
      },
      {
        path: "test/session/orchestrator-tool-broker-policy.test.ts",
        note: "cycle>1 时 broker 必须拒绝",
        includes: ["enforces bounceMax=1", "expect(entry.reason).toBe(\"bounce_limit_v1\")"],
      },
    ],
  },
  {
    id: "I5",
    title: "所有工具结果必须 pointerize 落 artifacts",
    probes: [
      {
        path: "src/session/orchestrator/tool-broker.ts",
        note: "tool broker 对每个结果写入 pointer artifact",
        includes: ["kind: \"tool-broker-pointer\"", "persistPointer"],
      },
      {
        path: "test/session/orchestrator-tool-broker.test.ts",
        note: "测试断言 pointer artifact 与 manifest 关联",
        includes: ["persists pointer artifact for each tool result", "tool-broker-pointer"],
      },
    ],
  },
  {
    id: "I6",
    title: "mainTools 三态语义不变（null/[]/allowlist）",
    probes: [
      {
        path: "src/session/orchestrator/index.ts",
        note: "applyMainTools 保持 null/[]/allowlist 语义",
        includes: [
          "if (input.mainTools === undefined || input.mainTools === null) return input.tools",
          "if (input.mainTools.length === 0) return {}",
        ],
      },
      {
        path: "test/session/orchestrator-main-tools.test.ts",
        note: "三态语义回归测试",
        includes: ["undefined or null keeps tools unchanged", "empty list disables all tools", "allowlist intersects"],
      },
    ],
  },
  {
    id: "I7",
    title: "unknown-first 为全阶段最小底线",
    probes: [
      {
        path: "src/verification/claim-graph.ts",
        note: "claim gate 对 unsupported/unknown 统一降级到 unknown-first",
        includes: ["unsupported_unknown_first", "claim_unknown"],
      },
      {
        path: "test/session/claim-graph-gate.test.ts",
        note: "unknown-first 降级行为必须回归可测",
        includes: ["degrades unknown-first", "expect(gate.verdict).toBe(\"degrade\")"],
      },
    ],
  },
  {
    id: "I8",
    title: "claim 无证据不得确定性陈述",
    probes: [
      {
        path: "src/verification/worker.ts",
        note: "缺证据进入 missing/unknown reason 并触发 unsupported/unknown",
        includes: ["missing_evidence", "unknown_evidence", "summary.unsupported += 1"],
      },
      {
        path: "test/session/claim-graph-gate.test.ts",
        note: "unsupported claim 不能 pass，必须 block/degrade",
        includes: ["unsupported", "expect(gate.verdict).toBe(\"block\")"],
      },
    ],
  },
  {
    id: "I9",
    title: "插件不能替换 core 主控制流",
    probes: [
      {
        path: "src/plugin/index.ts",
        note: "插件初始化前强制 contract 校验，不通过即禁用",
        includes: ["const contract = validatePluginContract", "if (!contract.ok)", "continue"],
      },
      {
        path: "test/plugin/plugin-contract.test.ts",
        note: "不兼容插件必须被拒绝，防止越权控制流",
        includes: ["rejects incompatible core range", "expect(result.reason).toBe(\"core_version_incompatible\")"],
      },
    ],
  },
  {
    id: "I10",
    title: "core policy 优先级高于 plugin policy",
    probes: [
      {
        path: "src/session/orchestrator/policy.ts",
        note: "mergePolicyPrecedence 固定 core > tenant > plugin > runtime_hint",
        includes: ["const core = input.core?.[input.key]", "const tenant = input.tenant?.[input.key]"],
      },
      {
        path: "test/session/orchestrator-policy-precedence.test.ts",
        note: "冲突时 plugin 放宽 deny 必须被拒绝",
        includes: ["uses fixed priority core > tenant > plugin > runtime hint", "policy_conflict_denied"],
      },
    ],
  },
  {
    id: "I11",
    title: "side-effect 任务必须 fork 子 session",
    probes: [
      {
        path: "src/session/orchestrator/plan.ts",
        note: "write/exec intent 直接路由到 fork",
        includes: ["if (input.hasWriteIntent || input.hasExecIntent) return \"fork\""],
      },
      {
        path: "test/session/orchestrator-plan.test.ts",
        note: "write/exec intent 强制 fork 的回归测试",
        includes: ["write or exec intent forces fork", "expect(result.plan.orchestratorMode).toBe(\"fork\")"],
      },
    ],
  },
  {
    id: "I12",
    title: "缓存 key 含 schema/version/policy 关键维度",
    probes: [
      {
        path: "src/session/context-pack-cache.ts",
        note: "context pack cache key 包含 specVersion 与版本维度",
        includes: ["specVersion: \"context-pack-templates-cache-key/1.0\"", "versions: { builder: \"v3\", stableJson: \"v1\" }"],
      },
      {
        path: "test/session/context-os-cache-key.test.ts",
        note: "cache key 对 hydration/pointer 维度可区分并有回归测试",
        includes: ["context os cache key", "cache key separates pointer-first and full hydration modes"],
      },
    ],
  },
  {
    id: "I13",
    title: "每 turn 必须有 traceId 且事件可回放",
    probes: [
      {
        path: "src/evidence/writer.ts",
        note: "写事件时注入 traceId/messageId",
        includes: ["traceId: inputEvent.traceId ?? context?.traceId", "messageId"],
      },
      {
        path: "test/evidence/evidence-writer.test.ts",
        note: "traceId 注入行为具备自动化断言",
        includes: ["injects traceId + messageId into events", "expect(first.traceId).toBe("],
      },
      {
        path: "test/evidence/dual-pass-citation-integrity.test.ts",
        note: "turn gate replay 可重建 claim/dual-pass 决策",
        includes: ["turn gate replay exposes claim decision", "replayTurnGateEvent"],
      },
    ],
  },
  {
    id: "I14",
    title: "plugin 启用前必须通过兼容性矩阵校验",
    probes: [
      {
        path: "src/plugin/contract.ts",
        note: "compatibility matrix miss/blocked 必须失败",
        includes: ["compatibility_matrix_miss", "compatibility_matrix_blocked", "const checkMatrix"],
      },
      {
        path: "test/plugin/plugin-contract.test.ts",
        note: "blocked matrix 组合必须被拒绝",
        includes: ["rejects blocked compatibility matrix entry", "expect(result.reason).toBe(\"compatibility_matrix_blocked\")"],
      },
    ],
  },
]
