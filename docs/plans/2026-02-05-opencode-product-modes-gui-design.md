# OpenCode Product Modes (GUI) - Engineering Design

> 目标：把“产品模式开关”做成可交付能力：TUI 不回归、GUI 可切换模式、切换后 reload 生效；默认行为保持不变（未设置 `product.mode` 时与当前一致）。

## 1. 配置字段（Config schema）

OpenCode 配置新增/维护 `product` 段（均为可选字段）：

```ts
product?: {
  mode?: "base" | "programming" | "legal" | "marxism"
  plugins?: {
    common?: string[]
    base?: string[]
    programming?: string[]
    legal?: string[]
    marxism?: string[]
  }
  forkStrategy?: "auto" | "suggest" | "off"
}
```

实现位置：
- `packages/opencode/src/config/config.ts`

关键点：
- `product.mode` **不设置**时必须保持旧行为（legacy）：
  - 不做插件过滤（等价于“加载所有已发现插件”）
  - forkStrategy 走原有逻辑（`env ?? "auto"`）

## 2. 插件过滤（只做“加载/不加载”的选择）

### 2.1 数据来源

OpenCode 会从多个来源收集插件 specifier（npm 包名 / file:// URL），主要包括：
- 全局/项目 `.opencode/plugin(s)/*.{ts,js}`
- 配置里的 `plugin: string[]`

最终在 `Config.get()` 里会做两件事：
1) `deduplicatePlugins()`：按插件 canonical name 去重，后加载的优先
2) `filterPlugins()`：当 `product.mode` 被设置时，按 allowlist 筛选可启用插件

实现位置：
- `packages/opencode/src/config/config.ts`：`Config.filterPlugins()` / `Config.getPluginName()`

### 2.2 allowlist 规则

当 `product.mode` 被设置时：

```
allow = Set(product.plugins.common + product.plugins[mode])
```

如果 `product.plugins` 未提供，则使用默认值：

- `base` → `[]`
- `programming` → `["oh-my-opencode"]`
- `legal` → `["oh-my-legal"]`
- `marxism` → `["oh-my-marxism"]`（预留）

匹配时使用 canonical plugin name（`getPluginName()` 会把 `oh-my-opencode@2.4.3` 归一为 `oh-my-opencode`；也会把 `file:///.../dist/index.js` 归一为目录名）。

### 2.3 插件不存在时的行为

allowlist 只用于“从已发现插件列表里筛选”，因此：
- 用户切到 `legal` 但没装 `oh-my-legal` → 只是不加载该插件，不会 crash

## 3. forkStrategy 默认策略（避免基座与行业插件重复派工）

实现位置：
- `packages/opencode/src/session/orchestrator/policy.ts`：`resolveForkStrategy()`

规则：
1) 若显式配置 `product.forkStrategy` → 直接使用
2) 否则若 `product.mode` 存在且不等于 `base` → 默认 `suggest`
3) 否则回退到 `env ?? "auto"`

这保证了：在行业模式下，基座默认只给“提示式派工”，把多会话派工权交给插件（或用户）。

## 4. 配置写入路径（TUI / GUI）

### 4.1 为什么用 `config.json`

API 侧 `config.update` 走的是 `Config.update()`，写入路径为：

`<Instance.directory>/config.json`

实现位置：
- `packages/opencode/src/config/config.ts`: `Config.update()`

为了让这份 UI 管理的配置真正生效，`Config.get()` 需要把 `config.json` 作为项目配置的一部分加载。

实现位置：
- `packages/opencode/src/config/config.ts`: project config 搜索从 `["opencode.jsonc","opencode.json"]` 扩展为 `["opencode.jsonc","opencode.json","config.json"]`

并且把 `config.json` 放在最后加载（最高优先级），确保 UI 切换能覆盖手写配置（如果未来需要“手写覆盖 UI”，再反过来即可）。

### 4.2 TUI（不回归）

实现位置：
- `packages/opencode/src/cli/cmd/tui/component/dialog-mode.tsx`

行为：
- 读取当前 config：`sync.data.config.product?.mode`
- 选择后调用：`sdk.client.config.update({ config: { product: { mode: next } }})`

### 4.3 GUI（Desktop Settings）

实现位置：
- `packages/app/src/components/settings-mode.tsx`
- `packages/app/src/components/dialog-settings.tsx`
- `packages/app/src/pages/layout.tsx`
- `packages/app/src/context/global-sync.tsx`

交互流程（以“当前工作区”为作用范围）：
1) `layout.tsx` 打开 Settings 时，把当前路由 workspace 的 `directory` 传给 `<DialogSettings directory={...} />`
2) Settings 里新增 “Mode” tab，渲染 `<SettingsMode directory={directory} />`
3) `SettingsMode` 通过 `useGlobalSync().child(directory)` 拿到该 workspace 的 instance config
4) 用户选择 mode 后：
   - 乐观更新 child store
   - 调用 `globalSync.updateInstanceConfig(directory, { product: { mode } })`

### 4.4 reload 机制（为什么“切换后会生效”）

Server 侧：
- `Config.update()` 写文件后调用 `Instance.dispose()` → 触发 `server.instance.disposed` 事件

Desktop 侧（GlobalSync）：
- `updateInstanceConfig()` 在发请求前设置 `globalStore.reload = "pending"`
- 收到 `server.instance.disposed` 时，如果 reload pending → 把目录放进 `bootstrapQueue`
- 1s 后置 `reload = "complete"` → 触发 `bootstrapInstance(directory)` 重新拉取 config / plugins / status

因此：切换模式后无需重启应用，也能让插件加载列表刷新。

## 5. 测试与验收点

### 5.1 核心逻辑测试（opencode）

- `packages/opencode/test/config/config.test.ts`
  - `filterPlugins` 覆盖：base / programming / legal / marxism
  - `Config.Info` schema 接受 `product.mode = marxism`
  - 新增：项目 `config.json` 会被加载，并触发 `product.mode` + 插件过滤

- `packages/opencode/test/session/orchestrator-fork-strategy.test.ts`
  - non-base mode 默认 `suggest`（覆盖 legal / marxism）

### 5.2 GUI 最小可测单元（app）

- `packages/app/src/utils/product-mode.test.ts`
  - 保证 mode options 至少包含 `base/programming/legal/marxism`

### 5.3 人工验收（Desktop）

1) 打开任意 workspace → Settings → Mode
2) 切换到 Programming → 实例 reload；插件列表（Status Popover → Plugins）变化或至少不报错
3) 切换到 Legal / Marxism → 即使未安装插件也不 crash

