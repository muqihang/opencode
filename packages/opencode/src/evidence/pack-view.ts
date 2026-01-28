type EvidencePackPointer = {
  kind: string
  path: string
  sha256: string
}

type EvidencePackViewInput = {
  sessionId: string
  packId: string
  backend: "soft" | "hard"
  enforcement: "soft" | "hard"
  pointers: EvidencePackPointer[]
  generatedAtUtc?: string
}

export const renderEvidencePackViewMarkdown = (input: EvidencePackViewInput): string => {
  const generatedAtUtc = input.generatedAtUtc ?? new Date().toISOString()
  const lines = [
    "# Evidence Pack",
    "",
    `- sessionId: ${input.sessionId}`,
    `- packId: ${input.packId}`,
    `- generatedAtUtc: ${generatedAtUtc}`,
    `- backend: ${input.backend}`,
    `- enforcement: ${input.enforcement}`,
    "",
    "## Pointers",
  ]
  for (const pointer of input.pointers) {
    lines.push(`- ${pointer.kind}: ${pointer.path} (${pointer.sha256})`)
  }
  return lines.join("\n")
}
