// Response parsing and the unified send-result shape (design §3.10). The raw
// TCP/TLS backend receives response BYTES and must parse the status line,
// headers, and body itself (the fetch backend gets a parsed Response and adapts
// into the same shape). Both backends produce a `ReplayResponse` so the agent
// sees one consistent structure regardless of how the request was sent.
//
// No network, no dependencies — the byte parsing half is pure and testable.

import { ReplayError } from "./errors"

export namespace ReplayResponse {
  export interface Header {
    name: string
    value: string
  }

  /** A parsed HTTP response (status line + headers + body bytes). */
  export interface Parsed {
    version: string
    status: number
    reason: string
    headers: Header[]
    body: Uint8Array
  }

  /** Timing breakdown in milliseconds (best-effort; a backend fills what it can). */
  export interface Timing {
    totalMs: number
    ttfbMs?: number
    dnsMs?: number
    connectMs?: number
    tlsMs?: number
  }

  /**
   * The unified result of a send. Exactly one of `response` (a reply arrived,
   * any status) or `error` (transport-level failure) is populated. `timing` is
   * always present so a timeout — which surfaces as `error.kind === "timeout"` —
   * still carries elapsed time, the signal a time-based-injection test needs.
   */
  export interface Result {
    response?: Parsed
    error?: { kind: ReplayError.Kind; message: string }
    timing: Timing
    /** True when the send was retried; a finding built on it should note this. */
    retried?: boolean
  }

  const CR = 0x0d
  const LF = 0x0a
  const decoder = new TextDecoder("latin1")

  function findHeaderEnd(bytes: Uint8Array): number {
    for (let i = 0; i + 1 < bytes.length; i++) {
      if (
        bytes[i] === CR &&
        bytes[i + 1] === LF &&
        i + 3 < bytes.length &&
        bytes[i + 2] === CR &&
        bytes[i + 3] === LF
      ) {
        return i + 4
      }
      if (bytes[i] === LF && bytes[i + 1] === LF) return i + 2
    }
    return -1
  }

  /**
   * Parse raw response bytes into a structured response. The body is returned
   * verbatim (transfer-decoding such as chunked is the backend's concern; this
   * parser does not de-chunk). Header order, case, and duplicates are preserved.
   */
  export function parse(bytes: Uint8Array): Parsed {
    const headerEnd = findHeaderEnd(bytes)
    const headerBytes = headerEnd === -1 ? bytes : bytes.subarray(0, headerEnd)
    const body = headerEnd === -1 ? new Uint8Array(0) : bytes.subarray(headerEnd)

    const lines = decoder
      .decode(headerBytes)
      .split("\n")
      .map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l))
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()

    const statusLine = lines.shift()
    if (!statusLine || statusLine.trim() === "") {
      throw new Error("ReplayResponse.parse: empty or missing status line")
    }

    // Status line: HTTP-version SP status-code SP reason-phrase. Reason may be
    // empty or contain spaces; split on the first two spaces only.
    const firstSpace = statusLine.indexOf(" ")
    if (firstSpace === -1) {
      throw new Error(`ReplayResponse.parse: malformed status line: ${statusLine}`)
    }
    const version = statusLine.slice(0, firstSpace)
    const afterVersion = statusLine.slice(firstSpace + 1)
    const secondSpace = afterVersion.indexOf(" ")
    const statusStr = secondSpace === -1 ? afterVersion : afterVersion.slice(0, secondSpace)
    const reason = secondSpace === -1 ? "" : afterVersion.slice(secondSpace + 1)
    const status = Number.parseInt(statusStr, 10)
    if (!Number.isFinite(status)) {
      throw new Error(`ReplayResponse.parse: non-numeric status: ${statusStr}`)
    }

    const headers: Header[] = []
    for (const line of lines) {
      if (line === "") continue
      const colon = line.indexOf(":")
      if (colon === -1) {
        headers.push({ name: line, value: "" })
        continue
      }
      const name = line.slice(0, colon)
      let value = line.slice(colon + 1)
      if (value.startsWith(" ")) value = value.slice(1)
      headers.push({ name, value })
    }

    return { version, status, reason, headers, body }
  }

  /** Case-insensitive lookup of the first header value. */
  export function header(res: Parsed, name: string): string | undefined {
    const lower = name.toLowerCase()
    return res.headers.find((h) => h.name.toLowerCase() === lower)?.value
  }

  /** Whether a Retry-After header is present (used for the 503 throttle rule). */
  export function hasRetryAfter(res: Parsed): boolean {
    return header(res, "retry-after") !== undefined
  }
}
