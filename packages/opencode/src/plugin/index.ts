import type { Hooks, PluginInput, Plugin as PluginInstance } from "@opencode-ai/plugin"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { Server } from "../server/server"
import { BunProc } from "../bun"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { CodexAuthPlugin } from "./codex"
import { Session } from "../session"
import { NamedError } from "@opencode-ai/util/error"
import { CopilotAuthPlugin } from "./copilot"
import { Installation } from "@/installation"
import { validatePluginContract } from "./contract"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  const BUILTIN = ["opencode-anthropic-auth@0.0.10", "@gitlab/opencode-gitlab-auth@1.3.2"]

  // Built-in plugins that are directly imported (not installed from npm)
  const INTERNAL_PLUGINS: PluginInstance[] = [CodexAuthPlugin, CopilotAuthPlugin]

  const normalizePolicy = <T extends Record<string, unknown>>(value?: T): T | undefined => {
    if (!value) return undefined
    if (Object.keys(value).length === 0) return undefined
    return value
  }

  const publishContractError = (input: {
    specifier: string
    resolved: string
    reason: string
    detail?: string
    conflicts: unknown
  }) => {
    log.warn("plugin disabled by contract", {
      plugin: input.specifier,
      resolved: input.resolved,
      reason: input.reason,
      detail: input.detail,
      conflicts: input.conflicts,
    })

    const detail = input.detail ? ` detail=${input.detail}` : ""
    const message = `Plugin ${input.specifier} disabled: ${input.reason}.${detail}`
    Bus.publish(Session.Event.Error, {
      error: new NamedError.Unknown({
        message,
      }).toObject(),
    })
  }

  const loadPlugin = async (input: { plugin: string; builtin: boolean }) => {
    if (input.plugin.startsWith("file://")) return input.plugin

    const lastAtIndex = input.plugin.lastIndexOf("@")
    const pkg = lastAtIndex > 0 ? input.plugin.substring(0, lastAtIndex) : input.plugin
    const version = lastAtIndex > 0 ? input.plugin.substring(lastAtIndex + 1) : "latest"

    return BunProc.install(pkg, version).catch((err) => {
      if (!input.builtin) throw err

      const message = err instanceof Error ? err.message : String(err)
      log.error("failed to install builtin plugin", {
        pkg,
        version,
        error: message,
      })
      Bus.publish(Session.Event.Error, {
        error: new NamedError.Unknown({
          message: `Failed to install built-in plugin ${pkg}@${version}: ${message}`,
        }).toObject(),
      })

      return ""
    })
  }

  const state = Instance.state(async () => {
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      // @ts-ignore - fetch type incompatibility
      fetch: async (...args) => Server.App().fetch(...args),
    })
    const config = await Config.get()
    const hooks: Hooks[] = []
    const input: PluginInput = {
      client,
      project: Instance.project,
      worktree: Instance.worktree,
      directory: Instance.directory,
      serverUrl: Server.url(),
      $: Bun.$,
    }

    for (const plugin of INTERNAL_PLUGINS) {
      log.info("loading internal plugin", { name: plugin.name })
      const init = await plugin(input)
      hooks.push(init)
    }

    const plugins = [...(config.plugin ?? [])]
    if (!Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS) {
      plugins.push(...BUILTIN)
    }

    const corePolicy = normalizePolicy({
      ...(config.pluginPolicy?.core ?? {}),
      ...(Flag.OPENCODE_PLUGIN_POLICY_CORE ?? {}),
    })
    const runtimeHint = normalizePolicy({
      ...(config.pluginPolicy?.runtimeHint ?? {}),
      ...(Flag.OPENCODE_PLUGIN_POLICY_RUNTIME_HINT ?? {}),
    })

    for (const specifier of plugins) {
      // Ignore legacy auth plugins (first-party now).
      if (
        !specifier.startsWith("file://") &&
        (specifier === "opencode-openai-codex-auth" ||
          specifier.startsWith("opencode-openai-codex-auth@") ||
          specifier === "opencode-copilot-auth" ||
          specifier.startsWith("opencode-copilot-auth@"))
      ) {
        continue
      }
      log.info("loading plugin", { path: specifier })

      const lastAtIndex = specifier.lastIndexOf("@")
      const pkg = lastAtIndex > 0 ? specifier.substring(0, lastAtIndex) : specifier
      const builtin = BUILTIN.some((x) => x.startsWith(pkg + "@"))
      const plugin = await loadPlugin({ plugin: specifier, builtin })
      if (!plugin) continue

      const mod = (await import(plugin)) as Record<string, unknown>
      const contract = validatePluginContract({
        specifier,
        module: mod,
        coreVersion: Flag.OPENCODE_PLUGIN_CORE_VERSION ?? Installation.VERSION,
        policy: {
          core: corePolicy,
          tenant: normalizePolicy(config.pluginPolicy?.tenant),
          runtimeHint,
        },
      })

      if (!contract.ok) {
        publishContractError({
          specifier,
          resolved: plugin,
          reason: contract.reason ?? "plugin_contract_error",
          detail: contract.detail,
          conflicts: contract.conflicts,
        })
        continue
      }

      // Prevent duplicate initialization when plugins export the same function
      // as both a named export and default export (e.g., `export const X` and `export default X`).
      // Object.entries(mod) would return both entries pointing to the same function reference.
      const seen = new Set<PluginInstance>()
      for (const value of Object.values(mod)) {
        if (typeof value !== "function") continue
        const fn = value as PluginInstance
        if (seen.has(fn)) continue
        seen.add(fn)
        const init = await fn(input)
        hooks.push(init)
      }
    }

    return {
      hooks,
      input,
    }
  })

  export async function trigger<
    Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(name: Name, input: Input, output: Output): Promise<Output> {
    if (!name) return output
    for (const hook of await state().then((x) => x.hooks)) {
      const fn = hook[name]
      if (!fn) continue
      // @ts-expect-error if you feel adventurous, please fix the typing, make sure to bump the try-counter if you
      // give up.
      // try-counter: 2
      await fn(input, output)
    }
    return output
  }

  export async function list() {
    return state().then((x) => x.hooks)
  }

  export async function init() {
    const hooks = await state().then((x) => x.hooks)
    const config = await Config.get()
    for (const hook of hooks) {
      // @ts-expect-error this is because we haven't moved plugin to sdk v2
      await hook.config?.(config)
    }
    Bus.subscribeAll(async (input) => {
      const hooks = await state().then((x) => x.hooks)
      for (const hook of hooks) {
        hook["event"]?.({
          event: input,
        })
      }
    })
  }
}
