const hash = (value: string) => {
  const h = new Bun.CryptoHasher("sha256")
  h.update(value)
  return h.digest("hex")
}

export const resolveProbeCorrelationID = (input: {
  sessionID: string
  messageID: string
}) => {
  const scope = input.sessionID.trim() || input.messageID.trim()
  const seed = `${scope}::probe-correlation/v1`
  return `pc_${hash(seed).slice(0, 24)}`
}
