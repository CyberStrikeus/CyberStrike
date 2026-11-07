import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Semaphore } from "@/util/semaphore"
import { SessionQueueStatus } from "./queue-status"

const log = Log.create({ service: "ingest-queue" })

const TASK_TIMEOUT_MS = 180_000

const DEFAULT_CONCURRENCY = 3

function getConcurrency(): number {
  const env = process.env.CYBERSTRIKE_INGEST_CONCURRENCY
  if (!env) return DEFAULT_CONCURRENCY
  const n = parseInt(env, 10)
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_CONCURRENCY
}

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
    sem: Semaphore
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
        sem: new Semaphore(getConcurrency()),
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

    // Each enqueue fires independently; the Semaphore gates concurrency (FIFO).
    // waitIfPaused runs BEFORE acquire so paused tasks don't hold semaphore slots.
    void (async () => {
      try {
        await waitIfPaused(sessionID)
        await s.sem.acquire()
        try {
          await runWithTimeout(sessionID, task, ms)
        } catch (err) {
          log.error("ingest prompt failed", { sessionID, error: err })
        } finally {
          s.sem.release()
        }
      } finally {
        const cur = state()[sessionID]
        if (cur) cur.pending = Math.max(0, cur.pending - 1)
        publish(sessionID)
        maybeCleanup(sessionID)
      }
    })()
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
