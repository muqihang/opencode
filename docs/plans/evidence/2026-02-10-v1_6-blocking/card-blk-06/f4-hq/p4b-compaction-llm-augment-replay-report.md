# F4-HQ-P4B-COMPACTION-LLM-AUGMENT Replay Report

## 变更摘要
- 在 deterministic compaction 主链之上新增异步增强应用层：
  - `compaction.assisted_applied`
  - `compaction.assisted_skipped`
- 引入前台来源标记：`ui_view_source=llm|deterministic`。
- 增加配置开关：`experimental.compaction_llm_augment`。
- 保持 fail-closed：增强失败/降级/缺证据/缺产物时一律保留 deterministic 文本。

## RED（先失败）
- 文件：`packages/opencode/test/session/compaction-structured.test.ts`
- 新增覆盖：
  1. deterministic 先可见（R1）
  2. success+verify 才应用 LLM 视图（R2）
  3. degraded/failed 保持 deterministic（R3）
  4. `compaction.assisted_applied` / `compaction.assisted_skipped` 事件字段（R4）
  5. `experimental.compaction_llm_augment` 关闭时仅 deterministic（R5）
  6. 前台可见文本不含 JSON 标签/块，覆盖 success/degraded/failed 三路径

RED 命令（反向断言失败）：
```bash
cd .worktrees/wt-v16-f4-hq-p4b-compaction-llm-augment/packages/opencode
if bun test test/session/compaction-structured.test.ts --bail; then
  echo "RED_UNEXPECTED_PASS" && exit 1
fi
```

RED 结果：
- 首轮（依赖未安装）失败原因无效，先补 `bun install`。
- 复跑后按预期失败：`compaction.assisted_applied` 未出现，证明新断言确实先红。

## GREEN（最小修复）
### 代码实现
1. `packages/opencode/src/session/capsule-assisted.ts`
   - `runFromCompaction()` 改为返回结构化结果：`status/verifyOk/reasonCode/coverage/viewText/artifacts`。
   - flag 关闭时返回 `status=disabled`，不抛错。

2. `packages/opencode/src/session/compaction.ts`
   - deterministic summary 先落盘并可见。
   - 异步执行 augment 应用层（不 await，不阻塞主链）。
   - 新增门禁：
     - 配置关闭 -> skipped(`disabled`)
     - failed/degraded -> skipped(`assisted_failed|assisted_degraded`)
     - verify 不通过 -> skipped(`verify_failed`)
     - view 缺失 -> skipped(`artifact_missing`)
     - 命中 JSON 泄露拦截 -> skipped(`verify_failed`)
   - 成功门禁通过后覆盖 summary 文本并发 `compaction.assisted_applied`。

3. `packages/opencode/src/config/config.ts`
   - 新增 `experimental.compaction_llm_augment` schema。
   - 默认值回落到 `Flag.OPENCODE_EXPERIMENTAL_CAPSULE_LLM`。

4. `packages/opencode/test/session/compaction-structured.test.ts`
   - 新增 success/degraded/failed/disabled 四条路径断言。
   - 新增前台文本 JSON 泄露回归断言。

## 验证命令与结果
1. `bun run typecheck` ✅
2. `bun test test/session/compaction-structured.test.ts test/session/compaction-structured-regression.test.ts test/session/compaction.test.ts test/session/capsule-assisted-verifier.test.ts --bail` ✅

## 职责边界确认
- deterministic 主链：始终先完成并可见。
- LLM augment：异步、可失败、可跳过、不可替代主链。
- 前台仅显示自然语言摘要；JSON 仅保留在 artifacts/evidence。

## 风险与回退策略
### 风险
1. augment 事件增加后，下游事件消费端如做严格枚举需同步更新。
2. 若未来更改 assisted 渲染格式，需维持 JSON 泄露拦截规则与测试同步。

### 回退（Fail-Closed）
1. 一键关闭：`experimental.compaction_llm_augment=false`。
2. 运行时失败：自动落 `compaction.assisted_skipped`，前台保留 deterministic。
3. 安全门禁失败：不应用增强，不污染主输出。

