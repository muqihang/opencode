# Codex CLI Notes (chelingxi workspace)

面向在本地使用 Codex CLI + MCP 的同学，快速理解：
- `codex exec` 是什么、适合用来做什么
- `~/.codex/log/codex-tui.log` 是什么、怎么用来定位问题
- 还有哪些常用命令/目录（配置、会话、MCP 管理、沙盒等）

本文假设你在 macOS/Linux 上使用（Windows/WSL 的目录结构与命令略有差异）。

## 1. Codex CLI 的两种主要运行形态

### 1.1 交互式（TUI）

直接运行：

```bash
codex
```

特点：
- 进入交互 UI（TUI），你可以持续对话、反复改 prompt、让 agent 多轮执行
- 同一次会话内通常会复用上下文、工具连接（例如 MCP server 的生命周期由 Codex 管理）
- 适合：日常开发协作、探索式调试、长任务

### 1.2 非交互式（`codex exec`）

`codex exec` 是“跑完就退出”的一次性执行模式（batch mode）。

常见用法：

```bash
codex exec "请帮我在当前仓库里做 XXX，然后退出"
```

关键特点：
- 会启动一个新的 Codex 实例执行任务，然后退出
- 默认也会加载 `~/.codex/config.toml`（可以用 `-c` 临时覆盖配置）
- 更易于脚本化/自动化；可以用 `--json` 输出结构化事件流，便于机器解析/回放/做证据

典型场景（强烈推荐）：
- **验证 MCP 是否可用**：只调用一次 MCP tool（health check / search），作为可复现证据
- **复现 bug**：把交互式里不稳定的问题，收敛成一次性命令复现（减少变量）
- **CI/脚本**：把 agent 行为“固定化”为可重复执行的任务

## 2. `~/.codex/log/codex-tui.log` 是什么？

`~/.codex/log/codex-tui.log` 是 Codex 交互式 TUI 的运行日志（类似“飞行记录仪 / 黑盒”），主要用于诊断：
- MCP 连接生命周期：启动、握手、列出 tools、工具调用失败原因
- 协议/序列化错误：例如 stdio MCP 协议被污染时，会看到 `serde error ...`
- TUI 行为：模型选择、任务中断、退出等事件

它不是“控制上下文”的工具；它是“记录发生了什么”的证据源。

你会在这个日志里经常看到：
- `MCP server stderr (...)`：表示某个 MCP server 往 stderr 打的日志被 Codex 收集到了
- `MCP tool call error: ... Transport closed`：表示 MCP 子进程或连接提前关闭（常见原因见下方）

### 2.1 常见 MCP 故障：`Transport closed` / `serde error`

在 stdio MCP 场景里，**stdout 通常是 MCP 协议帧**。如果 server/依赖库把“人类日志”写到了 stdout，会污染协议流，导致：
- 客户端解析失败（常见 `serde error expected value at line ...`）
- 随后连接被关闭（表现为 `Transport closed`）

排查与修复建议：
- MCP server 端：把日志写到 stderr（`console.warn` / `process.stderr.write`），不要写 stdout
- 客户端侧：用 `codex exec --json` 做最小复现并收集证据

## 3. 配置与上下文：哪些东西真的会影响行为？

### 3.1 `~/.codex/config.toml`

这是 Codex CLI 的主配置，常见内容包括：
- 模型选择（provider、model、reasoning effort）
- MCP servers 配置（stdio/http，command/args/env/cwd）
- 输出语言、行为规则、沙盒策略等

你可以用 `-c` 临时覆盖配置（不改文件）：

```bash
codex -c model=\"gpt-5.2-codex\"
codex exec -c 'features.some_feature=true' "..."
```

### 3.2 项目级指令（例如 `AGENTS.md` / `CLAUDE.md`）

这类文件属于“项目约束/工作流说明”，会影响 agent：
- 推荐的质量门禁命令、测试策略
- 代码风格、错误处理、提交规范等

