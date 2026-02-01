import type { SessionEvidenceEvents } from "@opencode-ai/sdk/v2"

export type EventV1 = SessionEvidenceEvents["events"][number]

export type ActivityCategory = "tool" | "workbench" | "routing" | "cache" | "other"
export type ActivityStatus = "running" | "done" | "failed" | "needs_attention"

export type ActivityItem = {
  id: string
  category: ActivityCategory
  status: ActivityStatus
  title: string
  summary: string
  tsStart: string
  tsEnd?: string
  events: EventV1[]
  traceId?: string
  messageId?: string
}
