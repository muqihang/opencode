export type SessionLike = {
  id: string
  parentID?: string
  title?: string
}

export type SessionStatusLike = {
  type: string
}

export function childSessions(sessions: readonly SessionLike[], parentID: string) {
  return sessions.filter((s) => s.parentID === parentID)
}

export function subtasksCount(
  children: readonly Pick<SessionLike, "id">[],
  status: Record<string, SessionStatusLike | undefined>,
) {
  const running = children.filter((s) => (status[s.id]?.type ?? "idle") !== "idle").length
  return { running, total: children.length }
}

