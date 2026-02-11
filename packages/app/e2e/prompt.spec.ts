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

          const text = reply.parts
            .filter((p) => p.type === "text")
            .map((p) => p.text.trim())
            .join("\n")
            .trim()

          if (text.length > 0) return "ready"
          if (reply.info.error) return `error:${reply.info.error.name}`
          return "pending:text"
        },
        { timeout: 90_000 },
      )

      .toBe("ready")

    await expect
      .poll(async () => rows.count(), { timeout: 90_000 })
      .toBeGreaterThan(base)
    await expect(rows.last()).toBeVisible({ timeout: 90_000 })
  } finally {
    page.off("pageerror", onPageError)
    await sdk.session.delete({ sessionID }).catch(() => undefined)
  }

  if (pageErrors.length > 0) {
    throw new Error(`Page error(s):\n${pageErrors.join("\n")}`)
  }
})
