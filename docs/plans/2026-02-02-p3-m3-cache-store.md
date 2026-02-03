# P3 Milestone 3: Context Pack Cache Store (SSOT) Implementation Plan

> **For Claude/Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** 把“省 token / 高命中 / 工程可控”落到本地 SSOT（memory+disk 的 LRU/TTL Cache Store），并将 provider cache 仅作为“加速器指标”记录，不作为 SSOT 真相来源。

**Architecture:** 新增通用 `CacheStore`（按 project/worktree 分域）作为本地缓存 SSOT；把 context-pack（segments 复用但仍 call-scoped 落盘）、retrieval hits、verification report 三类对象接入 CacheStore，并通过稳定事件 `cache.read/cache.write/cache.hit/cache.miss` 提供可审计对账。

**Tech Stack:** Bun、TypeScript、Zod、stableJson + sha256、EvidenceWriter events/artifacts、Lock

---

## DoD（Milestone 3 验收）

### A) 本地 Cache Store（SSOT）

- 分域：按 `projectId + worktreeRoot` 隔离（Instance.worktree/Instance.directory）
- 双层：memory + disk
- 策略：LRU + TTL
- key：`stableJson(payload) -> sha256`（payload 包含充分失效输入）
- 可解释原因：`hit/miss/expired/evicted/disabled/forced_rebuild`
- 事件化：`cache.read/cache.write/cache.hit/cache.miss`
  - payload 只含 summary + artifact 指针，不塞大文本

### B) 纳入对象（至少）

- Context blocks/context-pack：缓存只跳过重计算，不跳过证据链；仍每次写 call-scoped `context-pack.json`
- Retrieval hits：基于已有 `retrievalCacheKey/workspaceFingerprint`，纳入 TTL/LRU 与可解释事件
- Verification report：pointers + policyVersion + scripts sha256/tool fingerprint → 可复用核验结果

### C) 自救开关（工程可控）

- disable cache store（全局）
- force rebuild context-pack（即使命中也重算）
- effective config 可对账（来源可追溯）

### D) 测试（无 mocks，先红后绿）

- 同输入 → 同 key：命中后不再跑重活（计数器/事件断言）
- TTL 过期语义
- disable/force rebuild 的语义与事件

**只跑：**
`cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`
