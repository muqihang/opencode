# 产品模式（基础 / 编程 / 律师）设计稿

> 目标：让用户在 OpenCode 基座里一键切换「基础模式 / 编程开发模式 / 律师助理模式」。切换后：只启用对应插件（或全关），并且不会出现“基座和插件同时派工”的冲突。

## 1. 背景（我们要解决的真实问题）

我们现在有两套“编排能力”：

- **OpenCode 基座**：单会话里有一个主助手，后面有几个“小脑”（worker）帮它快拆问题、补证据缺口、产出可执行计划；需要真正动手（改文件/跑命令）时，会进入 **fork**（派工到子会话执行）。
- **Oh-My-OpenCode 插件**：更偏“多会话团队协作”的编排：主会话像项目经理，派多个子会话并行干活，再验收合并。

商业化产品要做到：

1) 用户能“按场景切换”——基础 / 编程 / 律师（未来还会更多）  
2) 切换后**只有一个编排者负责派工**，避免重复派工/权限提示混乱/审计链路不清  
3) 插件保持独立，可复制为行业插件（换 prompt 和子代理角色即可）

## 2. 核心原则（不讲术语，讲底线）

- **不让插件去改 `process.env`**（进程级全局，容易串台，且基座读 env 还可能被“启动时缓存”）
- **所有开关都走配置**：可审计、可复现、可在 UI 里切换
- **默认行为不变**：不配置模式时，OpenCode 还是按现在的方式加载插件/执行 fork
- **基座与插件分工清晰**：
  - 基座：单会话“快拆 + 产物化（plan/证据指针）”
  - 插件（当启用某行业模式时）：多会话派工与验收推进

## 3. 配置：新增 `config.product`

在 OpenCode 配置里新增一段（可写到项目 `config.json`，也可以未来升级到全局配置）：

```jsonc
{
  "product": {
    "mode": "base", // base | programming | legal
    "plugins": {
      "common": ["some-plugin-you-always-want"],
      "programming": ["oh-my-opencode"],
      "legal": ["oh-my-legal"]
    },
    "forkStrategy": "suggest" // 可选：auto | suggest | off
  }
}
```

说明（关键点）：

- `mode`：用户看到的“模式开关”。
- `plugins.*`：这里放的是**插件名字**（canonical name），而不是版本号；OpenCode 会从现有 `config.plugin`（插件 specifier / file:// 路径）里筛出匹配的条目。
- `forkStrategy`：谁来派工的关键开关：
  - `auto`：基座在 fork 时自动 `tool:task` 派子会话
  - `suggest`：基座只给“提示式派工”（让用户/插件来派）
  - `off`：基座不派工也不提示（不推荐，只给极端场景）

默认策略（不写 `forkStrategy` 时）：

- `mode=base` → 按现有环境变量/默认逻辑（通常等同于 `auto`）
- `mode=programming` 或 `legal` → **强制建议走 `suggest`**（避免与插件重复派工）

## 4. 插件加载规则（实现“关掉插件=真的不启用”）

OpenCode 仍然会从各处收集插件（项目 `.opencode/plugin`、全局 `.opencode/plugin`、以及配置里的 `plugin` 列表）。

但当 `config.product.mode` 被设置时：

- **只启用**：`product.plugins.common + product.plugins[mode]` 里点名的插件
- **其他插件全部不启用**（即使被发现，也不会 init）
- **内置认证插件不受影响**（它们属于基座能力的一部分）

这样用户看到的“基础模式”，就是“除了基座自带能力，第三方插件全部不跑”。

## 5. 基座 fork 行为（避免与插件冲突）

当 orchestrator 进入 fork（需要写文件/跑命令）时：

- `mode=base`：允许基座按 `auto` 自动派工（符合“基座就能干活”的期待）
- `mode=programming/legal`：默认 `suggest`，基座只产出**清晰可复制的派工提示**，把派工留给插件做（或用户手动点）

## 6. TUI 交互（用户怎么“点一下就切换”）

在 TUI 里新增一个入口（Slash 命令即可）：

- `/mode`：打开选择框
  - 基础模式（Base）
  - 编程开发（Programming）
  - 律师助理（Legal）

选择后：

1) 写入 `config.product.mode`
2) 触发 instance reload（让插件加载/卸载真正生效）

## 7. 失败与降级（生产级需要“不会炸”）

- 用户选了某个模式，但对应插件没装：
  - OpenCode **不会崩溃**
  - 只是该插件不会出现在“已启用插件列表”里
  - forkStrategy 仍按模式默认走 `suggest`（避免误派工）
- 没写 `product`：完全保持老行为

## 8. 测试覆盖（只测关键行为）

- `Config.getPluginName(...)` 对 `file:///.../index.js`：应返回目录名（与 TUI 显示一致）
- `Config` 在 `product.mode` 下能正确筛选启用插件
- `SessionProcessor` 在 `mode=programming/legal` 时 forkStrategy 强制为 `suggest`（不会走 auto 派工）

