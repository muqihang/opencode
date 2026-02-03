import { CapsuleSession as Session } from "./capsule-protocol"
import type { CapsuleSession, CapsuleValue, Pointer } from "./capsule-protocol"

const MAX_BYTES = 16_000
const MAX_POINTERS = 200
const MAX_TOP = 20

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const sort = (pointers: Pointer[]) =>
  pointers
    .slice()
    .sort((a, b) => cmp(a.path, b.path) || cmp(a.kind, b.kind) || cmp(a.anchor ?? "", b.anchor ?? "") || cmp(a.sha256, b.sha256))

const size = (text: string) => Buffer.byteLength(text, "utf-8")

const line = (v: CapsuleValue) => {
  const val = v.value === undefined ? "" : `: ${String(v.value)}`
  return `- ${v.status}${val}`
}

const list = (vals: CapsuleValue[]) => (vals.length ? vals.map(line) : ["- (none)"])

const ptr = (p: Pointer) => {
  const ref = p.anchor ? `${p.path}#${p.anchor}` : p.path
  return `- ${p.kind}: ${ref} (sha256: ${p.sha256})`
}

const renderFull = (input: { session: CapsuleSession; pointers: Pointer[]; more: number }) => {
  const pointers = input.pointers.map(ptr)
  const tail = input.more > 0 ? [`- (+${input.more} more)`] : []
  return [
    "# Capsule",
    "",
    `- specVersion: ${input.session.specVersion}`,
    `- sessionId: ${input.session.sessionId}`,
    `- generatedAtUtc: ${input.session.generatedAtUtc}`,
    "",
    "## Goal",
    line(input.session.goal),
    "",
    "## Decisions",
    ...list(input.session.decisions),
    "",
    "## Open Questions",
    ...list(input.session.openQuestions),
    "",
    "## Working Set",
    ...(pointers.length ? pointers : ["- (none)"]),
    ...tail,
    "",
    "## Notes",
    ...list(input.session.notes),
    "",
  ].join("\n")
}

const renderBudget = (input: { session: CapsuleSession; pointers: Pointer[]; total: number }) => {
  const shown = input.pointers.slice(0, MAX_TOP).map(ptr)
  const more = input.total - shown.length
  const tail = more > 0 ? ` (+${more} more)` : ""
  return [
    "# Capsule",
    "",
    `- specVersion: ${input.session.specVersion}`,
    `- sessionId: ${input.session.sessionId}`,
    `- generatedAtUtc: ${input.session.generatedAtUtc}`,
    `- budget: ${MAX_BYTES} bytes`,
    "",
    "## Goal",
    line(input.session.goal),
    "",
    "## Counts",
    `- decisions: ${input.session.decisions.length}`,
    `- openQuestions: ${input.session.openQuestions.length}`,
    `- notes: ${input.session.notes.length}`,
    `- pointers: ${input.total}${tail}`,
    "",
    "## Working Set (top)",
    ...(shown.length ? shown : ["- (none)"]),
    "",
  ].join("\n")
}

export const Capsule = {
  MAX_BYTES,
  MAX_POINTERS,

  buildSession(input: {
    sessionId: string
    generatedAtUtc: string
    goal?: CapsuleValue
    decisions?: CapsuleValue[]
    openQuestions?: CapsuleValue[]
    pointers?: Pointer[]
    notes?: CapsuleValue[]
  }): CapsuleSession {
    return Session.parse({
      specVersion: "capsule-session/1.0",
      sessionId: input.sessionId,
      generatedAtUtc: input.generatedAtUtc,
      goal: input.goal ?? { status: "unknown" },
      decisions: input.decisions ?? [],
      openQuestions: input.openQuestions ?? [],
      workingSet: { pointers: sort(input.pointers ?? []) },
      notes: input.notes ?? [],
    })
  },

  render(session: CapsuleSession): string {
    const pointers = sort(session.workingSet.pointers)
    const limited = pointers.slice(0, MAX_POINTERS)
    const more = pointers.length - limited.length

    const full = renderFull({ session, pointers: limited, more })
    if (size(full) <= MAX_BYTES) return full
    return renderBudget({ session, pointers: limited, total: pointers.length })
  },
}
