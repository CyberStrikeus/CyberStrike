// Concurrency & rate governance (design §5/§16). Pure, deterministic state
// machines that protect the three things a fast replay engine can overwhelm: the
// target server, the AI model, and CyberStrike itself. Time is always passed in
// as `now` (ms) so these are fully unit-testable with no clock and no sleeps.
//
// The send layer wires these together; here they are independent primitives:
//   - CircuitBreaker  — stop hammering a host that keeps failing
//   - AimdLimiter     — additive-increase / multiplicative-decrease concurrency
//   - TokenBucket     — requests-per-second ceiling
//   - GlobalBudget    — hard cap on total requests per session (anti self-DoS)
//
// No network, no dependencies.

export namespace Governor {
  /** Approved defaults (see docs/http-replay-engine-design.md §5). All are
   * config-overridable at the call site; these are only safe starting points. */
  export const DEFAULTS = {
    connectTimeoutMs: 10_000,
    totalTimeoutMs: 30_000,
    maxRetries: 2,
    retryBackoffMs: [1_000, 2_000] as readonly number[],
    perHostConcurrencyStart: 2,
    perHostConcurrencyMax: 20,
    rateLimitStartRps: 5,
    circuitBreakerThreshold: 5,
    circuitBreakerCooldownMs: 30_000,
    globalRequestBudget: 5_000,
    agentPoolMax: 4,
    responseBodyCapBytes: 5 * 1024 * 1024,
  } as const

  export type CircuitState = "closed" | "open" | "half-open"

  /**
   * Per-host circuit breaker. Opens after `threshold` consecutive failures and
   * refuses requests until `cooldownMs` has elapsed, then allows probes
   * (half-open). One success closes it; one failure re-opens it. This keeps a
   * dead/rate-limiting host from stalling the whole run while other hosts
   * continue.
   */
  export class CircuitBreaker {
    private failures = 0
    private state: CircuitState = "closed"
    private openedAt = 0

    constructor(
      private readonly threshold: number = DEFAULTS.circuitBreakerThreshold,
      private readonly cooldownMs: number = DEFAULTS.circuitBreakerCooldownMs,
    ) {}

    /** Whether a request may proceed now. Transitions open→half-open once the
     * cooldown has passed. */
    canRequest(now: number): boolean {
      if (this.state === "open") {
        if (now - this.openedAt >= this.cooldownMs) {
          this.state = "half-open"
          return true
        }
        return false
      }
      return true // closed or half-open (probe allowed)
    }

    onSuccess(): void {
      this.failures = 0
      this.state = "closed"
    }

    onFailure(now: number): void {
      this.failures++
      if (this.state === "half-open" || this.failures >= this.threshold) {
        this.state = "open"
        this.openedAt = now
      }
    }

    get current(): CircuitState {
      return this.state
    }
  }

  /**
   * Additive-increase / multiplicative-decrease concurrency limit (TCP-congestion
   * style). Starts conservative, ramps up one slot per success, halves on a
   * throttle/timeout signal — so it auto-tunes to the target's real capacity
   * instead of a fixed guess.
   */
  export class AimdLimiter {
    private limit: number

    constructor(
      start: number = DEFAULTS.perHostConcurrencyStart,
      private readonly max: number = DEFAULTS.perHostConcurrencyMax,
    ) {
      this.limit = Math.max(1, start)
    }

    get value(): number {
      return this.limit
    }

    onSuccess(): void {
      if (this.limit < this.max) this.limit++
    }

    /** Back off on a throttle (429/503) or timeout — halve, floor 1. */
    onThrottle(): void {
      this.limit = Math.max(1, Math.floor(this.limit / 2))
    }
  }

  /**
   * Token bucket for a requests-per-second ceiling. Refills continuously at
   * `ratePerSec` up to `capacity`. `take` returns false when the bucket is dry
   * (caller should delay/queue rather than send).
   */
  export class TokenBucket {
    private tokens: number
    private last: number

    constructor(
      private readonly ratePerSec: number,
      private readonly capacity: number,
      now: number,
    ) {
      this.tokens = capacity
      this.last = now
    }

    private refill(now: number): void {
      if (now <= this.last) return
      const elapsedSec = (now - this.last) / 1000
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.ratePerSec)
      this.last = now
    }

    take(now: number, n = 1): boolean {
      this.refill(now)
      if (this.tokens >= n) {
        this.tokens -= n
        return true
      }
      return false
    }

    available(now: number): number {
      this.refill(now)
      return this.tokens
    }
  }

  /**
   * Hard cap on total requests for a session — the anti-self-DoS backstop. Once
   * exhausted, `tryConsume` returns false and the caller must stop.
   */
  export class GlobalBudget {
    private used = 0

    constructor(private readonly cap: number = DEFAULTS.globalRequestBudget) {}

    tryConsume(n = 1): boolean {
      if (this.used + n > this.cap) return false
      this.used += n
      return true
    }

    get remaining(): number {
      return Math.max(0, this.cap - this.used)
    }

    get consumed(): number {
      return this.used
    }
  }
}
