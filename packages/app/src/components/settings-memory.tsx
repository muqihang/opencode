import { Component, createSignal, For, type JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/switch"
import { Select } from "@opencode-ai/ui/select"

export const SettingsMemory: Component = () => {
    const [donationEnabled, setDonationEnabled] = createSignal(false)
    const [memoryAutoSave, setMemoryAutoSave] = createSignal(false)
    const [retentionDays, setRetentionDays] = createSignal(30)
    
    // Mock candidates
    const candidates = [
        { id: 1, type: "Preference", content: "用户偏好使用中文回答", confidence: "High" },
        { id: 2, type: "Environment", content: "项目使用 Bun 作为包管理器", confidence: "Medium" }
    ]

    const retentionOptions = [
        { value: 7, label: "7 天" },
        { value: 30, label: "30 天" },
        { value: 90, label: "90 天" },
        { value: 365, label: "1 年" },
    ]

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
                    <h2 class="text-16-medium text-text-strong">记忆与数据治理</h2>
                    <p class="text-14-regular text-text-weak">管理您的数据隐私、记忆偏好与捐赠设置</p>
                </div>
            </div>

             <div class="flex flex-col gap-8 w-full">
                {/* Donation Section */}
                <div class="flex flex-col gap-1">
                    <h3 class="text-14-medium text-text-strong pb-2">数据捐赠 (Donation)</h3>
                    <div class="bg-surface-raised-base px-4 rounded-lg">
                        <SettingsRow 
                            title="帮助改进模型" 
                            description="允许将脱敏后的非敏感数据用于模型训练与评测（默认关闭）"
                        >
                            <Switch checked={donationEnabled()} onChange={setDonationEnabled} />
                        </SettingsRow>
                    </div>
                </div>

                {/* Memory Section */}
                <div class="flex flex-col gap-1">
                    <h3 class="text-14-medium text-text-strong pb-2">长期记忆 (Memory)</h3>
                    <div class="bg-surface-raised-base px-4 rounded-lg">
                        <SettingsRow 
                            title="自动保存记忆" 
                            description="允许系统自动提取并保存偏好（建议保持关闭，仅使用候选模式）"
                        >
                            <Switch checked={memoryAutoSave()} onChange={setMemoryAutoSave} />
                        </SettingsRow>
                    </div>
                    
                    {/* Candidates Preview */}
                    <div class="mt-4 p-3 border border-border-weak-base rounded-lg bg-surface-raised-base">
                        <div class="flex justify-between items-center mb-2">
                            <span class="text-12-medium text-text-subtle">待确认记忆 ({candidates.length})</span>
                            <button type="button" class="text-12-regular text-text-interactive-base hover:underline">全部忽略</button>
                        </div>
                        <div class="flex flex-col gap-2">
                            <For each={candidates}>{ c => (
                                <div class="flex items-start justify-between p-2 bg-surface-base rounded border border-border-weak-base">
                                    <div>
                                        <div class="text-12-medium text-text-strong">{c.content}</div>
                                        <div class="text-11-regular text-text-weak mt-0.5">{c.type} • {c.confidence}</div>
                                    </div>
                                    <div class="flex gap-2">
                                        <button type="button" class="text-text-interactive-base hover:text-text-strong" aria-label="Confirm"><Icon name="check" size="small"/></button>
                                        <button type="button" class="text-text-weak hover:text-text-strong" aria-label="Ignore"><Icon name="close-small" size="small"/></button>
                                    </div>
                                </div>
                            )}</For>
                        </div>
                    </div>
                </div>
                
                {/* Retention Section */}
                <div class="flex flex-col gap-1">
                    <h3 class="text-14-medium text-text-strong pb-2">数据保留 (Retention)</h3>
                    <div class="bg-surface-raised-base px-4 rounded-lg">
                        <SettingsRow 
                            title="本地数据保留期" 
                            description="超过该期限的会话证据将被清理（Pinned 会话除外）"
                        >
                             <Select
                                options={retentionOptions}
                                current={retentionOptions.find((o) => o.value === retentionDays())}
                                value={(o) => String(o.value)}
                                label={(o) => o.label}
                                onSelect={(option) => option && setRetentionDays(option.value)}
                                variant="secondary"
                                size="small"
                                triggerVariant="settings"
                            />
                        </SettingsRow>
                         <div class="py-3 border-t border-border-weak-base">
                            <button type="button" class="px-3 py-1.5 text-12-medium text-text-on-critical-base bg-surface-critical-base rounded hover:bg-surface-critical-hover transition-colors">
                                立即清理过期数据 (预览)
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
