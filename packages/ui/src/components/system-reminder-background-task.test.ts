import { describe, expect, test } from "bun:test"
import { parseBackgroundTaskReminder } from "./system-reminder-background-task"

describe("system-reminder-background-task", () => {
  test("parses completed reminder with background_output command", () => {
    const text = [
      "<system-reminder>",
      "[BACKGROUND TASK COMPLETED]",
      "Task id: task_123",
      "Description: Build SDK",
      "Duration: 12.3s",
      "Remaining tasks: 2",
      'background_output(task_id="task_123")',
      "</system-reminder>",
    ].join("\n")

    const parsed = parseBackgroundTaskReminder(text)
    expect(parsed?.kind).toBe("completed")
    expect(parsed?.id).toBe("task_123")
    expect(parsed?.description).toBe("Build SDK")
    expect(parsed?.duration).toBe("12.3s")
    expect(parsed?.remaining).toBe(2)
    expect(parsed?.command).toBe('background_output(task_id="task_123")')
  })

  test("parses all-complete reminder", () => {
    const text = "<system-reminder>[ALL BACKGROUND TASKS COMPLETE]</system-reminder>"
    const parsed = parseBackgroundTaskReminder(text)
    expect(parsed?.kind).toBe("all_complete")
  })
})

