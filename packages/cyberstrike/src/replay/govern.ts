// Governed send — the single "send one HttpMessage through the fetch backend with a
// fresh budget + circuit breaker" primitive. Extracted so every caller (http_replay's
// tool wrapper, the webhook smart tools' ReplaySender) shares ONE governed-send path
// instead of re-implementing the budget/breaker/Send.governed boilerplate.
import { HttpMessage } from "./message"
import { Send } from "./send"
import { BackendFetch } from "./backend-fetch"
import { Governor } from "./governor"

export interface GovernOptions {
  insecureTls?: boolean // default true (accept bad certs) — pass false to reject
  totalTimeoutMs?: number
  followRedirects?: boolean
  signal?: AbortSignal
}

/** Send `msg` to `origin` through the governed fetch backend (fresh budget + breaker). */
export function governedSend(msg: HttpMessage.Request, origin: string, opts: GovernOptions = {}): Promise<Send.Result> {
  const budget = new Governor.GlobalBudget()
  const breaker = new Governor.CircuitBreaker()
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
    { budget, breaker },
    {},
  )
}
