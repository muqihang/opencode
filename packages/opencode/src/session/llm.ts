import os from "os"
import path from "path"
import { Installation } from "@/installation"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import { EvidenceWriter } from "@/evidence/writer"
import { stableJson } from "@/util/stable-json"
import { sha256Text } from "@/routing/cache"
import { CachePolicy } from "@/cache/policy"
import {
  streamText,
  wrapLanguageModel,
  type ModelMessage,
  type StreamTextResult,
  type Tool,
  type ToolSet,
  extractReasoningMiddleware,
  tool,
  jsonSchema,
} from "ai"
import { clone, mergeDeep, pipe } from "remeda"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { iife } from "@/util/iife"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Flag } from "@/flag/flag"
import { PermissionNext } from "@/permission/next"
import { Auth } from "@/auth"
import { ContextBlocksCache } from "./context-blocks-cache"
import { ContextPackCache } from "./context-pack-cache"
import { DecisionBoundary } from "./decision-boundary"
import { SecureOutputContract } from "./secure-output-contract"
import { runRetrieval } from "@/retrieval/runner"
import { ulid } from "ulid"
import { ContextLedger } from "./context-ledger"
import { GeminiCachedContent } from "@/provider/gemini-cached-content"
import { packPromptSections } from "@/session/orchestrator/prepare"

export namespace LLM {
  const log = Log.create({ service: "llm" })

  export type PromptSection = {
    id: string
    stability: "stable" | "dynamic"
    text: string
  }

  export const OUTPUT_TOKEN_MAX = Flag.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX || 32_000

  export type StreamInput = {
    user: MessageV2.User
    sessionID: string
    model: Provider.Model
    agent: Agent.Info
    system: string[]
    abort: AbortSignal
    messages: ModelMessage[]
    small?: boolean
    tools: Record<string, Tool>
    retries?: number
    permission?: PermissionNext.Ruleset
    historySummary?: string
  }

  export type StreamOutput = StreamTextResult<ToolSet, unknown>

  export function buildSystemSections(input: {
    providerPrompt: string
    permissionText: string
    environmentText: string
    capsuleText: string
    userText: string
    secureOutputContract?: string
  }): PromptSection[] {
    const contract = input.secureOutputContract ?? SecureOutputContract.text
    return [
      { id: "stable:provider", stability: "stable", text: input.providerPrompt },
      { id: "stable:permissions", stability: "stable", text: input.permissionText },
      { id: "stable:decision", stability: "stable", text: DecisionBoundary.text },
      { id: "stable:secure_output_contract", stability: "stable", text: contract },
      { id: "dynamic:environment", stability: "dynamic", text: input.environmentText },
      { id: "dynamic:capsule", stability: "dynamic", text: input.capsuleText },
      { id: "dynamic:user", stability: "dynamic", text: input.userText },
    ]
  }

  export function buildGatewayHeaders(input: {
    sessionID: string
    model: Pick<Provider.Model, "api">
    providerOptions?: Record<string, unknown>
  }): Record<string, string> {
    const wireApi = input.providerOptions?.["wireApi"] ?? input.providerOptions?.["wire_api"]
    const isOpenAI = input.model.api.npm === "@ai-sdk/openai"
    const useResponses = wireApi === "responses" || input.providerOptions?.["setCacheKey"] === true
    const forceSticky = input.providerOptions?.["stickySessionHeaders"] === true

    if ((isOpenAI && useResponses) || forceSticky) {
      return {
        session_id: input.sessionID,
        conversation_id: input.sessionID,
      }
    }
    return {}
  }

