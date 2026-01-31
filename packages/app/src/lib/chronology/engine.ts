import type { ActivityItem, EventV1 } from "./types"

function key(e: EventV1) {
  return `${e.ts}:${e.actor}:${e.type}:${e.summary}`
}

function toolTitle(start: EventV1, end?: EventV1) {
  const actor = start.actor
  const name = actor.includes(":") ? actor.split(":").slice(1).join(":") : actor
  const status = end ? "done" : "running"
  return `Tool: ${name} (${status})`
}

export function synthesize(events: EventV1[]): ActivityItem[] {
  const list = [...events].sort((a, b) => a.ts.localeCompare(b.ts))
  const open = new Map<string, EventV1[]>()
  const items: ActivityItem[] = []

  for (const e of list) {
    if (e.type === "tool.started") {
      const queue = open.get(e.actor)
      if (queue) {
        queue.push(e)
        continue
      }
      open.set(e.actor, [e])
      continue
    }

    if (e.type === "tool.completed") {
      const queue = open.get(e.actor)
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
        })
        continue
      }

      const start = queue.shift()
      if (!start) continue
      if (queue.length === 0) open.delete(e.actor)

      items.push({
        id: `tool:${key(start)}:${key(e)}`,
        category: "tool",
        status: "done",
        title: toolTitle(start, e),
        summary: e.summary,
        tsStart: start.ts,
        tsEnd: e.ts,
        events: [start, e],
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
      })
    }
    open.delete(actor)
  }

  return items.sort((a, b) => a.tsStart.localeCompare(b.tsStart))
}

