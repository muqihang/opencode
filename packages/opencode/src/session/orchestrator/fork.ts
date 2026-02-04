import { EvidenceWriter } from "@/evidence/writer"
import { TaskTool } from "@/tool/task"
import { Tool } from "@/tool/tool"
import { Session } from "@/session"
import { Identifier } from "@/id/id"
import { PermissionNext } from "@/permission/next"
import type { Agent } from "@/agent/agent"
import type { Provider } from "@/provider/provider"

type ForkTaskInput = {
  sessionId: string
  assistantMessageId: string
  agent: Agent.Info
  session: Session.Info
  model: {
    providerID: string
    id: string
    api: { npm: string; id: string }
  }
  abort: AbortSignal
  task: {
    description: string
    subagentType: string
    prompt: string
  }
}

type ForkTaskResult = {
  status: "ok" | "degraded"
  notice?: string
  callId: string
  partId: string
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const sanitizePrompt = (value: string) => {
  const compact = value.replace(/\s+/g, " ").trim()
  const max = 200
  return compact.length > max ? `${compact.slice(0, max)}...` : compact
}

const renderNotice = (input: { description: string; subagentType: string; prompt: string }) => {
  return [
    "【派工提示】本轮计划包含写入/执行意图，需要 fork 到子会话。",
    "系统将自动派工到 tool:task（需要你的权限确认）。",
    "若你拒绝或派工失败，请复制以下参数：",
    `description: ${input.description}`,
    `subagent_type: ${input.subagentType}`,
    `prompt: ${input.prompt}`,
  ].join("\n")
}

const writeDegraded = async (input: { sessionId: string; messageId: string; reason: string }) => {
  const writer = await EvidenceWriter.open({ sessionId: input.sessionId }).catch(() => undefined)
  if (!writer) return
  await writer
    .event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: input.sessionId,
      severity: "warn",
      actor: "orchestrator:fork",
      type: "orchestrator.degraded",
      summary: "orchestrator degraded",
      data: {
        messageId: input.messageId,
        stage: "fork_task",
        reason: input.reason,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
    .catch(() => {})
}

export const runForkTask = async (input: ForkTaskInput): Promise<ForkTaskResult> => {
  const taskArgs = {
    description: input.task.description,
    subagent_type: input.task.subagentType,
    prompt: input.task.prompt,
  }
  const callId = Identifier.ascending("tool")
  const partId = Identifier.ascending("part")
  const start = Date.now()
  const notice = renderNotice({
    description: input.task.description,
    subagentType: input.task.subagentType,
    prompt: sanitizePrompt(input.task.prompt),
  })

  const run = async (): Promise<ForkTaskResult> => {
    const created = await Session.updatePart({
      id: partId,
      messageID: input.assistantMessageId,
      sessionID: input.sessionId,
      type: "tool",
      tool: "task",
      callID: callId,
      state: {
        status: "running",
        input: taskArgs,
        time: { start },
      },
    })
      .then(() => true)
      .catch(async (error) => {
        await writeDegraded({
          sessionId: input.sessionId,
          messageId: input.assistantMessageId,
          reason: errorText(error),
        })
        return false
      })

    if (!created) return { status: "degraded", notice, callId, partId }

    const taskTool = await TaskTool.init({ agent: input.agent })
    const ctx: Tool.Context = {
      sessionID: input.sessionId,
      messageID: input.assistantMessageId,
      agent: input.agent.name,
      abort: input.abort,
      callID: callId,
      metadata: async (val) => {
        await Session.updatePart({
          id: partId,
          messageID: input.assistantMessageId,
          sessionID: input.sessionId,
          type: "tool",
          tool: "task",
          callID: callId,
          state: {
            status: "running",
            input: taskArgs,
            title: val.title,
            metadata: val.metadata,
            time: { start },
          },
        })
      },
      ask: async (req) => {
        await PermissionNext.ask({
          ...req,
          sessionID: input.sessionId,
          tool: { messageID: input.assistantMessageId, callID: callId },
          ruleset: PermissionNext.merge(input.agent.permission, input.session.permission ?? []),
        })
      },
    }

    const result = await taskTool
      .execute(taskArgs, ctx)
      .then(async (output) => {
        await Session.updatePart({
          id: partId,
          messageID: input.assistantMessageId,
          sessionID: input.sessionId,
          type: "tool",
          tool: "task",
          callID: callId,
          state: {
            status: "completed",
            input: taskArgs,
            output: output.output,
            title: output.title ?? "",
            metadata: output.metadata ?? {},
            time: { start, end: Date.now() },
            attachments: output.attachments,
          },
        })
        return { ok: true as const }
      })
      .catch(async (error) => {
        await Session.updatePart({
          id: partId,
          messageID: input.assistantMessageId,
          sessionID: input.sessionId,
          type: "tool",
          tool: "task",
          callID: callId,
          state: {
            status: "error",
            input: taskArgs,
            error: errorText(error),
            time: { start, end: Date.now() },
          },
        }).catch(() => {})
        await writeDegraded({
          sessionId: input.sessionId,
          messageId: input.assistantMessageId,
          reason: errorText(error),
        })
        return { ok: false as const }
      })

    if (!result.ok) {
      return { status: "degraded", notice, callId, partId }
    }

    return { status: "ok", callId, partId }
  }

  return run().catch(async (error) => {
    await writeDegraded({
      sessionId: input.sessionId,
      messageId: input.assistantMessageId,
      reason: errorText(error),
    })
    return { status: "degraded", notice, callId, partId }
  })
}

export type { ForkTaskInput, ForkTaskResult }
