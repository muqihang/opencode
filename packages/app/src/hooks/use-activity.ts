import { useSDK } from "@/context/sdk"
import { synthesize } from "@/lib/chronology/engine"
import { groupActivitiesByMessageId, summarizeTurn } from "@/lib/chronology/selectors"
import type { EventV1 } from "@/lib/chronology/types"
import { groupWorkerLifecycleByMessage, lifecycleEventV1, readWorkerLifecycle } from "@/lib/chronology/worker-lifecycle"
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
      .then((res) => {
        const batch = res.data
        if (!batch) return
        if (batch.nextCursor === state.cursor && batch.events.length === 0) return
        setState("cursor", batch.nextCursor)
        if (batch.events.length === 0) return
        setState("events", (prev) => {
          const merged = [...prev, ...batch.events]
          const seen = new Set<string>()
          const deduped: EventV1[] = []
          for (const item of merged) {
            const data = item.data ? JSON.stringify(item.data) : ""
            const key = `${item.ts}|${item.type}|${item.actor}|${data}`
            if (seen.has(key)) continue
            seen.add(key)
            deduped.push(item)
          }
          return deduped
        })
      })
      .catch(() => {})

  createEffect(() => {
    if (!sessionID()) return
    poll()
    const timer = setInterval(poll, 1000)
    const stop = sdk.event.listen((evt) => {
      const event = readWorkerLifecycle(evt.details)
      if (!event) return
      if (event.sessionID !== sessionID()) return
      setState("events", (prev) => {
        const synthetic = lifecycleEventV1(event, new Date().toISOString())
        const data = synthetic.data ? JSON.stringify(synthetic.data) : ""
        const key = `${synthetic.type}|${synthetic.actor}|${data}`
        const found = prev.some((item) => {
          const itemData = item.data ? JSON.stringify(item.data) : ""
          return `${item.type}|${item.actor}|${itemData}` === key
        })
        if (found) return prev
        return [...prev, synthetic]
      })
    })
    onCleanup(() => {
      clearInterval(timer)
      stop()
    })
  })

  const activities = createMemo(() => synthesize(state.events))
  const activitiesByMessageId = createMemo(() => groupActivitiesByMessageId(activities()))
  const workerLifecycleByMessageId = createMemo(() => groupWorkerLifecycleByMessage(state.events))
  const turnSummary = (messageId: string) => summarizeTurn(activitiesByMessageId().get(messageId) ?? [])

  return {
    events: createMemo(() => state.events),
    activities,
    activitiesByMessageId,
    workerLifecycleByMessageId,
    turnSummary,
  }
}
