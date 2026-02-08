import { DualPassCritic, DualPassDraft, DualPassFinal, type DualPassFallback } from "@/protocol/dual-pass"

type RunDualPassInput = {
  draft: () => Promise<string>
  critic: (input: { draft: DualPassDraft }) => Promise<unknown>
  timeoutMs: number
  unknownFirst: string
}

const specVersion = "dual-pass/1.0"

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const normalize = (value: string) => value.trim()

const withTimeout = async <T>(input: { timeoutMs: number; task: Promise<T> }) => {
  const timeoutMs = Math.max(1, Math.floor(input.timeoutMs))
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`critic timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    input.task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

const toFinal = (text: string) =>
  DualPassFinal.parse({
    specVersion,
    stage: "final",
    text,
  })

const toDegrade = (input: { text: string; reason: string; fallback: DualPassFallback }) =>
  DualPassFinal.parse({
    specVersion,
    stage: "degrade",
    text: input.text,
    degrade: {
      from: "critic",
      reason: input.reason,
      fallback: input.fallback,
    },
  })

const resolveUnknownFirst = (value: string) => {
  const text = normalize(value)
  if (text) return text
  return "unknown-first"
}

export const runDualPass = async (input: RunDualPassInput) => {
  const unknownFirst = resolveUnknownFirst(input.unknownFirst)
  const draftText = await input.draft().then((value) => normalize(value))
  const hasDraft = draftText.length > 0
  const draft = DualPassDraft.parse({
    specVersion,
    stage: "draft",
    text: hasDraft ? draftText : unknownFirst,
  })

  const critic = await withTimeout({
    timeoutMs: input.timeoutMs,
    task: input.critic({ draft }),
  }).then(
    (value) => ({ ok: true as const, value: DualPassCritic.parse(value) }),
    (error) => ({ ok: false as const, error }),
  )

  if (!critic.ok) {
    const fallback: DualPassFallback = hasDraft ? "draft" : "unknown-first"
    const text = fallback === "draft" ? draft.text : unknownFirst
    return toDegrade({
      text,
      fallback,
      reason: errorText(critic.error),
    })
  }

  if (critic.value.verdict === "accept" || critic.value.verdict === "revise") {
    const text = normalize(critic.value.text ?? "") || draft.text
    return toFinal(text)
  }

  const fallback = critic.value.fallback === "draft" && !hasDraft ? "unknown-first" : critic.value.fallback
  const text = fallback === "draft" ? draft.text : unknownFirst
  return toDegrade({
    text,
    fallback,
    reason: critic.value.reason,
  })
}

export type { RunDualPassInput }
