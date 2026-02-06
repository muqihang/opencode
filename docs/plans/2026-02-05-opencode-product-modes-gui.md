# OpenCode Product Modes (GUI) Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` and keep strict Red → Green.

**Goal:** 让 OpenCode Desktop（GUI）里有一个“模式”开关，用户可一键切换不同产品模式，从而按模式启用/禁用行业插件；默认行为保持不变（未设置 `product.mode` 时与当前一致）。

**Architecture:** 模式本质是配置字段 `product.mode`。基座负责“加载/不加载插件”的选择（allowlist 过滤），不内置行业插件实现。GUI 通过 SDK 调用 `config.update` 写入配置并触发实例 reload。

**Tech Stack:** Bun + TypeScript + SolidJS（Desktop App）+ Zod（Config schema）+ Bun test

---

## Task 0: 让全量验证命令可跑（仅配置层）

> 目的：最终验收要求 `bun test && bun run typecheck`。当前仓库根目录 `bun test` 可能被 bunfig 禁用/超时过短，需要先修好“测试入口”，否则无法在最后给出可信证据。

**Files:**
- Modify: `bunfig.toml`
- (If needed) Modify: `packages/opencode/bunfig.toml`

**Step 1: 写一个最小验证（可选）**
- 不新增代码；先确认现状：根目录 `bun test` 是否能跑、是否会超时。

**Step 2: 修复 bun test discovery root**
- 将根目录 `bunfig.toml` 的 `[test].root` 调整为实际存在且包含测试的目录（推荐 `./packages/opencode`，避免扫描整个 monorepo）。

**Step 3: 修复默认测试超时**
- 将根目录（或 opencode 包）默认 timeout 提升到 20s（覆盖 python venv / pip 类慢测试）。

**Step 4: 运行验证**
Run: `bun test`
Expected: 退出码 0

---

## Task 1: 产品模式扩展到“四种模式”（RED → GREEN）

> 现状：基座已有 `base | programming | legal`。目标：补齐 `marxism`（马哲分析）作为“预留模式”，即使插件不存在也不 crash。

**Files:**
- Modify: `packages/opencode/src/config/config.ts`
- Modify: `packages/opencode/src/session/orchestrator/policy.ts`
- Modify: `packages/opencode/src/cli/cmd/tui/component/dialog-mode.tsx`
- Test: `packages/opencode/test/config/config.test.ts`
- Test: `packages/opencode/test/session/orchestrator-fork-strategy.test.ts`

**Step 1 (RED): 在 config 测试里新增 marxism 用例**
- 在 `filterPlugins` / schema 相关 describe 中新增：
  - `Config.Info.parse({ product: { mode: "marxism" } })` 不应抛错
  - `filterPlugins(..., { mode: "marxism" })` 默认 allowlist 预期行为（默认启用未来插件名，例如 `oh-my-marxism`）

Run: `bun test packages/opencode/test/config/config.test.ts --only-failures`
Expected: FAIL（schema 不接受 marxism）

**Step 2 (GREEN): 扩展 ProductMode + schema + filterPlugins defaults**
- `ProductMode` 联合类型增加 `"marxism"`
- `Config.Info.product.mode` zod enum 增加 `"marxism"`
- `product.plugins` 增加 `marxism?: string[]`
- `filterPlugins` defaults 增加 `marxism: ["oh-my-marxism"]`

Run: `bun test packages/opencode/test/config/config.test.ts --only-failures`
Expected: PASS

**Step 3 (RED): forkStrategy 默认策略覆盖 marxism**
- 在 `orchestrator-fork-strategy.test.ts` 增加：
  - `mode: "marxism"` 且未显式配置 forkStrategy 时，默认 `suggest`

Run: `bun test packages/opencode/test/session/orchestrator-fork-strategy.test.ts --only-failures`
Expected: FAIL（类型/逻辑未覆盖）

**Step 4 (GREEN): policy.ts 类型扩展**
- 扩展 `ForkInput.product.mode` union 增加 `"marxism"`（逻辑本身无需改，现有 `mode !== "base"` 已满足）

Run: `bun test packages/opencode/test/session/orchestrator-fork-strategy.test.ts --only-failures`
Expected: PASS

**Step 5: TUI DialogMode 增加 marxism 选项（无回归）**
- `dialog-mode.tsx` options 增加“马哲分析模式”
- 确保 onSelect 写入 `product.mode` 时兼容

Run: `bun test packages/opencode/test/config/config.test.ts --only-failures`
Expected: PASS（确保基础行为不变）

---

## Task 2: GUI Settings 增加“模式”开关（工程实现）

> 验收点：Desktop 设置里可选 基础 / 编程 / 律师（并可扩展显示马哲分析），写入配置后触发实例 reload。

**Files:**
- Modify: `packages/app/src/pages/layout.tsx`（打开 settings 时传入当前 workspace directory）
- Modify: `packages/app/src/components/dialog-settings.tsx`（增加一个 Settings tab 或在 General 内新增一段）
- Create/Modify: `packages/app/src/components/settings-mode.tsx`（新增一个专门的模式设置组件，依赖 GlobalSync）
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/zh.ts`

**Step 1 (RED): 写一个最小可测的纯函数（避免 UI 单测成本过高）**
- 新增 `packages/app/src/utils/product-mode.ts` 导出：
  - `ProductMode` union type
  - `MODE_OPTIONS`（value/label/description）
- 新增 `packages/app/src/utils/product-mode.test.ts`：
  - 断言 options 至少包含 `base/programming/legal`（以及 `marxism`）

Run: `bun test packages/app/src/utils/product-mode.test.ts --only-failures`
Expected: FAIL（文件不存在）

**Step 2 (GREEN): 实现 product-mode utils**
Run: `bun test packages/app/src/utils/product-mode.test.ts --only-failures`
Expected: PASS

**Step 3: 实现 SettingsMode 组件并接入 Settings Dialog**
- 组件读取当前 active directory 的 instance config（通过 `useGlobalSync().child(directory)`）
- 下拉选择改变时：
  - 乐观更新 child store
  - 调用一个新的 `globalSync.updateInstanceConfig(directory, patch)`（若不存在则新增该 helper）
  - 失败时回滚并 toast
- UI 文案提示：切换后会重新加载（reload）

**Step 4: 手动验证（GUI）**
- 在 Desktop 打开任意 workspace → Settings → Mode
- 切换到 Programming → 观察 Plugins 列表/行为变化（或至少不报错）
- 切换到 Legal → 不应 crash（即使 oh-my-legal 未安装）

---

## Task 3: 文档交付

**Files:**
- Create: `docs/architecture/2026-02-05-opencode-product-modes-pm.md`
- Create: `docs/plans/2026-02-05-opencode-product-modes-gui-design.md`

**Step 1: PM 文档**
- 用白话解释：模式是什么、怎么切、切完会发生什么、如何回到基础模式、律师/马哲插件未实现时的表现（不会报错，只是不加载）

**Step 2: 工程设计文档**
- 配置字段：`product.mode`、`product.plugins.*`、`product.forkStrategy`
- 插件过滤：`Config.filterPlugins`（mode unset 保持旧行为）
- GUI 写配置路径 + reload 机制（`config.update` → `Instance.dispose` → globalSync reload）
- 生效范围：按当前 workspace（directory）写入 `config.json`（可被 project config/global config 覆盖）

---

## Task 4: 最终验收验证（必须留证据）

**Step 1: 全量测试**
Run: `bun test`
Expected: exit code 0

**Step 2: 全量类型检查**
Run: `bun run typecheck`
Expected: exit code 0

