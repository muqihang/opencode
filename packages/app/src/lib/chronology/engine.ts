import type { ActivityItem, EventV1 } from "./types"

function key(e: EventV1) {
  return `${e.ts}:${e.actor}:${e.type}:${e.summary}`
}

function openKey(e: EventV1) {
  return `${e.traceId ?? "no-trace"}:${e.actor}`
}

function toolTitle(start: EventV1, end?: EventV1) {
  const actor = start.actor
  const name = actor.includes(":") ? actor.split(":").slice(1).join(":") : actor
  const status = end ? "done" : "running"
  return `Tool: ${name} (${status})`
}

function messageId(e: EventV1): string | undefined {
  const data = e.data
  if (!data || typeof data !== "object") return undefined
  if (!("messageId" in data)) return undefined
  const value = (data as { messageId?: unknown }).messageId
  if (typeof value !== "string") return undefined
  return value
}

export function synthesize(events: EventV1[]): ActivityItem[] {
  const list = [...events].sort((a, b) => a.ts.localeCompare(b.ts))
  const open = new Map<string, EventV1[]>()
  const items: ActivityItem[] = []

  for (const e of list) {
    if (e.type === "tool.started") {
      const queue = open.get(openKey(e))
      if (queue) {
        queue.push(e)
        continue
      }
      open.set(openKey(e), [e])
      continue
    }

    if (e.type === "tool.completed") {
      const queue = open.get(openKey(e))
      if (!queue || queue.length === 0) {
        items.push({
          id: `tool:${key(e)}`,
          category: "tool",
          status: "done",
          title: toolTitle(e, e),
          summary: e.summary,
          tsStart: e.ts,
          tsEnd: e.ts,
          events: [e],
          traceId: e.traceId,
          messageId: messageId(e),
        })
        continue
      }

      const start = queue.shift()
      if (!start) continue
      if (queue.length === 0) open.delete(openKey(e))

      items.push({
        id: `tool:${key(start)}:${key(e)}`,
        category: "tool",
        status: "done",
        title: toolTitle(start, e),
        summary: e.summary,
        tsStart: start.ts,
        tsEnd: e.ts,
        events: [start, e],
        traceId: start.traceId ?? e.traceId,
        messageId: messageId(start) ?? messageId(e),
      })
      continue
    }

    if (e.type.startsWith("doc.")) {
      items.push({
        id: `workbench:${key(e)}`,
        category: "workbench",
        status: "done",
        title: "Workbench",
        summary: e.summary,
        tsStart: e.ts,
        tsEnd: e.ts,
        events: [e],
        traceId: e.traceId,
        messageId: messageId(e),
      })
      continue
    }

    if (e.type === "file.cache_hit") {
      items.push({
        id: `cache:${key(e)}`,
        category: "cache",
        status: "done",
        title: "Cache",
        summary: e.summary,
        tsStart: e.ts,
        tsEnd: e.ts,
        events: [e],
        traceId: e.traceId,
        messageId: messageId(e),
      })
      continue
    }

    items.push({
      id: `other:${key(e)}`,
      category: "other",
      status: e.severity === "error" ? "failed" : "done",
      title: e.type,
      summary: e.summary,
      tsStart: e.ts,
      tsEnd: e.ts,
      events: [e],
      traceId: e.traceId,
      messageId: messageId(e),
    })
  }

  for (const [actor, queue] of open) {
    for (const start of queue) {
      items.push({
        id: `tool:${key(start)}:running`,
        category: "tool",
        status: "running",
        title: toolTitle(start),
        summary: start.summary,
        tsStart: start.ts,
        events: [start],
        traceId: start.traceId,
        messageId: messageId(start),
      })
    }
    open.delete(actor)
  }

  return items.sort((a, b) => a.tsStart.localeCompare(b.tsStart))
}
