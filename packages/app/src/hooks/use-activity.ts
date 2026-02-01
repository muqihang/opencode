import { useSDK } from "@/context/sdk"
import { synthesize } from "@/lib/chronology/engine"
import type { EventV1 } from "@/lib/chronology/types"
import { createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

export function useActivity(props: { sessionID: string }) {
  const sdk = useSDK()
  const sessionID = createMemo(() => props.sessionID)
  const [state, setState] = createStore({
    cursor: 0,
    events: [] as EventV1[],
  })

  const poll = () =>
    sdk.client.session
      .evidenceEvents({ sessionID: sessionID(), cursor: state.cursor })
      .then((batch) => {
        if (batch.nextCursor === state.cursor && batch.events.length === 0) return
        setState("cursor", batch.nextCursor)
        if (batch.events.length === 0) return
        setState("events", (prev) => [...prev, ...batch.events])
      })
      .catch(() => {})

  createEffect(() => {
    if (!sessionID()) return
    poll()
    const timer = setInterval(poll, 1000)
    onCleanup(() => clearInterval(timer))
  })

  const activities = createMemo(() => synthesize(state.events))

  return {
    events: createMemo(() => state.events),
    activities,
  }
}

