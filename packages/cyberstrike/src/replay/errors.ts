// Structured error taxonomy (design §3.11). Send failures are DATA, never
// swallowed — the agent must be able to tell a DNS failure from a TLS failure
// from a timeout, because each means something different for a security verdict
// (most critically: a timeout can be EVIDENCE of time-based injection, not a
// transport failure). This module maps raw Node/fetch/socket errors to a stable
// taxonomy and encodes the retry/idempotency policy.
//
// No network, no dependencies — pure classification.

export namespace ReplayError {
  export type Kind =
    | "dns" // host could not be resolved
    | "conn_refused" // TCP connection refused
    | "tls" // TLS handshake / certificate failure
    | "timeout" // request exceeded its deadline (may be time-based-injection EVIDENCE)
    | "reset" // connection reset / broken pipe mid-flight
    | "unreachable" // network/host unreachable
    | "http_error" // a real HTTP response arrived with a 4xx/5xx status
    | "rate_limited" // 429, or 503 with Retry-After — a throttling signal
    | "unknown"

  interface CodeCarrier {
    code?: string
    errno?: string
    name?: string
    cause?: unknown
    message?: string
  }

  // Error codes grouped by taxonomy kind, covering BOTH Node/undici codes and
  // Bun's native fetch codes (Bun surfaces e.g. "ConnectionRefused" rather than
  // POSIX "ECONNREFUSED"). Checked against the error message as a fallback too,
  // since fetch wraps causes unevenly across runtimes.
  const CODE_MAP: Record<string, Kind> = {
    // DNS
    ENOTFOUND: "dns",
    EAI_AGAIN: "dns",
    DNSFailure: "dns",
    FailedToResolveHostname: "dns",
    // Connection refused / could not open a socket
    ECONNREFUSED: "conn_refused",
    ConnectionRefused: "conn_refused",
    FailedToOpenSocket: "conn_refused",
    // Timeout
    ETIMEDOUT: "timeout",
    ConnectionTimedOut: "timeout",
    Timeout: "timeout",
    UND_ERR_CONNECT_TIMEOUT: "timeout",
    UND_ERR_HEADERS_TIMEOUT: "timeout",
    UND_ERR_BODY_TIMEOUT: "timeout",
    // Reset / broken connection mid-flight
    ECONNRESET: "reset",
    EPIPE: "reset",
    ConnectionClosed: "reset",
    UND_ERR_SOCKET: "reset",
    // Network / host unreachable
    ENETUNREACH: "unreachable",
    EHOSTUNREACH: "unreachable",
  }

  function pickCode(err: CodeCarrier): string | undefined {
    return err.code ?? err.errno
  }

  /**
   * Classify a thrown error (from fetch, undici, or a raw socket) into a Kind.
   * Unwraps `cause` chains and falls back to name/message heuristics. Returns
   * "unknown" when nothing matches — never guesses "timeout" (which would mask a
   * real time-based finding) unless an actual timeout/abort signal is present.
   */
  export function classify(err: unknown): Kind {
    if (!err || typeof err !== "object") return "unknown"
    const e = err as CodeCarrier

    const code = pickCode(e)
    if (code && CODE_MAP[code]) return CODE_MAP[code]

    // AbortError is how fetch surfaces a deadline (AbortController) — a timeout.
    if (e.name === "AbortError" || e.name === "TimeoutError") return "timeout"

    // TLS failures surface as codes starting ERR_TLS / with CERT in them, or a
    // DEPTH_ZERO / SELF_SIGNED style message.
    const msg = (e.message ?? "").toUpperCase()
    if (
      (code && (code.startsWith("ERR_TLS") || code.startsWith("ERR_SSL") || code.includes("CERT"))) ||
      msg.includes("CERT") ||
      msg.includes("SSL") ||
      msg.includes("TLS HANDSHAKE")
    ) {
      return "tls"
    }

    // Message fallbacks for runtimes that don't set a recognizable code.
    if (msg.includes("UNABLE TO CONNECT") || msg.includes("CONNECTION REFUSED")) return "conn_refused"
    if (msg.includes("TIMED OUT") || msg.includes("TIMEOUT")) return "timeout"
    if (msg.includes("RESOLVE") && msg.includes("HOST")) return "dns"

    // Recurse into a wrapped cause (fetch: `TypeError: fetch failed` + cause).
    if (e.cause) {
      const inner = classify(e.cause)
      if (inner !== "unknown") return inner
    }

    return "unknown"
  }

  /** Map an HTTP status to a throttling verdict. 429 always; 503 is treated as a
   * throttle only when a Retry-After header accompanies it (otherwise it's a
   * generic http_error the caller decides about). */
  export function isRateLimited(status: number, hasRetryAfter: boolean): boolean {
    return status === 429 || (status === 503 && hasRetryAfter)
  }

  // ── Retry policy ───────────────────────────────────────────────────────────

  /** Kinds that MAY be retried for an idempotent request — transient transport
   * faults only. A `timeout` is deliberately NOT retryable: it may be a genuine
   * time-based-injection signal, and re-sending would both waste it and risk
   * duplicating a slow side effect. */
  const RETRYABLE: ReadonlySet<Kind> = new Set<Kind>(["dns", "reset", "unreachable"])

  const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS", "TRACE"])

  /**
   * Whether a failed send may be retried. Requires BOTH a transient kind AND an
   * idempotent method — a state-changing request (POST/PUT/PATCH/DELETE) is
   * never auto-retried, since a retry could double-charge / double-submit
   * (design §3.11 idempotency guard). `safeToRetry` lets a caller explicitly
   * override for a request it knows is side-effect-free.
   */
  export function isRetryable(kind: Kind, method: string, safeToRetry = false): boolean {
    if (!RETRYABLE.has(kind)) return false
    return safeToRetry || IDEMPOTENT_METHODS.has(method.toUpperCase())
  }
}
