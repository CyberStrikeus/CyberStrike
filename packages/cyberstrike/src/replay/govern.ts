// Governed send — the single "send one HttpMessage through the fetch backend"
// primitive. Extracted so every caller (http_replay's tool wrapper, access_probe,
// the webhook smart tools' ReplaySender) shares ONE governed-send path instead of
// re-implementing the budget/breaker/Send.governed boilerplate.
//
// Governors are shared per ROOT session (issue #91): a `session` key routes every
// send from every parallel sub-agent of one engagement through ONE GlobalBudget and
// ONE per-host CircuitBreaker / AimdLimiter / TokenBucket, so the anti-self-DoS cap,
// the circuit breaker and the rate limiter actually accumulate and trip. The target
// sees aggregate load from all sub-agents, so the quota must be aggregate too.
// Without a key (legacy callers) the primitives are created fresh per call, as before.
import { HttpMessage } from "./message"
import { Send } from "./send"
import { BackendFetch } from "./backend-fetch"
import { Governor } from "./governor"

export interface GovernOptions {
  insecureTls?: boolean // default true (accept bad certs) — pass false to reject
  totalTimeoutMs?: number
  followRedirects?: boolean
  signal?: AbortSignal
  /** Root sessionID (Session.root(ctx.sessionID)). When set, governors are shared
   *  across every send under the same run — all parallel sub-agents — instead of
   *  created fresh per call. */
  session?: string
}

// ── Shared governor registry ───────────────────────────────────────────────
// Keyed by root sessionID, then by host within a run. Bounded so a long-lived
// server never grows unbounded — a finished engagement's governors are safe to
// evict (oldest first), and releaseGovernors() drops one promptly on session end.
export interface HostGovernors {
  budget: Governor.GlobalBudget
  breaker: Governor.CircuitBreaker
  limiter: Governor.AimdLimiter
  bucket: Governor.TokenBucket
}

interface Host {
  breaker: Governor.CircuitBreaker
  limiter: Governor.AimdLimiter
  bucket: Governor.TokenBucket
}

interface Run {
  budget: Governor.GlobalBudget
  hosts: Map<string, Host>
}

const MAX_RUNS = 256
const runs = new Map<string, Run>()

/** The shared governors for one run + host, created once and reused by every send
 *  (and by the sweep's adaptive-concurrency / rate-pacing loop). */
export function governorsFor(session: string, host: string): HostGovernors {
  const run = runFor(session)
  const existing = run.hosts.get(host)
  if (existing) return { budget: run.budget, ...existing }
  // Breaker / limiter / bucket are per host: a dead or throttling target backs off
  // its own traffic without stalling sends to other in-scope hosts.
  const host0: Host = {
    breaker: new Governor.CircuitBreaker(),
    limiter: new Governor.AimdLimiter(),
    bucket: new Governor.TokenBucket(
      Governor.DEFAULTS.rateLimitStartRps,
      Governor.DEFAULTS.rateLimitStartRps,
      Date.now(),
    ),
  }
  run.hosts.set(host, host0)
  return { budget: run.budget, ...host0 }
}

function runFor(session: string): Run {
  const existing = runs.get(session)
  if (existing) return existing
  // One GlobalBudget caps TOTAL requests for the whole run (every sub-agent of it).
  if (runs.size >= MAX_RUNS) {
    const oldest = runs.keys().next().value
    if (oldest !== undefined) runs.delete(oldest)
  }
  const run: Run = { budget: new Governor.GlobalBudget(), hosts: new Map() }
  runs.set(session, run)
  return run
}

/** Drop a run's shared governors — call when its (root) session ends. */
export function releaseGovernors(session: string): void {
  runs.delete(session)
}

/** Send `msg` to `origin` through the governed fetch backend. With `opts.session`
 *  the budget + per-host breaker/limiter are shared across the whole run. */
export function governedSend(msg: HttpMessage.Request, origin: string, opts: GovernOptions = {}): Promise<Send.Result> {
  const shared = opts.session ? governorsFor(opts.session, origin) : undefined
  const gov: Send.Governors = shared
    ? { budget: shared.budget, breaker: shared.breaker, limiter: shared.limiter }
    : { budget: new Governor.GlobalBudget(), breaker: new Governor.CircuitBreaker() }
  return Send.governed(
    () =>
      BackendFetch.send(msg, {
        origin,
        rejectUnauthorized: opts.insecureTls === false,
        totalTimeoutMs: opts.totalTimeoutMs,
        followRedirects: opts.followRedirects,
        signal: opts.signal,
      }),
    msg.method,
    gov,
    {},
  )
}
