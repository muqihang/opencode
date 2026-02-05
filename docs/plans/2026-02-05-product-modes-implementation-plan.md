# Product Modes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 OpenCode 基座实现“模式切换”：基础 / 编程 / 律师。切换后只启用对应插件，并自动把 fork 派工策略切到安全的默认值（避免基座与插件重复派工）。

**Architecture:** 在 `Config.Info` 增加 `product` 字段；`Config.get()` 末尾根据 `product.mode` 对 `config.plugin` 做筛选；`SessionProcessor` 读取 `Config.get()` 来决定 forkStrategy（插件模式默认 suggest）；TUI 增加 `/mode` 对话框来写配置并触发 reload。

**Tech Stack:** Bun, TypeScript, Zod, Solid TUI, OpenCode SDK v2.

---

## Task 1: 添加 `config.product` schema（只加字段，不改行为）

**Files:**
- Modify: `packages/opencode/src/config/config.ts`
- Test: `packages/opencode/test/config/config.test.ts`

**Step 1: Write failing test**

在 `packages/opencode/test/config/config.test.ts` 增加一个解析测试，确保 `product` 字段能被 schema 接受：

```ts
expect(() => Config.Info.parse({ product: { mode: "base" } })).not.toThrow()
```

**Step 2: Run test to verify it fails**

Run: `cd packages/opencode && bun test test/config/config.test.ts`  
Expected: FAIL（schema 不认识 product）

**Step 3: Implement minimal schema**

在 `Config.Info` 增加：
- `product.mode?: "base" | "programming" | "legal"`
- `product.plugins?: { common?: string[]; base?: string[]; programming?: string[]; legal?: string[] }`
- `product.forkStrategy?: "auto" | "suggest" | "off"`

**Step 4: Run test**

Run: `cd packages/opencode && bun test test/config/config.test.ts`  
Expected: PASS

**Step 5: Commit**

`git commit -am "feat(config): add product mode fields"`

---

## Task 2: 改进 `Config.getPluginName()`（支持 file://.../index.js → 目录名）

**Files:**
- Modify: `packages/opencode/src/config/config.ts`
- Test: `packages/opencode/test/config/config.test.ts`

**Step 1: Write failing test**

```ts
expect(Config.getPluginName("file:///path/to/oh-my-opencode/dist/index.js")).toBe("dist")
// 或者更合理：返回 package 目录名（取 index 的上一层目录）
```

（根据实现细节确认预期：与 TUI status 里“index 用 dirname”一致。）

**Step 2: Verify RED**

Run: `cd packages/opencode && bun test test/config/config.test.ts`  
Expected: FAIL（当前返回 "index"）

**Step 3: Implement minimal logic**

当 file:// 路径 basename 为 `index` 时，返回其父目录名（如果有）。

**Step 4: Verify GREEN**

Run: `cd packages/opencode && bun test test/config/config.test.ts`  
Expected: PASS

**Step 5: Commit**

`git commit -am "fix(config): treat file index plugin name as dirname"`

---

## Task 3: 根据 `product.mode` 筛选启用插件（实现“关掉=不启用”）

**Files:**
- Modify: `packages/opencode/src/config/config.ts`
- Test: `packages/opencode/test/config/config.test.ts`

**Step 1: Write failing test**

新增纯函数（建议导出）：
- `Config.filterPlugins(plugins, product)` → 返回筛选后的 plugin specifiers

测试用例：
- mode=base + common=[] → 返回 []
- mode=programming + programming=["oh-my-opencode"] → 只返回 name 匹配的 specifier
- common 会叠加

**Step 2: Verify RED**

Run: `cd packages/opencode && bun test test/config/config.test.ts`  
Expected: FAIL（函数不存在/行为不对）

**Step 3: Implement minimal filter**

在 `Config.state` 最后（`deduplicatePlugins` 后）应用 filter：

- `product.mode` 未设置 → 不筛选（保持旧行为）
- 否则只保留 allowlist（common + mode-list）

**Step 4: Verify GREEN**

Run: `cd packages/opencode && bun test test/config/config.test.ts`  
Expected: PASS

**Step 5: Commit**

`git commit -am "feat(config): filter plugins by product mode"`

---

## Task 4: forkStrategy 跟随模式（插件模式默认 suggest）

**Files:**
- Modify: `packages/opencode/src/session/orchestrator/policy.ts`
- Modify: `packages/opencode/src/session/processor.ts`
- Test: `packages/opencode/test/session/orchestrator-secure-output-policy.test.ts` 或新建 `.../orchestrator-fork-strategy.test.ts`

**Step 1: Write failing test**

新增一个纯函数（建议导出）：
- `resolveForkStrategy({ mode, strategy, env })`

用例：
- mode=programming 且未显式 strategy → 返回 "suggest"
- mode=base 且未显式 strategy 且 env 未设 → 返回 "auto"
- mode=legal 且 strategy="off" → 返回 "off"

**Step 2: Verify RED**

Run: `cd packages/opencode && bun test test/session/orchestrator-fork-strategy.test.ts`  
Expected: FAIL（函数不存在）

**Step 3: Implement minimal logic + wire in**

在 `SessionProcessor` 的 fork 分支里：
- 读取一次 `const config = await Config.get()`
- 用 `resolveForkStrategy(...)` 决定最终 strategy

**Step 4: Verify GREEN**

Run: `cd packages/opencode && bun test test/session/orchestrator-fork-strategy.test.ts`  
Expected: PASS

**Step 5: Commit**

`git commit -am "feat(orchestrator): resolve fork strategy from product mode"`

---

## Task 5: TUI 增加 `/mode` 切换入口

**Files:**
- Create: `packages/opencode/src/cli/cmd/tui/component/dialog-mode.tsx`
- Modify: `packages/opencode/src/cli/cmd/tui/app.tsx`

**Step 1: Implement dialog**

对话框列出 3 个选项，选中后调用：

```ts
await sdk.client.config.update({ config: next }, { throwOnError: true })
```

并关闭 dialog。配置写入后 instance 会被 dispose，TUI 会自动 bootstrap。

**Step 2: Manual sanity check**

（若可运行）启动 TUI，输入 `/mode`，切换后在 status 里看到插件数量变化。

**Step 3: Commit**

`git add ... && git commit -m "feat(tui): add /mode product mode switcher"`

---

## Task 6: 全量验证

**Step 1: Run full package tests**

Run: `cd packages/opencode && bun test`  
Expected: exit 0

**Step 2: (Optional) Typecheck**

Run: `bun run typecheck`（按项目约定）

**Step 3: Ready for merge**

输出：
- `git status --porcelain` 为空
- `git log -n 5 --oneline`