  export async function stream(input: StreamInput) {
    const l = log
      .clone()
      .tag("providerID", input.model.providerID)
      .tag("modelID", input.model.id)
      .tag("sessionID", input.sessionID)
      .tag("small", (input.small ?? false).toString())
      .tag("agent", input.agent.name)
      .tag("mode", input.agent.mode)
    l.info("stream", {
      modelID: input.model.id,
      providerID: input.model.providerID,
    })
    const [language, cfg, provider, auth] = await Promise.all([
      Provider.getLanguage(input.model),
      Config.get(),
      Provider.getProvider(input.model.providerID),
      Auth.get(input.model.providerID),
    ])
    const isCodex = provider.id === "openai" && auth?.type === "oauth"

    const providerPrompt = input.agent.prompt
      ? input.agent.prompt
      : isCodex
        ? ""
        : SystemPrompt.provider(input.model).join("\n\n")
    const codexInstructions = isCodex ? SystemPrompt.instructions() : ""
    const developerText = [codexInstructions, providerPrompt, SecureOutputContract.text].filter((x) => x.trim().length > 0).join("\n\n")
    const permissionRules = (input.permission ?? input.agent.permission)
      .map((rule) => ({
        permission: rule.permission,
        pattern: rule.pattern,
        action: rule.action,
      }))
      .toSorted((a, b) => {
        const permission = a.permission.localeCompare(b.permission)
        if (permission !== 0) return permission
        const pattern = a.pattern.localeCompare(b.pattern)
        if (pattern !== 0) return pattern
        return a.action.localeCompare(b.action)
      })
    const permissionText = stableJson({
      specVersion: "permission-rules/1.0",
      rules: permissionRules,
    })
    const systemItems = input.system.map((item) => item.trim()).filter((item) => item.length > 0)
    const capsuleIndex = systemItems.findIndex(
      (item) => item.trimStart().startsWith("<routing>") && item.includes("</routing>"),
    )
    const capsuleText = capsuleIndex >= 0 ? systemItems[capsuleIndex] : ""
    const environmentText = (capsuleIndex >= 0
      ? systemItems.filter((_, index) => index !== capsuleIndex)
      : systemItems
    ).join("\n\n")
    const userText = input.user.system ?? ""
    const packedSystem = packPromptSections({
      sections: buildSystemSections({
        providerPrompt,
        permissionText,
        environmentText,
        capsuleText,
        userText,
      }),
    })
    const systemBase = [...packedSystem.packed]
    if (systemBase.length === 0) systemBase.push("")
    const system = [...systemBase]

    const header = system[0]
    const original = clone(system)
    await Plugin.trigger(
      "experimental.chat.system.transform",
      { sessionID: input.sessionID, model: input.model },
      { system },
    )
    if (system.length === 0) {
      system.push(...original)
    }
    const isGemini = input.model.api.npm === "@ai-sdk/google"
    // rejoin to maintain 2-part structure for caching if header unchanged
    // (Gemini cached content needs stable system segments, keep them split)
    if (!isGemini && system.length > 2 && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
    }

    const variant =
      !input.small && input.model.variants && input.user.variant ? input.model.variants[input.user.variant] : {}
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: provider.options,
        })
    const options: Record<string, any> = pipe(
      base,
      mergeDeep(input.model.options),
      mergeDeep(input.agent.options),
      mergeDeep(variant),
    )
    if (isCodex) {
      options.instructions = codexInstructions
    }

    const params = await Plugin.trigger(
      "chat.params",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        temperature: input.model.capabilities.temperature
          ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
          : undefined,
        topP: input.agent.topP ?? ProviderTransform.topP(input.model),
        topK: ProviderTransform.topK(input.model),
        options,
      },
    )

    const { headers } = await Plugin.trigger(
      "chat.headers",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        headers: {},
      },
    )

    const maxOutputTokens = isCodex
      ? undefined
      : ProviderTransform.maxOutputTokens(
          input.model.api.npm,
          params.options,
          input.model.limit.output,
          OUTPUT_TOKEN_MAX,
        )

    const tools = await resolveTools(input)

    // LiteLLM and some Anthropic proxies require the tools parameter to be present
    // when message history contains tool calls, even if no tools are being used.
    // Add a dummy tool that is never called to satisfy this validation.
    // This is enabled for:
    // 1. Providers with "litellm" in their ID or API ID (auto-detected)
    // 2. Providers with explicit "litellmProxy: true" option (opt-in for custom gateways)
    const isLiteLLMProxy =
      provider.options?.["litellmProxy"] === true ||
      input.model.providerID.toLowerCase().includes("litellm") ||
      input.model.api.id.toLowerCase().includes("litellm")

    if (isLiteLLMProxy && Object.keys(tools).length === 0 && hasToolCalls(input.messages)) {
      tools["_noop"] = tool({
        description:
          "Placeholder for LiteLLM/Anthropic proxy compatibility - required when message history contains tool calls but no active tools are needed",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => ({ output: "", title: "", metadata: {} }),
      })
    }

    const toolset = Object.entries(tools).map(([name, item]) => {
      const schema = (() => {
        if (item.inputSchema && typeof item.inputSchema === "object" && "jsonSchema" in item.inputSchema) {
          const parsed = item.inputSchema as { jsonSchema?: unknown }
          return parsed.jsonSchema ?? {}
        }
        return {}
      })()
      const description = typeof item.description === "string" ? item.description : ""
      return { name, description, schema }
    })
    const workspaceFingerprint = sha256Text(
      stableJson({
        specVersion: "workspace-fingerprint/1.0",
        projectId: Instance.project.id,
        worktree: Instance.worktree,
        directory: Instance.directory,
        vcs: Instance.project.vcs ?? "none",
      }),
    )
    const contextPackId = ulid()
    const createdAtUtc = new Date().toISOString()
    const artifactRoot = ["context", contextPackId, "blocks"].join("/")
    const blocksResult = await ContextBlocksCache.build({
      permissions: permissionText,
      developer: developerText,
      user: userText,
      toolset: {
        version: "v1",
        tools: toolset,
      },
      environment: environmentText,
      capsule: capsuleText,
      decisionBoundary: DecisionBoundary.text,
      historySummary: input.historySummary,
      workspaceFingerprint,
      artifactRoot,
      policy: CachePolicy.policy("context-blocks"),
    })
    const blocks = blocksResult.blocks
    const extractText = (message: ModelMessage) => {
      if (typeof message.content === "string") return message.content
      if (Array.isArray(message.content)) {
        const parts = message.content
          .map((part) => {
            if (typeof part === "string") return part
            if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
              return part.text
            }
            return JSON.stringify(part) ?? ""
          })
          .filter((value): value is string => typeof value === "string" && value.length > 0)
        return parts.join("\n")
      }
      return ""
    }

    const intentText = (() => {
      const reversed = [...input.messages].reverse()
      for (const msg of reversed) {
        if (msg.role !== "user") continue
        const text = extractText(msg).trim()
        if (text) return text
      }
      return ""
    })()

    const retrieval = intentText
      ? await runRetrieval({
          sessionId: input.sessionID,
          messageId: input.user.id,
          intentText,
          abort: input.abort,
        })
      : undefined
    const writer = await EvidenceWriter.open({ sessionId: input.sessionID })
    const ledger = await ContextLedger.read(input.sessionID)

    const cfgCache = CachePolicy.effective()
    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: input.sessionID,
      severity: "info",
      actor: "cache:policy",
      type: "cache.config_effective",
      summary: "cache config effective",
      data: {
        storeEnabled: cfgCache.storeEnabled,
        forceContextPack: cfgCache.forceContextPack,
        strict: cfgCache.strict,
        sources: cfgCache.sources,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })

    const isRoutingCapsule = (text: string) =>
      text.trimStart().startsWith("<routing>") && text.includes("</routing>")

    const geminiCached = await iife(async () => {
      if (input.model.api.npm !== "@ai-sdk/google") return null
      if (Flag.OPENCODE_DISABLE_GEMINI_CACHED_CONTENT) return null

      const cfg = provider.options?.["geminiCachedContent"]
      if (cfg && typeof cfg === "object") {
        const enabled = (cfg as Record<string, unknown>)["enabled"]
        if (enabled === false) return null
      }

      const ttlMs = iife(() => {
        if (!cfg || typeof cfg !== "object") return 60 * 60 * 1000
        const ttl = (cfg as Record<string, unknown>)["ttlMs"]
        if (typeof ttl === "number" && ttl > 0) return ttl
        return 60 * 60 * 1000
      })

      const timeoutMs = iife(() => {
        if (!cfg || typeof cfg !== "object") return 10_000
        const timeout = (cfg as Record<string, unknown>)["timeoutMs"]
        if (typeof timeout === "number" && timeout > 0) return timeout
        return 10_000
      })

      const baseURL = iife(() => {
        const configured = provider.options?.["baseURL"]
        if (typeof configured === "string" && configured.length > 0) return configured
        return input.model.api.url
      })

      const apiKey = iife(() => {
        const configured = provider.options?.["apiKey"]
        if (typeof configured === "string" && configured.length > 0) return configured
        if (typeof provider.key === "string" && provider.key.length > 0) return provider.key
        return undefined
      })

      const root = Instance.worktree === "/" ? Instance.directory : Instance.worktree
      const scope = { projectId: Instance.project.id, worktreeRoot: root }
      const systemInstruction = system.filter((item) => !isRoutingCapsule(item))

      const res = await GeminiCachedContent.resolve({
        sessionId: input.sessionID,
        messageId: input.user.id,
        model: {
          providerID: input.model.providerID,
          id: input.model.id,
          api: { npm: input.model.api.npm, id: input.model.api.id },
        },
        provider: { baseURL, apiKey },
        systemInstruction,
        scope,
        ttlMs,
        policy: { enabled: true },
        abort: input.abort,
        timeoutMs,
      })

      const artifact = await writer.artifact({
        kind: "gemini-cached-content",
        path: ["cache", "gemini", "cached-content", input.user.id, `${res.cachedContentKey}.json`].join("/"),
        data: stableJson({
          specVersion: "gemini-cached-content-summary/1.0",
          sessionId: input.sessionID,
          messageId: input.user.id,
          decision: res.decision,
          cachedContentKey: res.cachedContentKey,
          cachedContentId: res.cachedContentId,
          previousCachedContentId: res.previousCachedContentId ?? null,
          expiresAtUtc: res.expiresAtUtc,
          ttlMs: res.ttlMs,
          cache: res.cache,
          reason: res.reason ?? null,
          meta: res.meta,
        }),
      })

      const emit = async (type: string, summary: string, extra?: Record<string, unknown>) => {
        await writer.event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId: input.sessionID,
          severity: "info",
          actor: "provider:gemini",
          type,
          summary,
          data: {
            cachedContentKey: res.cachedContentKey,
            cachedContentId: res.cachedContentId,
            ttlMs: res.ttlMs,
            expiresAtUtc: res.expiresAtUtc,
            artifact,
            cache: res.cache,
            ...(extra ?? {}),
          },
          redaction: { applied: true, policyVersion: "v1" },
        })
      }

      if (res.decision === "created") {
        if (res.cache?.status === "expired") {
          await emit("gemini.cached_content.expired", "Gemini Cached Content 已过期")
        }
        await emit("gemini.cached_content.created", "Gemini Cached Content 已创建")
      }

      if (res.decision === "reused") {
        await emit("gemini.cached_content.reused", "Gemini Cached Content 已复用")
      }

      if (res.decision === "invalidated") {
        await emit("gemini.cached_content.invalidated", "Gemini Cached Content 已失效，已重建", {
          previousCachedContentId: res.previousCachedContentId ?? null,
        })
      }

      if (res.decision === "degraded") {
        await emit("gemini.cached_content.degraded", "Gemini Cached Content 已降级", {
          reason: res.reason ?? "未知原因",
        })
      }

      if (res.decision === "disabled") {
        return null
      }

      return res
    })

    const packResult = await ContextPackCache.build({
      sessionId: input.sessionID,
      messageId: input.user.id,
      model: input.model,
      blocks,
      maxOutputTokens,
      contextPackId,
      previousContextPackId: ledger.lastContextPackId,
      ledgerNotes: ledger.lastContextPackId ? "previousContextPackId recorded" : undefined,
      createdAtUtc,
      evidencePointers: retrieval?.evidencePointers,
      policy: CachePolicy.policy("context-pack"),
    })
    const pack = packResult.pack

    const root = Instance.worktree === "/" ? Instance.directory : Instance.worktree
    const cacheEntryPointer = async (namespace: string, key: string) => {
      const rel = [".opencode", "cache", "store", namespace, "entries", `${key}.json`].join("/")
      const file = path.join(root, ...rel.split("/"))
      const text = await Bun.file(file).text().catch(() => "")
      if (!text) return
      return { path: rel, sha256: sha256Text(text), kind: "cache-entry" }
    }

    const emitCacheEvents = async (input2: {
      namespace: string
      key: string
      scope: { projectId: string; worktreeRoot: string }
      status: string
      tier: string
    }) => {
      const artifact = await cacheEntryPointer(input2.namespace, input2.key)
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: input.sessionID,
        severity: "info",
        actor: "cache:store",
        type: "cache.read",
        summary: "cache read",
        data: {
          namespace: input2.namespace,
          key: input2.key,
          scope: input2.scope,
          decision: input2.status,
          tier: input2.tier,
          artifact,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })

      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: input.sessionID,
        severity: "info",
        actor: "cache:store",
        type: input2.status === "hit" ? "cache.hit" : "cache.miss",
        summary: input2.status === "hit" ? "cache hit" : "cache miss",
        data: {
          namespace: input2.namespace,
          key: input2.key,
          scope: input2.scope,
          decision: input2.status,
          tier: input2.tier,
          artifact,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })

      const wrote = input2.status === "miss" || input2.status === "expired" || input2.status === "forced_rebuild"
      if (!wrote) return

      const stored = await cacheEntryPointer(input2.namespace, input2.key)
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: input.sessionID,
        severity: "info",
        actor: "cache:store",
        type: "cache.write",
        summary: "cache write",
        data: {
          namespace: input2.namespace,
          key: input2.key,
          scope: input2.scope,
          decision: input2.status,
          tier: "disk",
          artifact: stored,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })
    }

    await emitCacheEvents({
      namespace: blocksResult.cache.namespace,
      key: blocksResult.cache.key,
      scope: blocksResult.cache.scope,
      status: blocksResult.cache.status,
      tier: blocksResult.cache.tier,
    })
    await emitCacheEvents({
      namespace: packResult.cache.namespace,
      key: packResult.cache.key,
      scope: packResult.cache.scope,
      status: packResult.cache.status,
      tier: packResult.cache.tier,
    })

    await Promise.all(
      blocks.blocks.map((block) =>
        writer.artifact({
          kind: "context-block",
          path: block.source.ref,
          data: block.artifact,
        }),
      ),
    )
    const entry = await writer.artifact({
      kind: "context-pack",
      path: ["context", pack.contextPackId, "context-pack.json"].join("/"),
      data: stableJson(pack),
    })
    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: input.sessionID,
      severity: "info",
      actor: "session:llm",
      type: "context.pack_built",
      summary: "context pack built",
      data: {
        contextPackId: pack.contextPackId,
        previousContextPackId: pack.ledger.previousContextPackId,
        messageId: input.user.id,
        artifact: entry.path,
        window: pack.window,
        totals: pack.totals,
        toolsetFingerprint: blocks.toolsetFingerprint,
        blockFingerprints: blocks.blockFingerprints,
        cacheKey: blocks.cacheKey,
        cache: {
          blocks: blocksResult.cache,
          pack: packResult.cache,
        },
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
    await ContextLedger.write({ sessionId: input.sessionID, lastContextPackId: pack.contextPackId })

    const paramsOptions = geminiCached?.cachedContentId ? { ...params.options, cachedContent: geminiCached.cachedContentId } : params.options
    const systemForModel = iife(() => {
      if (input.model.api.npm !== "@ai-sdk/google") return system
      if (!geminiCached?.cachedContentId) return system
      return system.filter((item) => isRoutingCapsule(item))
    })

    return streamText({
      onError(error) {
        l.error("stream error", {
          error,
        })
      },
      async experimental_repairToolCall(failed) {
        const lower = failed.toolCall.toolName.toLowerCase()
        if (lower !== failed.toolCall.toolName && tools[lower]) {
          l.info("repairing tool call", {
            tool: failed.toolCall.toolName,
            repaired: lower,
          })
          return {
            ...failed.toolCall,
            toolName: lower,
          }
        }
        return {
          ...failed.toolCall,
          input: JSON.stringify({
            tool: failed.toolCall.toolName,
            error: failed.error.message,
          }),
          toolName: "invalid",
        }
      },
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      providerOptions: ProviderTransform.providerOptions(input.model, paramsOptions),
      activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
      tools,
      maxOutputTokens,
      abortSignal: input.abort,
      headers: {
        ...(input.model.providerID.startsWith("opencode")
          ? {
              "x-opencode-project": Instance.project.id,
              "x-opencode-session": input.sessionID,
              "x-opencode-request": input.user.id,
              "x-opencode-client": Flag.OPENCODE_CLIENT,
            }
          : input.model.providerID !== "anthropic"
            ? {
                "User-Agent": `opencode/${Installation.VERSION}`,
              }
            : undefined),
        ...buildGatewayHeaders({
          sessionID: input.sessionID,
          model: input.model,
          providerOptions: provider.options,
        }),
        ...input.model.headers,
        ...headers,
      },
      maxRetries: input.retries ?? 0,
      messages: [
        ...(isCodex
          ? [
              {
                role: "user",
                content: systemForModel.join("\n\n"),
              } as ModelMessage,
            ]
          : systemForModel.map(
              (x): ModelMessage => ({
                role: "system",
                content: x,
              }),
            )),
        ...input.messages,
      ],
      model: wrapLanguageModel({
        model: language,
        middleware: [
          {
            async transformParams(args) {
              if (args.type === "stream") {
                // @ts-expect-error
                args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, options)
              }
              return args.params
            },
          },
          extractReasoningMiddleware({ tagName: "think", startWithReasoning: false }),
        ],
      }),
      experimental_telemetry: { isEnabled: cfg.experimental?.openTelemetry },
    })
  }

  async function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "user">) {
    const disabled = PermissionNext.disabled(Object.keys(input.tools), input.agent.permission)
    for (const tool of Object.keys(input.tools)) {
      if (input.user.tools?.[tool] === false || disabled.has(tool)) {
        delete input.tools[tool]
      }
    }
    return input.tools
  }

  // Check if messages contain any tool-call content
  // Used to determine if a dummy tool should be added for LiteLLM proxy compatibility
  export function hasToolCalls(messages: ModelMessage[]): boolean {
    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue
      for (const part of msg.content) {
        if (part.type === "tool-call" || part.type === "tool-result") return true
      }
    }
    return false
  }
}
