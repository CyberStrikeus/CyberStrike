// Bounded-concurrency batch runner (design §5/§16). Runs many sends at once —
// the concurrency the user asked for — but capped so it never overwhelms the
// target, the model, or CyberStrike. The cap can be a fixed number OR a live
// function (an AimdLimiter's value), so the pool grows and shrinks with the
// target's real capacity; an optional TokenBucket paces requests-per-second.
//
// Worker-agnostic and pure: the caller supplies an async `worker` (typically one
// governed send), so this layer is testable with mock workers and no network.

import { Governor } from "./governor"

export namespace Batch {
  export interface Options {
    /** Max in-flight workers: a fixed number, or a thunk read each scheduling
     * pass (pass `() => aimdLimiter.value` for adaptive concurrency). */
    concurrency: number | (() => number)
    /** Optional req/s pacing. A worker slot is taken only when a token is free. */
    bucket?: Governor.TokenBucket
    now?: () => number
    sleep?: (ms: number) => Promise<void>
    /** How long to wait when the rate bucket is dry before re-checking. */
    rateWaitMs?: number
    signal?: AbortSignal
  }

  const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  /**
   * Run `worker` over every item with bounded concurrency, returning results in
   * input order. A worker that throws yields `undefined` for that slot (one bad
   * item never fails the whole batch). Stops launching new work once the signal
   * aborts; already-running workers finish.
   */
  export async function run<T, R>(
    items: readonly T[],
    worker: (item: T, index: number) => Promise<R>,
    opts: Options,
  ): Promise<(R | undefined)[]> {
    const now = opts.now ?? (() => Date.now())
    const sleep = opts.sleep ?? realSleep
    const rateWaitMs = opts.rateWaitMs ?? 20
    const cap = typeof opts.concurrency === "function" ? opts.concurrency : () => opts.concurrency as number

    const results = new Array<R | undefined>(items.length).fill(undefined)
    const active = new Set<Promise<void>>()
    let next = 0

    const launch = (i: number): void => {
      const p = worker(items[i], i)
        .then((r) => {
          results[i] = r
        })
        .catch(() => {
          results[i] = undefined
        })
        .finally(() => {
          active.delete(p)
        })
      active.add(p)
    }

    while (next < items.length || active.size > 0) {
      if (opts.signal?.aborted) break

      // Fill free slots, subject to the (possibly dynamic) cap and rate bucket.
      while (next < items.length && active.size < Math.max(1, cap())) {
        if (opts.bucket && !opts.bucket.take(now())) break // no token right now
        launch(next++)
      }

      if (active.size > 0) {
        await Promise.race(active)
        continue
      }
      // Nothing in flight but items remain → only reason is the rate bucket; wait.
      if (next < items.length) await sleep(rateWaitMs)
      else break
    }

    return results
  }
}
