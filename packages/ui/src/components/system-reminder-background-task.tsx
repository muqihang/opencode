export type BackgroundTaskReminder = {
  kind: "completed" | "cancelled" | "failed" | "all_complete"
  id?: string
  description?: string
  duration?: string
  remaining?: number
  command?: string
  raw: string
}

function lineMatch(text: string, re: RegExp) {
  return text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .map((x) => x.match(re))
    .find((m) => !!m)
}

function numberMatch(text: string, re: RegExp) {
  const m = lineMatch(text, re)
  if (!m) return
  const raw = m[1]
  if (!raw) return
  const n = Number(raw)
  if (!Number.isFinite(n)) return
  return n
}

function stringMatch(text: string, re: RegExp) {
  const m = lineMatch(text, re)
  if (!m) return
  const s = m[1]
  if (!s) return
  return s.trim()
}

function commandMatch(text: string) {
  const m = text.match(/background_output\(task_id="([^"]+)"\)/)
  if (!m) return
  return m[0]
}

function statusKind(text: string): BackgroundTaskReminder["kind"] | undefined {
  if (text.includes("[ALL BACKGROUND TASKS COMPLETE]")) return "all_complete"
  if (text.includes("[BACKGROUND TASK COMPLETED]")) return "completed"
  if (text.includes("[BACKGROUND TASK CANCELLED]")) return "cancelled"
  if (text.includes("[BACKGROUND TASK FAILED]")) return "failed"
  return
}

export function parseBackgroundTaskReminder(text: string): BackgroundTaskReminder | undefined {
  if (!text) return
  if (!text.includes("<system-reminder>")) return

  const kind = statusKind(text)
  if (!kind) return

  if (kind === "all_complete") return { kind, raw: text }

  const command = commandMatch(text)
  const id =
    (command ? command.match(/task_id="([^"]+)"/)?.[1] : undefined) ??
    stringMatch(text, /^\s*(?:Task\s*id|Task\s*ID)\s*:\s*(.+)\s*$/i)
  const description = stringMatch(text, /^\s*Description\s*:\s*(.+)\s*$/i)
  const duration = stringMatch(text, /^\s*Duration\s*:\s*(.+)\s*$/i)
  const remaining = numberMatch(text, /^\s*Remaining(?:\s*tasks)?\s*:\s*(\d+)\s*$/i)

  return { kind, id, description, duration, remaining, command, raw: text }
}
