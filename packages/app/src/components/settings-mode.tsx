import { Select } from "@opencode-ai/ui/select"
import { showToast } from "@opencode-ai/ui/toast"
import { Component, createMemo, type JSX } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { MODE_OPTIONS, type ProductMode } from "@/utils/product-mode"
import { getFilename } from "@opencode-ai/util/path"

type ProductConfig = {
  product?: {
    mode?: ProductMode
  }
}

type ModeOption = {
  value: ProductMode
  label: string
  description: string
}

export const SettingsMode: Component<{ directory?: string }> = (props) => {
  const globalSync = useGlobalSync()
  const language = useLanguage()

  const directory = createMemo(() => props.directory?.replace(/[\\/]+$/, ""))

  const child = createMemo(() => {
    const dir = directory()
    if (!dir) return
    return globalSync.child(dir)
  })

  const store = createMemo(() => child()?.[0])
  const setStore = createMemo(() => child()?.[1])

  const currentMode = createMemo<ProductMode | undefined>(() => {
    const config = store()?.config as ProductConfig | undefined
    return config?.product?.mode
  })

  const options = createMemo<ModeOption[]>(() =>
    MODE_OPTIONS.map((option) => ({
      value: option.value,
      // `language.t()` is strongly typed to known keys; keep MODE_OPTIONS data-driven but cast for TS.
      label: language.t(option.labelKey as any),
      description: language.t(option.descriptionKey as any),
    })),
  )

  const current = createMemo(() => options().find((o) => o.value === currentMode()))

  const placeholder = createMemo(() => {
    if (!directory()) return language.t("settings.mode.placeholder.noWorkspace")
    return language.t("settings.mode.placeholder.unset")
  })

  const workspaceLabel = createMemo(() => {
    const dir = directory()
    if (!dir) return ""
    return getFilename(dir)
  })

  const setMode = (next: ProductMode) => {
    const dir = directory()
    const setter = setStore()
    const state = store()
    if (!dir || !setter || !state) return

    const before = state.config
    setter("config", (prev) => ({
      ...(prev as any),
      product: { ...((prev as any)?.product ?? {}), mode: next },
    }))

    globalSync.updateInstanceConfig(dir, { product: { mode: next } } as any).catch((err: unknown) => {
      setter("config", before)
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("settings.mode.toast.updateFailed.title"), description: message })
    })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar" style={{ padding: "0 40px 40px 40px" }}>
      <div
        class="sticky top-0 z-10"
        style={{
          background:
            "linear-gradient(to bottom, var(--surface-raised-stronger-non-alpha) calc(100% - 24px), transparent)",
        }}
      >
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.mode.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("settings.mode.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.mode.section.workspace")}</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <SettingsRow
              title={language.t("settings.mode.row.workspace.title")}
              description={
                directory()
                  ? language.t("settings.mode.row.workspace.description", { workspace: workspaceLabel() })
                  : language.t("settings.mode.row.workspace.description.none")
              }
            >
              <div class="text-12-regular text-text-weak truncate max-w-[220px]">{directory() ?? ""}</div>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.mode.row.mode.title")}
              description={language.t("settings.mode.row.mode.description")}
            >
              <Select
                options={options()}
                current={current()}
                placeholder={placeholder()}
                value={(o) => o.value}
                label={(o) => o.label}
                onSelect={(option) => option && setMode(option.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                disabled={!directory()}
              />
            </SettingsRow>
          </div>
        </div>
      </div>
    </div>
  )
}

interface SettingsRowProps {
  title: string
  description: string | JSX.Element
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
      <div class="flex flex-col gap-0.5 min-w-0">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex-shrink-0">{props.children}</div>
    </div>
  )
}
