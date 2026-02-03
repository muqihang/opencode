# Memory / Training Data Governance（设计稿）

日期：2026-02-03  
状态：Draft（待实现）  
范围：P3+ / P4 候选（不阻塞 P3 的 Milestone 5/6，但为后续实现固化 DoD 与边界）  

## 0. 背景与动机

P3 已把“上下文工程”落成可审计的 SSOT（Evidence/Artifacts/Manifest/Events、Pointers、Verifier、CacheStore、Usage Normalizer 等）。这些资产具有两类高价值用途：

1) **产品体验**：让系统“越用越懂用户”，减少重复解释与重复上下文注入（结构化记忆）。  
2) **模型改进**：形成“可核验、可对账”的高质量训练/评测语料（SFT/RLHF/Evals），尤其对“引用/可信输出”类能力极其关键。

但这两类用途都存在同一个根风险：**隐私与信任**。因此本设计将“数据治理”定义为一等能力：默认不上传、默认不记忆、默认可解释、默认可撤回。

## 1. 术语（对齐口径）

- **资产（Assets）**：会话产生的本地落盘证据与产物，例如 `.opencode/evidence/**`、`.opencode/artifacts/**`、`manifest.json`、`events.jsonl`、CacheStore entries 等。
- **捐赠（Donation）**：用户显式选择，将一部分资产导出为“训练包/诊断包”，用于改进模型或产品（默认关闭）。
- **记忆（Memory）**：跨 turn / 跨会话可复用的偏好/事实/环境信息，必须可查看、可编辑、可删除（forget）。
- **候选记忆（Memory Candidate）**：系统提取但未生效的“建议记忆条目”，必须由用户确认后才能生效（默认）。

## 2. 核心原则（硬约束）

1) **默认关闭（Opt-in）**：训练数据捐赠默认关闭；自动记忆默认关闭（或仅生成候选，不自动生效）。  
2) **可解释（Explainable）**：任何“记住了什么 / 上传了什么 / 清理了什么”必须有可审计的事件与可回放的本地证据（payload 只放 summary + pointers）。  
3) **最小化（Minimize）**：不采集不必要的 raw；优先使用 pointers、摘要、结构化字段。  
4) **可撤回（Revocable）**：用户可以随时删除记忆条目；捐赠前可预览、可取消。  
5) **敏感默认拒绝（Deny by default for sensitive）**：密钥、证件、支付信息、医疗等敏感信息默认禁止进入记忆与训练包；只能在明确识别并提示后允许（初期建议直接禁止）。  
6) **本地优先（Local-first）**：本地保留服务于“可回放/可审计/性能”；云端/训练用途必须显式动作触发。

## 3. 保留策略（Retention）— 默认“面向通用用户”

### 3.1 分类治理（不同资产不同命运）

1) **CacheStore（性能缓存）**  
   - TTL/LRU 由 CacheStore 自己治理（已实现）。  
2) **Evidence/Artifacts（可信证据）**  
   - 默认保留一段时间（建议 30 天），或受磁盘上限约束（建议 2GB）。  
   - 支持用户“置顶/固定（Pin）”会话：Pinned 不自动清理。  
3) **Export（用户显式导出包）**  
   - 默认长期保存（由用户选择保存位置/删除）。

### 3.2 清理行为必须可对账

任何自动/手动清理必须写事件（不塞大文本）：

- `retention.sweep_started` / `retention.sweep_completed`
- `retention.session_pruned`（指针化：sessionID + reason + freedBytes + artifact pointers）

并提供“可预览”模式（dry-run）供 UI 展示将删除哪些会话/资产。

## 4. 训练/微调数据捐赠（Donation）— 默认关闭

### 4.1 产品形态

- 设置项：`Help improve models (Donation)` 默认 off。  
- 入口：会话级导出（建议从 Evidence Pack 页面进入）。  
- 流程：生成候选导出包 → redaction 扫描 → 用户预览 → 用户确认 → 导出/上传。

### 4.2 数据最小化（推荐导出结构）

导出包以“结构化 + 指针化”为主，避免把 raw 对话原文当作默认 payload：

- `donation.manifest.json`（条目级：kind/path/sha256/size）
- `events.jsonl`（仅 summary + pointers）
- `verification.report.json`（支持/未知标签）
- `assistant-claims.json`（fact/plan/opinion 结构）
- 可选：`capsule.md`（compaction 产物）
- 禁止默认包含：原始 provider response、完整源码/文档正文（除非用户显式勾选）。

### 4.3 Redaction（先扫描再导出）

使用 toolbelt 的 `redaction-scan` 作为强制步骤：

- 扫描输出写入本地 artifact（可回放）：`donation/<id>.redaction.json`
- 若检测高风险：默认阻断导出，要求用户显式确认或移除敏感条目后重试。

## 5. 记忆系统（Memory）— 候选优先 + 用户确认

### 5.1 Memory 的最小结构

- 分域：`global` + `project`（至少两级）  
- 每条记忆必须带：`type`（preference/fact/environment）、`text`、`confidence`、`createdAt`、`sourcePointers[]`
- 禁止存储：密钥/隐私类（硬规则）。

### 5.2 从资产提取记忆（Candidates）

默认行为：只生成候选，不自动生效。

- 后台任务定时扫描（或在 session idle 时触发），输出 `memory.candidates.json`
- UI 提示用户：“我们建议记住 3 条偏好/环境信息（可查看/编辑/拒绝）”

事件化：
- `memory.scan_started` / `memory.scan_completed`（summary + pointers）
- `memory.candidate_created`（仅摘要 + 指针）
- `memory.item_saved` / `memory.item_deleted`（可对账）

## 6. DoD（Definition of Done）

### 6.1 产品/配置

- 默认：Donation off；Memory auto-save off（只候选）。  
- GUI 提供：开关、候选确认、记忆库管理（查看/编辑/删除）。  
- Retention：30 天或 2GB（可配置），Pinned 不删；提供一键清理与预览。

### 6.2 安全与合规

- 导出前必须 redaction-scan；高风险默认阻断。  
- 所有事件 payload 只允许 summary + pointers（禁止塞原文/大文本）。  

### 6.3 工程与测试

- 记忆提取/导出包生成必须是确定性的（stable sort、stableJson、sha256）。  
- 至少一条端到端测试：候选生成 → 用户确认 → 生效注入（不需要真实网络）。  

## 7. 不在本设计内（明确不做）

- 不做“默认上传训练数据”。  
- 不做“黑盒自动记忆且不可见”。  
- 不做“把所有 raw 对话/文件默认塞进导出包”。  

