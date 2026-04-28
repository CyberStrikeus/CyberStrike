import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { SessionQueueStatus } from "./queue-status"

const log = Log.create({ service: "ingest-queue" })

export namespace IngestQueue {
  type State = {
    chain: Promise<void>
    paused: boolean
    pending: number
    resumeSignal: Promise<void> | null
    resumeResolve: (() => void) | null
  }

  const state = Instance.state(() => {
    const data: Record<string, State> = {}
    return data
  })

  function getOrInit(sessionID: string): State {
    let s = state()[sessionID]
    if (!s) {
      s = {
        chain: Promise.resolve(),
        paused: false,
        pending: 0,
        resumeSignal: null,
        resumeResolve: null,
      }
      state()[sessionID] = s
    }
    return s
  }

  function publish(sessionID: string) {
    const s = state()[sessionID]
    SessionQueueStatus.set(sessionID, {
      paused: s?.paused ?? false,
      pending: s?.pending ?? 0,
    })
  }

  function maybeCleanup(sessionID: string) {
    const s = state()[sessionID]
    if (!s) return
    if (s.pending === 0 && !s.paused) {
      delete state()[sessionID]
    }
  }

  function waitIfPaused(sessionID: string): Promise<void> {
    const s = state()[sessionID]
    if (!s || !s.paused) return Promise.resolve()
    if (!s.resumeSignal) {
      s.resumeSignal = new Promise<void>((resolve) => {
        s.resumeResolve = resolve
      })
    }
    return s.resumeSignal
  }

  export function enqueue(sessionID: string, task: () => Promise<unknown>) {
    const s = getOrInit(sessionID)
    s.pending++
    publish(sessionID)

    const next = s.chain
      .then(() => waitIfPaused(sessionID))
      .then(task)
      .then(
        () => {},
        (err) => log.error("ingest prompt failed", { sessionID, error: err }),
      )
      .then(() => {
        const cur = state()[sessionID]
        if (cur) cur.pending = Math.max(0, cur.pending - 1)
        publish(sessionID)
        maybeCleanup(sessionID)
      })

    s.chain = next
  }

  export function pause(sessionID: string) {
    const s = getOrInit(sessionID)
    if (s.paused) return
    s.paused = true
    publish(sessionID)
  }

  export function resume(sessionID: string) {
    const s = state()[sessionID]
    if (!s || !s.paused) return
    s.paused = false
    const resolve = s.resumeResolve
    s.resumeResolve = null
    s.resumeSignal = null
    if (resolve) resolve()
    publish(sessionID)
    maybeCleanup(sessionID)
  }

  export function pendingCount(sessionID: string): number {
    return state()[sessionID]?.pending ?? 0
  }

  export function isPaused(sessionID: string): boolean {
    return state()[sessionID]?.paused ?? false
  }
}
