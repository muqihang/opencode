import { Component, createSignal, For, type JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/switch"
import { Select } from "@opencode-ai/ui/select"
import { useLanguage } from "@/context/language"

export const SettingsMemory: Component = () => {
  const language = useLanguage()
  const [donationEnabled, setDonationEnabled] = createSignal(false)
  const [memoryAutoSave, setMemoryAutoSave] = createSignal(false)
  const [retentionDays, setRetentionDays] = createSignal(30)

  const candidates = [
    { id: 1, type: "Preference", content: "用户偏好使用中文回答", confidence: "High" },
    { id: 2, type: "Environment", content: "项目使用 Bun 作为包管理器", confidence: "Medium" },
  ] as const

  const retentionOptions = [
    { value: 7, label: "settings.memory.retention.option.7days" },
    { value: 30, label: "settings.memory.retention.option.30days" },
    { value: 90, label: "settings.memory.retention.option.90days" },
    { value: 365, label: "settings.memory.retention.option.1year" },
  ] as const

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
          <h2 class="text-16-medium text-text-strong">{language.t("settings.memory.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("settings.memory.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.memory.section.donation")}</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <SettingsRow
              title={language.t("settings.memory.donation.title")}
              description={language.t("settings.memory.donation.description")}
            >
              <Switch checked={donationEnabled()} onChange={setDonationEnabled} />
            </SettingsRow>
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.memory.section.memory")}</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <SettingsRow
              title={language.t("settings.memory.autoSave.title")}
              description={language.t("settings.memory.autoSave.description")}
            >
              <Switch checked={memoryAutoSave()} onChange={setMemoryAutoSave} />
            </SettingsRow>
          </div>

          <div class="mt-4 p-3 border border-border-weak-base rounded-lg bg-surface-raised-base">
            <div class="flex justify-between items-center mb-2">
              <span class="text-12-medium text-text-subtle">
                {language.t("settings.memory.candidates.title", { count: candidates.length })}
              </span>
              <button type="button" class="text-12-regular text-text-interactive-base hover:underline">
                {language.t("settings.memory.candidates.ignoreAll")}
              </button>
            </div>
            <div class="flex flex-col gap-2">
              <For each={candidates}>
                {(c) => (
                  <div class="flex items-start justify-between p-2 bg-surface-base rounded border border-border-weak-base">
                    <div>
                      <div class="text-12-medium text-text-strong">{c.content}</div>
                      <div class="text-11-regular text-text-weak mt-0.5">
                        {c.type} • {c.confidence}
                      </div>
                    </div>
                    <div class="flex gap-2">
                      <button
                        type="button"
                        class="text-text-interactive-base hover:text-text-strong"
                        aria-label="Confirm"
                      >
                        <Icon name="check" size="small" />
                      </button>
                      <button type="button" class="text-text-weak hover:text-text-strong" aria-label="Ignore">
                        <Icon name="close-small" size="small" />
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.memory.section.retention")}</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <SettingsRow
              title={language.t("settings.memory.retention.title")}
              description={language.t("settings.memory.retention.description")}
            >
              <Select
                options={[...retentionOptions]}
                current={retentionOptions.find((o) => o.value === retentionDays())}
                value={(o) => String(o.value)}
                label={(o) => language.t(o.label)}
                onSelect={(option) => option && setRetentionDays(option.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </SettingsRow>
            <div class="py-3 border-t border-border-weak-base">
              <button
                type="button"
                class="px-3 py-1.5 text-12-medium text-text-on-critical-base bg-surface-critical-base rounded hover:bg-surface-critical-hover transition-colors"
              >
                {language.t("settings.memory.retention.cleanup.button")}
              </button>
            </div>
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
      <div class="flex flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex-shrink-0">{props.children}</div>
    </div>
  )
}
