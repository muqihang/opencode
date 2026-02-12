# probe-journal/1.0 最小规范（P0-A7）

- Card: `CARD-BLK-06 / P0-A7`
- 范围: `packages/opencode/src/retrieval/runner.ts` 的 retrieval/session 链路
- 目标: 在不改变检索业务语义前提下，补齐 probe 账本最小字段、落盘路径与可审计透传

## 1) 结构定义

`probe-journal/1.0` 当前最小结构如下（以落盘 JSON 为准）：

```json
{
  "specVersion": "probe-journal/1.0",
  "probeId": "<retrievalId>",
  "retrievalId": "<retrievalId>",
  "sessionId": "<sessionId>",
  "messageId": "<messageId>",
  "dedupeKey": "<retrievalCacheKey>",
  "why": "retrieval runner probe for evidence planning and message-level dedupe audit",
  "queries": [
    { "role": "precision", "q": "...", "lang": "auto", "kind": "code" },
    { "role": "recall", "q": "...", "lang": "auto", "kind": "code" }
  ],
  "expectedEvidence": {
    "artifacts": [
      "retrieval/<retrievalId>/retrieval.spec.json",
      "retrieval/<retrievalId>/hits.json",
      "retrieval/<retrievalId>/dedupe.report.json"
    ],
    "topK": 5
  },
  "dedupe": {
    "by": "messageId+dedupeKey",
    "duplicate": false,
    "seen": 1
  },
  "createdAtUtc": "<iso8601>"
}
```

## 2) 字段定义与来源

| 字段 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `specVersion` | string | 常量 | 固定为 `probe-journal/1.0` |
| `probeId` | string | `retrievalId` | 最小实现将 probe 与本次 retrieval 一一对应 |
| `messageId` | string | `runRetrieval(input.messageId)` | 作为 dedupe 维度之一 |
| `dedupeKey` | string | `retrievalCacheKey({ plan, workspace })` | 与现有 retrieval cache 口径对齐 |
| `why` | string | 常量描述 | 说明本 probe 用于证据规划与 message 级去重审计 |
| `queries` | array | `buildPlan(intentText).queries` | 复用现有 retrieval 计划查询，不引入新语义 |
| `expectedEvidence` | object | 当轮 artifact 结果 | 记录预期证据路径（spec/hits/dedupe/errors）与 topK 预算 |
| `dedupe.by` | string | 常量 | 固定 `messageId+dedupeKey` |
| `dedupe.duplicate` | boolean | 运行时计数 | 同 `sessionId` 下，按 `messageId+dedupeKey` 扫描历史 probe |
| `dedupe.seen` | number | 运行时计数 | 命中条目数（当前条目写入前计数 + 1） |

## 3) 落盘与透传

- 落盘路径：`retrieval/<retrievalId>/probe.journal.json`
- manifest kind：`retrieval-probe-journal`
- retrieval 终态事件 `data.artifacts` 新增 `probe`
- retrieval 终态事件 `data.probe` 透传去重摘要：`dedupeKey/duplicate/seen`
- `runRetrieval()` 返回值 `artifacts` 新增 `probe` 字段（相对路径）

## 4) 与 DoD 的映射

- DoD-1：`probeId/dedupeKey/why/expectedEvidence` 已在结构中固定并落盘。
- DoD-2：probe 与 retrieval 事件/artifact 关联已接入，支持 message 级审计。
- DoD-3：`dedupe.duplicate + dedupe.seen` 为 `duplicate_probe_rate` 提供原始计数来源。

## 5) 风险与回滚动作

- 风险1：目录扫描统计增加 I/O（每次 retrieval 扫描 session 下 probe 文件）。
  - 回滚动作：移除 `countProbeMatches()` 调用，仅保留 `seen=1/duplicate=false` 占位。
- 风险2：`artifacts` 新增 `probe` 可能影响强依赖固定字段的下游。
  - 回滚动作：保留 probe 文件写入，移除返回值与事件中的 `probe` 透传。
- 风险3：spec 字段扩展后，未同步文档可能造成口径漂移。
  - 回滚动作：以本文件为基线，变更必须先更新本 spec 再改实现。

## 6) 最小验收命令（A6）

> 说明：以下为本卡要求的最小验收命令，实际退出码见 `probe-journal-dedupe-report.md` 的“验收结果”章节。

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a7-probe-journal/packages/opencode && bun run typecheck
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a7-probe-journal/packages/opencode && bun test test/retrieval/code.test.ts test/retrieval/runner.test.ts --bail
test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a7-probe-journal/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a7/probe-journal-spec.md
test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a7-probe-journal/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a7/probe-journal-dedupe-report.md
```
