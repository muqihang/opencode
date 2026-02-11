import { test, expect } from "./fixtures"
import { promptSelector } from "./utils"

test.describe.configure({ mode: "serial" })

function sessionIDFromUrl(url: string) {
  const match = /\/session\/([^/?#]+)/.exec(url)
  return match?.[1]
}

type Poll = {
  phase: string
  done: boolean
  status: string
  count: number
  userID?: string
  replyID?: string
  parentID?: string
  visible?: boolean
  text?: number
  finish?: string
  completed?: boolean
  error?: string
}

test("can send a prompt and receive a reply", async ({ page, sdk, gotoSession }) => {
  test.setTimeout(120_000)

  const pageErrors: string[] = []
  const onPageError = (err: Error) => {
    pageErrors.push(err.message)
  }
  page.on("pageerror", onPageError)

  await gotoSession()

  const token = `E2E_OK_${Date.now()}`

  const prompt = page.locator(promptSelector)
  await prompt.click()
  await page.keyboard.type(`Reply with exactly: ${token}`)
  await page.keyboard.press("Enter")

  await expect(page).toHaveURL(/\/session\/[^/?#]+/, { timeout: 30_000 })

  const sessionID = (() => {
    const id = sessionIDFromUrl(page.url())
    if (!id) throw new Error(`Failed to parse session id from url: ${page.url()}`)
    return id
  })()

  const seen: { state?: Poll } = {}

  const read = async () => {
    const messages = await sdk.session.messages({ sessionID, limit: 50 }).then((r) => r.data ?? [])
    const statusMap = await sdk.session.status().then((r) => r.data ?? {})
    const status = statusMap[sessionID]?.type ?? "idle"

    const user = messages.find((m) => {
      if (m.info.role !== "user") return false
      return m.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n")
        .includes(token)
    })

    if (!user) {
      const state = {
        phase: "pending:user",
        done: false,
        status,
        count: messages.length,
      }
      seen.state = state
      return state
    }

    const reply = messages.find((m) => m.info.role === "assistant" && m.info.parentID === user.info.id)
    if (!reply) {
      const state = {
        phase: "pending:assistant",
        done: false,
        status,
        count: messages.length,
        userID: user.info.id,
      }
      seen.state = state
      return state
    }

    const turn = page.locator(
      `[data-slot="session-turn-message-container"][data-message="${reply.info.id}"],` +
        `[data-slot="session-turn-message-container"][data-message="${user.info.id}"]`,
    )
    const visible = await turn.isVisible().catch(() => false)
    if (!visible) {
      const state = {
        phase: "pending:turn-hidden",
        done: false,
        status,
        count: messages.length,
        userID: user.info.id,
        replyID: reply.info.id,
        parentID: reply.info.parentID,
        visible,
      }
      seen.state = state
      return state
    }

    const text = reply.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text.trim())
      .join("\n")
      .trim()
    const busy = status === "busy" || status === "retry"
    const hasText = text.length > 0
    const error = reply.info.error?.name
    const done = hasText || Boolean(error) || !busy

    const phase = (() => {
      if (hasText) return "terminal:text"
      if (error) return `terminal:error:${error}`
      if (!busy) return `terminal:status:${status}`
      return "pending:assistant-running"
    })()

    const state = {
      phase,
      done,
      status,
      count: messages.length,
      userID: user.info.id,
      replyID: reply.info.id,
      parentID: reply.info.parentID,
      visible,
      text: text.length,
      finish: String(reply.info.finish ?? ""),
      completed: Boolean(reply.info.time.completed),
      error,
    }
    seen.state = state
    return state
  }

  try {
    await expect
      .poll(
        async () => {
          const state = await read()
          const ready =
            state.phase !== "pending:user" && state.phase !== "pending:assistant" && state.phase !== "pending:turn-hidden"
          return ready
        },
        { timeout: 90_000 },
      )
      .toBe(true)

    if (!seen.state?.done) {
      await Promise.resolve(sdk.session.abort?.({ sessionID })).catch(() => undefined)
      await expect
        .poll(
          async () => {
            const status = await sdk.session.status().then((r) => r.data ?? {})
            return status[sessionID]?.type ?? "idle"
          },
          { timeout: 20_000 },
        )
        .toBe("idle")
      await read()
    }

    await expect(page.locator('[data-slot="session-turn-message-container"]').last()).toBeVisible({ timeout: 90_000 })
  } finally {
    page.off("pageerror", onPageError)
    await page.goto("about:blank").catch(() => undefined)
    await Promise.resolve(sdk.session.abort?.({ sessionID })).catch(() => undefined)
    await expect
      .poll(
        async () => {
          const status = await sdk.session.status().then((r) => r.data ?? {})
          return status[sessionID]?.type ?? "idle"
        },
        { timeout: 5_000 },
      )
      .toBe("idle")
      .catch(() => undefined)
    await sdk.session.delete({ sessionID }).catch(() => undefined)
  }

  if (pageErrors.length > 0) {
    throw new Error(`Page error(s):\n${pageErrors.join("\n")}`)
  }

  if (!seen.state?.done) {
    throw new Error(`Prompt poll did not reach terminal state: ${JSON.stringify(seen.state ?? null)}`)
  }
})
