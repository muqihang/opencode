import type { Config as SDKConfig } from "@opencode-ai/sdk/v2"
import { createMemo } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"

type Mode = "base" | "programming" | "legal" | "marxism"
type Product = {
  mode?: Mode
  forkStrategy?: "auto" | "suggest" | "off"
  plugins?: {
    common?: string[]
    base?: string[]
    programming?: string[]
    legal?: string[]
    marxism?: string[]
  }
}
type ModeConfig = SDKConfig & { product?: Product }

export function DialogMode() {
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()

  const current = createMemo<Mode>(() => {
    const config = sync.data.config as ModeConfig
    return config.product?.mode ?? "base"
  })

  const options = [
    {
      value: "base" as const,
      title: "基础模式",
      description: "不启用行业插件；由 OpenCode 基座负责对话与派工。",
    },
    {
      value: "programming" as const,
      title: "编程开发模式",
      description: "启用 oh-my-opencode；多会话派工由插件接管（基座默认只提示）。",
    },
    {
      value: "legal" as const,
      title: "律师助理模式",
      description: "启用律师插件（如 oh-my-legal）；多会话派工由插件接管（基座默认只提示）。",
    },
    {
      value: "marxism" as const,
      title: "马哲分析模式",
      description: "启用马哲分析插件（未来如 oh-my-marxism）；多会话派工由插件接管（基座默认只提示）。",
    },
  ]

  return (
    <DialogSelect
      title="Mode (模式)"
      current={current()}
      options={options}
      onSelect={(option) => {
        const config = sync.data.config as ModeConfig
        const product = config.product

        const next: ModeConfig = {
          product: {
            mode: option.value,
            forkStrategy: product?.forkStrategy,
            plugins: product?.plugins,
          },
        }

        sdk.client.config
          .update({ config: next }, { throwOnError: true })
          .then(() => dialog.clear())
          .catch(() => dialog.clear())
      }}
    />
  )
}
