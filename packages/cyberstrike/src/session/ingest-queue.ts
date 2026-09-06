import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { SessionQueueStatus } from "./queue-status"

const log = Log.create({ service: "ingest-queue" })

// A single ingested request's sub-agent (hunt-tester / analyzer) shouldn't run longer than this;
// tasks are chained (sequential), so a HUNG one would stall EVERY later test on the session. On
// timeout we abandon it and let the queue advance. FLAG: this is a deadline watchdog on the queue
// slot — it does NOT hard-abort the underlying sub-agent (no AbortSignal is threaded into
// SessionPrompt yet), so the hung run keeps consuming in the background until it errors on its own.
const TASK_TIMEOUT_MS = 180_000

// Run a task with a deadline. Resolves/rejects with the task's outcome if it settles in time; on
// timeout rejects with "ingest-task-timeout" so the chain's error handler advances the queue. The
// timer is always cleared (no leak), and a double-settle can't happen.
function runWithTimeout(sessionID: string, task: () => Promise<unknown>, ms: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      log.warn("ingest task timed out — abandoning so the queue advances", { sessionID, timeoutMs: ms })
      reject(new Error("ingest-task-timeout"))
    }, ms)
    Promise.resolve()
      .then(task)
      .then(
        (v) => {
          if (done) return
          done = true
          clearTimeout(timer)
          resolve(v)
        },
        (e) => {
          if (done) return
          done = true
          clearTimeout(timer)
          reject(e)
        },
      )
  })
}

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

  export function enqueue(sessionID: string, task: () => Promise<unknown>, opts?: { timeoutMs?: number }) {
    const s = getOrInit(sessionID)
    s.pending++
    publish(sessionID)

    const ms = opts?.timeoutMs ?? TASK_TIMEOUT_MS
    const next = s.chain
      .then(() => waitIfPaused(sessionID)) // pause time is NOT counted against the task deadline
      .then(() => runWithTimeout(sessionID, task, ms))
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
