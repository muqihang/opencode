import { describe, expect, it } from "bun:test"
import { extractPointers, mapActivityItem } from "./activity-narrative"
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
               events: [mockEvent({ type: "file.cache_hit" })]
           })
           const result = mapActivityItem(item)
           expect(result.titleZh).toBe("命中缓存")
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
})
