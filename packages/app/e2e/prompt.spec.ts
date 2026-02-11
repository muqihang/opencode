import { test, expect } from "./fixtures"
import { promptSelector } from "./utils"

function sessionIDFromUrl(url: string) {
  const match = /\/session\/([^/?#]+)/.exec(url)
  return match?.[1]
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

  const rows = page.locator('[data-slot="session-turn-summary-section"]')
  const base = await rows.count()

  try {
    await expect
      .poll(
        async () => {
          const messages = await sdk.session.messages({ sessionID, limit: 50 }).then((r) => r.data ?? [])
          const user = messages.find((m) => {
            if (m.info.role !== "user") return false
            return m.parts
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("\n")
              .includes(token)
          })

          if (!user) return "pending:user"

          const reply = messages.find((m) => m.info.role === "assistant" && m.info.parentID === user.info.id)
          if (!reply) return "pending:assistant"

          const done = Boolean(reply.info.time.completed || reply.info.finish || reply.info.error)
          const count = await rows.count()
          if (count <= base) return done ? "pending:visible" : "pending:assistant-running"

          const visible = await rows.nth(count - 1).isVisible()
          if (!visible) return done ? "pending:visible" : "pending:assistant-running"

          const text = reply.parts
            .filter((p) => p.type === "text")
            .map((p) => p.text.trim())
            .join("\n")
            .trim()
          if (!done && text.length === 0) return "pending:assistant-running"

          if (reply.info.error) return `error:${reply.info.error.name}`
          return "ready"
        },
        { timeout: 90_000 },
      )

      .toBe("ready")

    await expect(rows.last()).toBeVisible({ timeout: 90_000 })
  } finally {
    page.off("pageerror", onPageError)
    await Promise.resolve(sdk.session.abort?.({ sessionID })).catch(() => undefined)
    await sdk.session.delete({ sessionID }).catch(() => undefined)
  }

  if (pageErrors.length > 0) {
    throw new Error(`Page error(s):\n${pageErrors.join("\n")}`)
  }
})

test.describe.configure({ mode: "serial" })
