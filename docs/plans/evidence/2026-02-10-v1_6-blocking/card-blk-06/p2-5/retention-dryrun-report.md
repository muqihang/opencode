# Local Safety & Retention Dry-Run Report

- generatedAt: 2026-02-12T11:45:54.483Z
- rootDir: /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p2-5-local-safety-retention
- mode: dry-run only
- deletion: not executed

## Permission Baseline
- criticalOk: true
- totalRules: 5
- driftCount: 0

| path | expected | actual | critical | status | note |
| --- | --- | --- | --- | --- | --- |
|  | 755 | 755 | true | ok | match |
| docs | 755 | 755 | true | ok | match |
| docs/plans/evidence | 755 | 755 | true | ok | match |
| packages | 755 | 755 | false | ok | match |
| packages/opencode | 755 | 755 | false | ok | match |

## Retention Dry-Run
- ttlDays: 30
- scanned: 126
- wouldDelete: 0
- totalSize: 0
- cutoffIso: 2026-01-13T11:45:54.483Z
- action: dry-run only，未执行真实删除

| path | ageDays | size | reason |
| --- | --- | --- | --- |

## Export Audit
- action: export
- sessionId: card-blk-06-p2-5-local-gov
- traceId: trace-card-blk-06-p2-5-local-gov
- owner: P2-5-LOCAL-GOV-01
- actor: local-governance-dryrun
- reason: local safety retention governance evidence
- ticket: card-blk-06/p2-5
- responsibility: owner=P2-5-LOCAL-GOV-01;actor=local-governance-dryrun;ticket=card-blk-06/p2-5

## Safety Note
- 本报告为 dry-run only；未执行真实删除动作。
