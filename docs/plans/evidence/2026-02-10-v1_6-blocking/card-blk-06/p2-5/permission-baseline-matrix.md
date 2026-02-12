# Permission Baseline Matrix（MVP）

- generatedAt: 2026-02-12T11:45:54.483Z
- scope: local critical directories
- mode: dry-run only
- deletion: not executed

- criticalOk: true
- driftCount: 0

| path | expected | actual | critical | status | note |
| --- | --- | --- | --- | --- | --- |
|  | 755 | 755 | true | ok | match |
| docs | 755 | 755 | true | ok | match |
| docs/plans/evidence | 755 | 755 | true | ok | match |
| packages | 755 | 755 | false | ok | match |
| packages/opencode | 755 | 755 | false | ok | match |

## Statement
- 本矩阵用于权限偏差判定；dry-run only，未执行真实删除。
