import z from "zod"

export const TaskFrame = z
  .object({
    specVersion: z.literal("task-frame/1.0"),
    sessionId: z.string().min(1),
    contextPackId: z.string().min(1),
    task: z
      .object({
        title: z.string().min(1).optional(),
        intent: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export type TaskFrame = z.infer<typeof TaskFrame>