### 3.3 工作目录（`cwd` / `-C` / MCP 的 `cwd`）

很多“看起来像上下文”的差异，实际上来自工作目录不同：
- 相对路径解析不同
- 读取的 `.env` 文件不同
- Node/NPM workspace、monorepo 的依赖解析不同

建议在复现/脚本化时明确 `-C`：

```bash
codex exec -C /Users/muqihang/chelingxi_workspace "..."
```

## 4. MCP 相关：管理与诊断命令

Codex 带了一个 MCP 管理子命令（实验性）：

```bash
codex mcp list
codex mcp get <name>
codex mcp add ...
codex mcp remove <name>
```

常用诊断流程：
1) 看 MCP 是否启用、command/args/env/cwd 是否符合预期：

```bash
codex mcp list
codex mcp get chelingxi-intel-hub
```

2) 用 `codex exec` 做“最小 tool call”验证（建议加 `--json` 方便证据化）：

```bash
codex exec --json -C /Users/muqihang/chelingxi_workspace \
  '只调用 MCP 工具 chelingxi-intel-hub/intel_hub_health_check，然后输出 overallStatus 和 healthScore。不要运行任何 shell 命令。'
```

说明：
- 这种方式可以把“交互式里偶发”的问题，收敛为“可复现的一条命令”
- 尤其适合定位 MCP 的 `Transport closed`、环境变量缺失、cwd 错误、协议被污染等问题

## 5. 其他你可能会用到的 Codex CLI 能力

### 5.1 会话恢复/分叉

```bash
codex resume
codex fork
```

用途：
- `resume`：继续上一次交互式会话（方便追踪上下文与已做的改动）
- `fork`：从某次会话分叉出新分支（避免把探索性尝试污染到主线会话）

### 5.2 代码审查（非交互）

```bash
codex review
```

用途：
- 偏“静态审查”模式，适合做检查清单式的代码风险扫描

### 5.3 作为 MCP Server 运行（实验性）

```bash
codex mcp-server
```

用途：
- 让 Codex 自己作为一个 MCP server 被外部客户端调用（使用场景较少，但做工具链集成时会用到）

### 5.4 沙盒相关（调试/受控执行）

```bash
codex sandbox --help
```

用途：
- 理解/调试命令执行策略、权限边界（不同环境可能策略不同）

## 6. 常见目录速查（`~/.codex/`）

不同版本可能略有差异，但常见结构如下：
- `~/.codex/config.toml`：主配置（模型/MCP/规则等）
- `~/.codex/log/codex-tui.log`：交互式 TUI 日志（诊断 MCP/运行错误）
- `~/.codex/sessions/**`：会话记录（用于 resume/fork 等）
- `~/.codex/history.jsonl`：历史记录（更偏“使用轨迹”）
- `~/.codex/skills/**`：自定义 skills（个人/项目技能）
- `~/.codex/superpowers/**`：superpowers 系统相关内容
- `~/.codex/tmp/**`：临时文件（不同版本/环境可能存在）

## 7. 实战小抄：如何验证一个 MCP 工具“真的能用”

推荐顺序：
1) `codex mcp list`：确认 MCP 启用且配置正确
2) `codex exec --json`：只调用一次 tool（比如 `intel_hub_health_check`）
3) 如果失败：
   - 去看 `~/.codex/log/codex-tui.log` 里对应的报错（`serde error` / `Transport closed` / auth required）
   - 对 stdio MCP：确认 server 没往 stdout 打日志（应改用 stderr）
   - 对 http MCP：确认鉴权/网络/代理配置

---

如果你希望这份笔记更贴近团队工作流，我建议你选一个“团队最常见使用方式”的方向：
1) 偏开发：重点写 MCP/日志/复现脚本
2) 偏使用：重点写常用命令清单与 FAQ
3) 偏运维：重点写配置管理、安全与证据化

你更希望偏哪一种？

