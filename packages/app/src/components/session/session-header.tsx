import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { useNavigate, useParams } from "@solidjs/router"
import { useLayout } from "@/context/layout"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSync } from "@/context/sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { getFilename } from "@opencode-ai/util/path"
import { base64Decode } from "@opencode-ai/util/encode"

import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { Popover } from "@opencode-ai/ui/popover"
import { TextField } from "@opencode-ai/ui/text-field"
import { Keybind } from "@opencode-ai/ui/keybind"
import { StatusPopover } from "../status-popover"
import { childSessions, subtasksCount } from "./subtasks"

export function SessionHeader(props: { onActivity?: () => void; badge?: () => boolean }) {
  const globalSDK = useGlobalSDK()
  const layout = useLayout()
  const params = useParams()
  const navigate = useNavigate()
  const command = useCommand()
  const sync = useSync()
  const dialog = useDialog()
  const platform = usePlatform()
  const language = useLanguage()

  const projectDirectory = createMemo(() => base64Decode(params.dir ?? ""))
  const project = createMemo(() => {
    const directory = projectDirectory()
    if (!directory) return
    return layout.projects.list().find((p) => p.worktree === directory || p.sandboxes?.includes(directory))
  })
  const name = createMemo(() => {
    const current = project()
    if (current) return current.name || getFilename(current.worktree)
    return getFilename(projectDirectory())
  })
  const hotkey = createMemo(() => command.keybind("file.open"))

  const currentSession = createMemo(() => sync.data.session.find((s) => s.id === params.id))
  const shareEnabled = createMemo(() => sync.data.config.share !== "disabled")
  const showShare = createMemo(() => shareEnabled() && !!currentSession())
  const showReview = createMemo(() => !!currentSession())
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const view = createMemo(() => layout.view(sessionKey))

  const children = createMemo(() => {
    const id = params.id
    if (!id) return []
    return childSessions(sync.data.session, id)
  })

  const subtasks = createMemo(() => subtasksCount(children(), sync.data.session_status))

  const parent = createMemo(() => {
    const current = currentSession()
    if (!current?.parentID) return
    return sync.data.session.find((s) => s.id === current.parentID)
  })

  const statusLabel = (id: string) => {
    const type = sync.data.session_status[id]?.type ?? "idle"
    if (type === "busy") return "运行中"
    if (type === "idle") return "空闲"
    return type
  }

  const go = (id: string) => navigate(`/${params.dir}/session/${id}`)

  const openSubtasks = () => {
    if (!params.id) return
    if (subtasks().total === 0) return

    dialog.show(() => (
      <Dialog title="子任务" size="large">
        <div class="flex flex-col gap-1 p-2">
          <For each={children()}>
            {(s) => (
              <Button
                variant="ghost"
                class="justify-between"
                onClick={() => {
                  dialog.close()
                  go(s.id)
                }}
              >
                <div class="flex flex-col items-start min-w-0">
                  <span class="text-13-medium truncate w-full">{s.title ?? s.id}</span>
                  <span class="text-12-regular text-text-weak">{statusLabel(s.id)}</span>
                </div>
                <span class="text-12-regular text-text-weak shrink-0">打开</span>
              </Button>
            )}
          </For>
        </div>
      </Dialog>
    ))
  }

  const [state, setState] = createStore({
    share: false,
    unshare: false,
    copied: false,
    timer: undefined as number | undefined,
  })
  const shareUrl = createMemo(() => currentSession()?.share?.url)

  createEffect(() => {
    const url = shareUrl()
    if (url) return
    if (state.timer) window.clearTimeout(state.timer)
    setState({ copied: false, timer: undefined })
  })

  onCleanup(() => {
    if (state.timer) window.clearTimeout(state.timer)
  })

  function shareSession() {
    const session = currentSession()
    if (!session || state.share) return
    setState("share", true)
    globalSDK.client.session
      .share({ sessionID: session.id, directory: projectDirectory() })
      .catch((error) => {
        console.error("Failed to share session", error)
      })
      .finally(() => {
        setState("share", false)
      })
  }

  function unshareSession() {
    const session = currentSession()
    if (!session || state.unshare) return
    setState("unshare", true)
    globalSDK.client.session
      .unshare({ sessionID: session.id, directory: projectDirectory() })
      .catch((error) => {
        console.error("Failed to unshare session", error)
      })
      .finally(() => {
        setState("unshare", false)
      })
  }

  function copyLink() {
    const url = shareUrl()
    if (!url) return
    navigator.clipboard
      .writeText(url)
      .then(() => {
        if (state.timer) window.clearTimeout(state.timer)
        setState("copied", true)
        const timer = window.setTimeout(() => {
          setState("copied", false)
          setState("timer", undefined)
        }, 3000)
        setState("timer", timer)
      })
      .catch((error) => {
        console.error("Failed to copy share link", error)
      })
  }

  function viewShare() {
    const url = shareUrl()
    if (!url) return
    platform.openLink(url)
  }

  const centerMount = createMemo(() => document.getElementById("opencode-titlebar-center"))
  const rightMount = createMemo(() => document.getElementById("opencode-titlebar-right"))

  return (
    <>
      <Show when={centerMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <button
              type="button"
              class="hidden md:flex w-[320px] p-1 pl-1.5 items-center gap-2 justify-between rounded-md border border-border-weak-base bg-surface-raised-base transition-colors cursor-default hover:bg-surface-raised-base-hover focus:bg-surface-raised-base-hover active:bg-surface-raised-base-active"
              onClick={() => command.trigger("file.open")}
              aria-label={language.t("session.header.searchFiles")}
            >
              <div class="flex min-w-0 flex-1 items-center gap-2 overflow-visible">
                <Icon name="magnifying-glass" size="normal" class="icon-base shrink-0" />
                <span class="flex-1 min-w-0 text-14-regular text-text-weak truncate h-4.5 flex items-center">
                  {language.t("session.header.search.placeholder", { project: name() })}
                </span>
              </div>

              <Show when={hotkey()}>{(keybind) => <Keybind class="shrink-0">{keybind()}</Keybind>}</Show>
            </button>
          </Portal>
        )}
      </Show>
      <Show when={rightMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <div class="flex items-center gap-3">
              <StatusPopover />
              <Show when={showShare()}>
                <div class="flex items-center">
                  <Popover
                    title={language.t("session.share.popover.title")}
                    description={
                      shareUrl()
                        ? language.t("session.share.popover.description.shared")
                        : language.t("session.share.popover.description.unshared")
                    }
                    gutter={6}
                    placement="bottom-end"
                    shift={-64}
                    class="rounded-xl [&_[data-slot=popover-close-button]]:hidden"
                    triggerAs={Button}
                    triggerProps={{
                      variant: "secondary",
                      class: "rounded-sm w-[60px] h-[24px]",
                      classList: { "rounded-r-none": shareUrl() !== undefined },
                      style: { scale: 1 },
                    }}
                    trigger={language.t("session.share.action.share")}
                  >
                    <div class="flex flex-col gap-2">
                      <Show
                        when={shareUrl()}
                        fallback={
                          <div class="flex">
                            <Button
                              size="large"
                              variant="primary"
                              class="w-1/2"
                              onClick={shareSession}
                              disabled={state.share}
                            >
                              {state.share
                                ? language.t("session.share.action.publishing")
                                : language.t("session.share.action.publish")}
                            </Button>
                          </div>
                        }
                      >
                        <div class="flex flex-col gap-2">
                          <TextField value={shareUrl() ?? ""} readOnly copyable tabIndex={-1} class="w-full" />
                          <div class="grid grid-cols-2 gap-2">
                            <Button
                              size="large"
                              variant="secondary"
                              class="w-full shadow-none border border-border-weak-base"
                              onClick={unshareSession}
                              disabled={state.unshare}
                            >
                              {state.unshare
                                ? language.t("session.share.action.unpublishing")
                                : language.t("session.share.action.unpublish")}
                            </Button>
                            <Button
                              size="large"
                              variant="primary"
                              class="w-full"
                              onClick={viewShare}
                              disabled={state.unshare}
                            >
                              {language.t("session.share.action.view")}
                            </Button>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Popover>
                  <Show when={shareUrl()} fallback={<div aria-hidden="true" />}>
                    <Tooltip
                      value={
                        state.copied
                          ? language.t("session.share.copy.copied")
                          : language.t("session.share.copy.copyLink")
                      }
                      placement="top"
                      gutter={8}
                    >
                      <IconButton
                        icon={state.copied ? "check" : "link"}
                        variant="secondary"
                        class="rounded-l-none"
                        onClick={copyLink}
                        disabled={state.unshare}
                        aria-label={
                          state.copied
                            ? language.t("session.share.copy.copied")
                            : language.t("session.share.copy.copyLink")
                        }
                      />
                    </Tooltip>
                  </Show>
                </div>
              </Show>
              <div class="hidden md:flex items-center gap-3 ml-2 shrink-0">
                <TooltipKeybind
                  title={language.t("command.terminal.toggle")}
                  keybind={command.keybind("terminal.toggle")}
                >
                  <Button
                    variant="ghost"
                    class="group/terminal-toggle size-6 p-0"
                    onClick={() => view().terminal.toggle()}
                    aria-label={language.t("command.terminal.toggle")}
                    aria-expanded={view().terminal.opened()}
                    aria-controls="terminal-panel"
                  >
                    <div class="relative flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                      <Icon
                        size="small"
                        name={view().terminal.opened() ? "layout-bottom-full" : "layout-bottom"}
                        class="group-hover/terminal-toggle:hidden"
                      />
                      <Icon
                        size="small"
                        name="layout-bottom-partial"
                        class="hidden group-hover/terminal-toggle:inline-block"
                      />
                      <Icon
                        size="small"
                        name={view().terminal.opened() ? "layout-bottom" : "layout-bottom-full"}
                        class="hidden group-active/terminal-toggle:inline-block"
                      />
                    </div>
                  </Button>
                </TooltipKeybind>
              </div>
              <div class="hidden md:block shrink-0">
                <Show when={parent()}>
                  {(p) => (
                    <Tooltip value="返回父会话" placement="top" gutter={8}>
                      <Button
                        variant="ghost"
                        class="group/parent-toggle size-6 p-0"
                        onClick={() => go(p().id)}
                        aria-label="返回父会话"
                        tabIndex={params.id ? 0 : -1}
                      >
                        <Icon name="chevron-right" size="small" class="rotate-180" />
                      </Button>
                    </Tooltip>
                  )}
                </Show>
              </div>
              <div class="hidden md:block shrink-0">
                <Show when={subtasks().total > 0}>
                  <Tooltip value="子任务" placement="top" gutter={8}>
                    <Button
                      variant="ghost"
                      class="group/subtasks-toggle size-6 p-0 relative"
                      onClick={openSubtasks}
                      aria-label="子任务"
                      tabIndex={params.id ? 0 : -1}
                    >
                      <Icon size="small" name="branch" />
                      <div class="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-surface-raised-base border border-border-weak-base flex items-center justify-center">
                        <span class="text-[10px] leading-none text-text-strong">
                          {subtasks().running}/{subtasks().total}
                        </span>
                      </div>
                    </Button>
                  </Tooltip>
                </Show>
              </div>
              <div class="hidden md:block shrink-0">
                <Tooltip value="Activity" placement="top" gutter={8}>
                  <Button
                    variant="ghost"
                    class="group/activity-toggle size-6 p-0 relative"
                    onClick={() => props.onActivity?.()}
                    aria-label="Activity"
                    tabIndex={params.id ? 0 : -1}
                  >
                    <Icon size="small" name="bullet-list" />
                    <Show when={props.badge?.()}>
                      <div class="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-surface-warning-strong border border-border-weak-base" />
                    </Show>
                  </Button>
                </Tooltip>
              </div>
              <div class="hidden md:block shrink-0">
                <TooltipKeybind title={language.t("command.review.toggle")} keybind={command.keybind("review.toggle")}>
                  <Button
                    variant="ghost"
                    class="group/review-toggle size-6 p-0"
                    onClick={() => view().reviewPanel.toggle()}
                    aria-label={language.t("command.review.toggle")}
                    aria-expanded={view().reviewPanel.opened()}
                    aria-controls="review-panel"
                    tabIndex={showReview() ? 0 : -1}
                  >
                    <div class="relative flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                      <Icon
                        size="small"
                        name={view().reviewPanel.opened() ? "layout-right-full" : "layout-right"}
                        class="group-hover/review-toggle:hidden"
                      />
                      <Icon
                        size="small"
                        name="layout-right-partial"
                        class="hidden group-hover/review-toggle:inline-block"
                      />
                      <Icon
                        size="small"
                        name={view().reviewPanel.opened() ? "layout-right" : "layout-right-full"}
                        class="hidden group-active/review-toggle:inline-block"
                      />
                    </div>
                  </Button>
                </TooltipKeybind>
              </div>
            </div>
          </Portal>
        )}
      </Show>
    </>
  )
}
