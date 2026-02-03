import { CapsuleSession as Session } from "./capsule-protocol"
import type { CapsuleSession, CapsuleValue, Pointer } from "./capsule-protocol"

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const sort = (pointers: Pointer[]) =>
  pointers
    .slice()
    .sort((a, b) => cmp(a.path, b.path) || cmp(a.kind, b.kind) || cmp(a.anchor ?? "", b.anchor ?? "") || cmp(a.sha256, b.sha256))

const line = (v: CapsuleValue) => {
  const val = v.value === undefined ? "" : `: ${String(v.value)}`
  return `- ${v.status}${val}`
}

const list = (vals: CapsuleValue[]) => (vals.length ? vals.map(line) : ["- (none)"])

const ptr = (p: Pointer) => {
  const ref = p.anchor ? `${p.path}#${p.anchor}` : p.path
  return `- ${p.kind}: ${ref} (sha256: ${p.sha256})`
}

export const Capsule = {
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
    return [
      "# Capsule",
      "",
      `- specVersion: ${session.specVersion}`,
      `- sessionId: ${session.sessionId}`,
      `- generatedAtUtc: ${session.generatedAtUtc}`,
      "",
      "## Goal",
      line(session.goal),
      "",
      "## Decisions",
      ...list(session.decisions),
      "",
      "## Open Questions",
      ...list(session.openQuestions),
      "",
      "## Working Set",
      ...(pointers.length ? pointers.map(ptr) : ["- (none)"]),
      "",
      "## Notes",
      ...list(session.notes),
      "",
    ].join("\n")
  },
}

