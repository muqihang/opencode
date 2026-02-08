import { describe, expect, it } from "bun:test"
import { extractPointers, getFailureSuggestions, mapActivityItem } from "./activity-narrative"
import type { ActivityItem, EventV1 } from "@/lib/chronology/types"

const mockEvent = (overrides: Partial<EventV1> = {}): EventV1 => ({
  specVersion: "event/1.0",
  sessionId: "test-session",
  severity: "info",
  redaction: { mode: "none" },
  type: "tool.started",
  ts: "2024-01-01T00:00:00.000Z",
  actor: "test",
  summary: "test summary",
  data: {},
  ...overrides,
} as EventV1)

const mockItem = (overrides: Partial<ActivityItem> = {}): ActivityItem => ({
  id: "test-id",
  category: "tool",
  status: "running",
  title: "Test Title",
  summary: "Test Summary",
  tsStart: "2024-01-01T00:00:00.000Z",
  events: [mockEvent()],
  ...overrides,
})

describe("activity-narrative", () => {
  describe("status translation", () => {
    it("maps running status", () => {
      const item = mockItem({ status: "running" })
      const result = mapActivityItem(item)
      expect(result.badgeZh).toBe("进行中") // Or similar, prompt says "正在..." verb usually
    })

    it("maps failed status", () => {
      const item = mockItem({ status: "failed" })
      const result = mapActivityItem(item)
      expect(result.badgeZh).toBe("失败")
      expect(result.severity).toBe("error")
    })

    it("maps done status", () => {
      const item = mockItem({ status: "done" })
      const result = mapActivityItem(item)
      expect(result.badgeZh).toBeUndefined()
    })
  })

  describe("noise filtering", () => {
    it("marks known noisy events as noise", () => {
      const item = mockItem({ 
        category: "other", 
        title: "sandbox.backend_selected",
        events: [mockEvent({ type: "sandbox.backend_selected" })] 
      })
      const result = mapActivityItem(item)
      expect(result.isNoise).toBe(true)
    })

    it("marks milestones as not noise", () => {
      const item = mockItem({ 
        category: "other",
        title: "worktree.merge_skipped",
        events: [mockEvent({ type: "worktree.merge_skipped" })] 
      })
      const result = mapActivityItem(item)
      expect(result.isMilestone).toBe(true)
      expect(result.isNoise).toBe(false)
      expect(result.titleZh).toContain("里程碑")
    })
  })

  describe("tool execution narrative", () => {
    it("maps generic tool execution", () => {
      const item = mockItem({ 
        category: "tool", 
        title: "Tool: unknown",
        events: [mockEvent({ type: "tool.started", actor: "unknown" })] 
      })
      const result = mapActivityItem(item)
      expect(result.titleZh).toBe("正在执行命令…") // Fallback
    })

    it("adds tool name subtitle when command is unavailable", () => {
      const item = mockItem({
        category: "tool",
        events: [mockEvent({ type: "tool.started", actor: "tool:bash" })],
      })
      const result = mapActivityItem(item)
      expect(result.subtitleZh).toBe("工具：bash")
    })

    it("detects test commands from data", () => {
      const item = mockItem({ 
        category: "tool",
        events: [mockEvent({ 
          type: "tool.started", 
          data: { command: "bun test src" } 
        })] 
      })
      const result = mapActivityItem(item)
      expect(result.titleZh).toBe("正在运行测试…")
    })

    it("detects git commands from data", () => {
      const item = mockItem({ 
        category: "tool",
        events: [mockEvent({ 
          type: "tool.started", 
          data: { command: "git status" } 
        })] 
      })
      const result = mapActivityItem(item)
      expect(result.titleZh).toBe("正在处理版本控制…")
    })
    
    it("detects search commands from data", () => {
      const item = mockItem({ 
        category: "tool",
        events: [mockEvent({ 
          type: "tool.started", 
          data: { command: "rg 'pattern'" } 
        })] 
      })
      const result = mapActivityItem(item)
      expect(result.titleZh).toBe("正在搜索代码…")
    })
  })

  describe("routing narrative", () => {
    it("maps routing started", () => {
      const item = mockItem({ 
        category: "routing", 
        status: "running" 
      })
      const result = mapActivityItem(item)
      expect(result.titleZh).toBe("正在规划下一步…")
    })

    it("maps routing done", () => {
      const item = mockItem({ 
        category: "routing", 
        status: "done" 
      })
      const result = mapActivityItem(item)
      expect(result.titleZh).toBe("已完成规划")
    })

    it("maps routing timeout", () => {
      const item = mockItem({
        category: "routing",
        events: [mockEvent({ type: "routing.timeout" })],
      })
      const result = mapActivityItem(item)
      expect(result.titleZh).toBe("规划超时，已降级")
      expect(result.severity).toBe("warning")
    })

    it("maps routing cancelled by user", () => {
      const item = mockItem({
        category: "routing",
        events: [mockEvent({ type: "routing.cancelled", data: { reason: "user_abort" } })],
      })
      const result = mapActivityItem(item)
      expect(result.titleZh).toContain("用户终止")
    })

    it("maps routing superseded", () => {
      const item = mockItem({
        category: "routing",
        events: [mockEvent({ type: "routing.cancelled", data: { reason: "superseded" } })],
      })
      const result = mapActivityItem(item)
      expect(result.titleZh).toContain("新任务接管")
    })
  })

  describe("worker lifecycle narrative", () => {
    it("maps lifecycle phase + worker role to user semantics", () => {
      const cases = [
        { workerID: "unknown_worker", phase: "running", text: "分析中" },
        { workerID: "retrieval_planner", phase: "running", text: "检索中" },
        { workerID: "patch_planner", phase: "running", text: "规划中" },
        { workerID: "evidence_critic", phase: "running", text: "验证中" },
        { workerID: "evidence_critic", phase: "degraded", text: "已降级" },
      ] as const

      for (const c of cases) {
        const item = mockItem({
          category: "other",
          status: "done",
          events: [
            mockEvent({
              type: "orchestrator.worker.lifecycle",
              summary: "worker lifecycle",
              data: { workerID: c.workerID, phase: c.phase, reason: "worker_degraded" },
            }),
          ],
        })

        const result = mapActivityItem(item)
        expect(result.titleZh).toContain(c.text)
      }
    })

    it("keeps summary + reason code only, hides stack/reasoning raw text", () => {
      const item = mockItem({
        category: "other",
        status: "done",
        summary: "worker lifecycle",
        events: [
          mockEvent({
            type: "orchestrator.worker.lifecycle",
            summary: "worker lifecycle",
            data: {
              workerID: "retrieval_planner",
              phase: "degraded",
              reason: "worker_degraded",
              stack: "Error: boom\\n at worker.ts:10:2",
              reasoning: "hidden chain of thought text",
            },
          }),
        ],
      })

      const result = mapActivityItem(item)
      expect(result.subtitleZh).toContain("worker lifecycle")
      expect(result.subtitleZh).toContain("worker_degraded")
      expect(result.subtitleZh).not.toContain("Error: boom")
      expect(result.subtitleZh).not.toContain("hidden chain of thought")
    })
  })
  
  describe("context narrative", () => {
    it("maps context.pack_built", () => {
      const item = mockItem({ 
        category: "other",
        events: [mockEvent({ type: "context.pack_built" })]
      })
      const result = mapActivityItem(item)
      expect(result.titleZh).toBe("上下文包已就绪")
      expect(result.subtitleZh).toBe("已生成 context-pack.json")
      expect(result.isMilestone).toBe(true)
    })
  })
  
  describe("workbench narrative", () => {
      it("maps doc processing", () => {
           const item = mockItem({ 
               category: "workbench", 
               events: [mockEvent({ type: "doc.parsed" })]
           })
           const result = mapActivityItem(item)
           expect(result.titleZh).toBe("正在解析文档…")
      })
  })
  
  describe("cache narrative", () => {
      it("maps cache hit", () => {
           const item = mockItem({ 
               category: "cache", 
               status: "done",
               events: [mockEvent({ type: "cache.hit" })]
           })
           const result = mapActivityItem(item)
           expect(result.titleZh).toBe("命中缓存")
      })
  })

  describe("compaction narrative", () => {
      it("maps compaction completed", () => {
           const item = mockItem({ 
               category: "other", 
               status: "done",
               events: [mockEvent({ type: "compaction.completed" })]
           })
           const result = mapActivityItem(item)
           expect(result.titleZh).toBe("上下文压缩完成")
           expect(result.severity).toBe("success")
      })
  })

  describe("handoff narrative", () => {
    it("maps handoff generated", () => {
      const item = mockItem({
        category: "other",
        status: "done",
        events: [
          mockEvent({
            type: "handoff.generated",
            data: { childSessionId: "sess-123", appliedFiles: ["a.ts", "b.ts"] }
          })
        ]
      })
      const result = mapActivityItem(item)
      expect(result.titleZh).toBe("已生成交接摘要")
      expect(result.subtitleZh).toContain("sess-123")
      expect(result.subtitleZh).toContain("2 个文件")
      expect(result.severity).toBe("success")
    })
  })

  describe("capsule assisted narrative", () => {
    it("maps capsule.assisted.completed", () => {
      const item = mockItem({
        category: "other",
        status: "done",
        events: [
          mockEvent({
            type: "capsule.assisted.completed",
            data: {
              capsule: {
                status: "success",
                items: [
                  { type: "decision", status: "known", text: "D1", evidenceIndices: [0] },
                  { type: "question", status: "known", text: "Q1", evidenceIndices: [0] },
                ],
                anchors: [{ path: ".opencode/artifacts/sid/compaction/C0/capsule.assisted.json", sha256: "0".repeat(64), kind: "file" }],
              },
            },
          }),
        ],
      })
      const result = mapActivityItem(item)
      expect(result.titleZh).toBe("AI 建议要点（可核验）")
      expect(result.subtitleZh).toContain("1 条决策")
      expect(result.subtitleZh).toContain("1 个待定项")
      expect(result.severity).toBe("success")
    })

    it("maps capsule.assisted.degraded with reason", () => {
      const item = mockItem({
        category: "other",
        status: "done",
        events: [
          mockEvent({
            type: "capsule.assisted.degraded",
            data: {
              capsule: {
                status: "degraded",
                degradedReasonZh: "部分引用无法溯源",
                items: [{ type: "decision", status: "unknown", text: "D1", unknownReasonZh: "缺少证据", evidenceIndices: [] }],
                anchors: [],
              },
            },
          }),
        ],
      })
      const result = mapActivityItem(item)
      expect(result.titleZh).toBe("AI 建议（已降级）")
      expect(result.subtitleZh).toContain("部分引用无法溯源")
      expect(result.severity).toBe("warning")
    })

    it("marks capsule.assisted.requested as noise", () => {
      const item = mockItem({
        category: "other",
        status: "done",
        events: [mockEvent({ type: "capsule.assisted.requested", data: {} })],
      })
      const result = mapActivityItem(item)
      expect(result.titleZh).toBe("正在生成 AI 建议…")
      expect(result.isNoise).toBe(true)
    })
  })

  describe("verification narrative", () => {
      it("maps verification degraded", () => {
           const item = mockItem({ 
               category: "other", 
               status: "done",
               events: [mockEvent({ type: "verification.degraded" })]
           })
           const result = mapActivityItem(item)
           expect(result.titleZh).toContain("验证已降级")
           expect(result.severity).toBe("warning")
      })
  })

  describe("secure output narrative", () => {
      it("maps protocol violation", () => {
           const item = mockItem({ 
               category: "other", 
               status: "failed",
               events: [mockEvent({ type: "protocol.violation" })]
           })
           const result = mapActivityItem(item)
           expect(result.titleZh).toBe("安全协议违规")
           expect(result.severity).toBe("error")
      })
  })

  describe("usage narrative", () => {
      it("maps usage normalized", () => {
           const item = mockItem({ 
               category: "other", 
               status: "done",
               events: [mockEvent({ type: "usage.normalized" })]
           })
           const result = mapActivityItem(item)
           expect(result.titleZh).toBe("用量已归一化")
           expect(result.isNoise).toBe(true)
      })
  })

	  describe("pointers", () => {
	    it("extracts whitelisted pointers from event data", () => {
	      const events = [
	        mockEvent({
	          data: { manifestPath: "/tmp/.opencode/evidence/sid/events.jsonl" },
	        }),
	      ]
	      const pointers = extractPointers(events)
	      expect(pointers).toEqual([{ key: "manifestPath", value: "/tmp/.opencode/evidence/sid/events.jsonl" }])
	    })
	
	    it("extracts sha-like values from event data", () => {
	      const events = [
	        mockEvent({
	          data: { sha256: "deadbeef" },
	        }),
	      ]
	      const pointers = extractPointers(events)
	      expect(pointers.some((p) => p.value === "deadbeef")).toBe(true)
	    })
	  })
	
	  describe("failure suggestions", () => {
	    it("returns GUI-friendly suggestions (no CLI flags or English hints)", () => {
	      const item = mockItem({
	        status: "failed",
	        events: [
	          mockEvent({ type: "cache.hit" }),
          mockEvent({ type: "compaction.degraded" }),
          mockEvent({ type: "verification.timeout" }),
        ],
      })
      const suggestions = getFailureSuggestions(item)
      expect(suggestions).toContain("尝试禁用缓存重试")
      expect(suggestions).toContain("尝试强制重建上下文")
      expect(suggestions).toContain("尝试切换至严格模式")
      expect(suggestions.some(s => s.includes("--"))).toBe(false)
      expect(suggestions.some(s => s.includes("("))).toBe(false)
    })

    it("suggests checking policy settings when secure output fails", () => {
      const item = mockItem({
        status: "failed",
        events: [mockEvent({ type: "protocol.violation" })],
      })
      const suggestions = getFailureSuggestions(item)
      expect(suggestions).toContain("检查敏感信息策略设置")
    })

    it("falls back to log suggestion when no known events exist", () => {
      const item = mockItem({
        status: "failed",
        events: [mockEvent({ type: "other.unknown_failure" })],
      })
	      expect(getFailureSuggestions(item)).toEqual(["查看详细日志以排查问题"])
	    })
	  })
})
