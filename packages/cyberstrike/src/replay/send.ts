// Governed send (design §3.11 + §5). Wraps a raw send thunk with the reliability
// policy: global budget, per-host circuit breaker, retry (transient + idempotent
// only), and AIMD feedback (throttle on 429/503/timeout, grow on success). Kept
// backend-agnostic — the caller supplies a thunk that performs one actual send
// via backend A or B — so this layer is pure orchestration and unit-testable
// with mock thunks, no network.

import { ReplayError } from "./errors"
import { ReplayResponse } from "./response"
import { Governor } from "./governor"

export namespace Send {
  export interface Governors {
    budget?: Governor.GlobalBudget
    breaker?: Governor.CircuitBreaker
    /** Optional AIMD limiter the caller uses to size concurrency; updated here on
     * success/throttle so the signal reflects real send outcomes. */
    limiter?: Governor.AimdLimiter
  }

  export interface Options {
    maxRetries?: number
    /** Allow retrying a non-idempotent method (caller asserts it's side-effect-free). */
    safeToRetry?: boolean
    /** Injectable clock (ms) for deterministic tests. Defaults to Date.now. */
    now?: () => number
    /** Injectable delay for retry backoff; defaults to real setTimeout. Tests
     * pass a no-op to stay fast and deterministic. */
    sleep?: (ms: number) => Promise<void>
  }

  export interface Result extends ReplayResponse.Result {
    /** Number of send attempts actually performed (0 if skipped). */
    attempts: number
    /** Set when no send happened: budget exhausted or circuit open. */
    skipped?: "budget" | "circuit"
  }

  const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  /** Was this send outcome a throttle signal (429, or 503 w/ Retry-After)? */
  function isThrottleResponse(res: ReplayResponse.Parsed): boolean {
    return ReplayError.isRateLimited(res.status, ReplayResponse.hasRetryAfter(res))
  }

  /**
   * Perform a governed send. `send` does exactly one real send and returns a
   * Result; `method` drives the idempotency guard. Never throws.
   *
   * Order per attempt: budget check → circuit check → send → feed governors →
   * decide retry. Budget is consumed PER attempt (a retry hits the server, so it
   * counts against the anti-DoS cap). A timeout is treated as a throttle for the
   * AIMD limiter but is NEVER retried (it may be time-based-injection evidence).
   */
  export async function governed(
    send: () => Promise<ReplayResponse.Result>,
    method: string,
    gov: Governors = {},
    opts: Options = {},
  ): Promise<Result> {
    const now = opts.now ?? (() => Date.now())
    const sleep = opts.sleep ?? realSleep
    const maxRetries = opts.maxRetries ?? Governor.DEFAULTS.maxRetries
    const backoff = Governor.DEFAULTS.retryBackoffMs

    let attempts = 0
    let last: ReplayResponse.Result | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (gov.budget && !gov.budget.tryConsume()) {
        return last ? { ...last, attempts } : { skipped: "budget", attempts, timing: { totalMs: 0 } }
      }
      if (gov.breaker && !gov.breaker.canRequest(now())) {
        return last ? { ...last, attempts } : { skipped: "circuit", attempts, timing: { totalMs: 0 } }
      }

      attempts++
      const r = await send()
      last = r

      if (r.response) {
        if (isThrottleResponse(r.response)) {
          gov.limiter?.onThrottle()
          gov.breaker?.onFailure(now())
          // A throttle is retryable regardless of method (no side effect occurred).
          if (attempt < maxRetries) {
            await sleep(backoff[Math.min(attempt, backoff.length - 1)])
            continue
          }
        } else {
          gov.limiter?.onSuccess()
          gov.breaker?.onSuccess()
        }
        return { ...r, attempts, retried: attempts > 1 }
      }

      // Transport-level failure.
      const kind = r.error!.kind
      if (kind === "timeout") gov.limiter?.onThrottle()
      gov.breaker?.onFailure(now())

      if (attempt < maxRetries && ReplayError.isRetryable(kind, method, opts.safeToRetry)) {
        await sleep(backoff[Math.min(attempt, backoff.length - 1)])
        continue
      }
      return { ...r, attempts, retried: attempts > 1 }
    }

    return { ...(last as ReplayResponse.Result), attempts }
  }
}
