// HTTP message model — the structured, lossless layer of the replay engine
// (docs/http-replay-engine-design.md §2). A captured request is parsed into an
// ordered, case- and duplicate-preserving structure and serialized back to
// bytes. Byte-EXACT replay (intentionally-malformed requests, smuggling) is the
// raw-socket backend's job and bypasses this model; here "lossless" means the
// request line, header order/case/duplicates, and body bytes survive a
// parse→serialize round-trip, with canonical CRLF line endings on output.
//
// No network, no dependencies — pure and unit-testable.

export namespace HttpMessage {
  /** One header line. `name` and `value` are preserved verbatim (case included);
   * duplicate names are kept as separate entries in `Request.headers`. */
  export interface Header {
    name: string
    value: string
  }

  /** A parsed HTTP request. `target` is the request-target exactly as it appears
   * on the request line (origin-form path?query, or absolute/authority form for
   * proxies) — it is NOT normalized, so `..`, `%2e`, `//` survive. */
  export interface Request {
    method: string
    target: string
    version: string // e.g. "HTTP/1.1"
    headers: Header[]
    body: Uint8Array
  }

  const CR = 0x0d
  const LF = 0x0a

  const encoder = new TextEncoder()
  const decoder = new TextDecoder("latin1") // 1:1 byte↔char, never throws on non-UTF-8

  function toBytes(input: string | Uint8Array): Uint8Array {
    return typeof input === "string" ? encoder.encode(input) : input
  }

  /** Index of the header/body separator (blank line). Returns the offset of the
   * first body byte and the byte length of the separator that preceded it.
   * Tolerates both CRLFCRLF and bare LFLF. Returns -1 when no blank line. */
  function findHeaderEnd(bytes: Uint8Array): number {
    for (let i = 0; i + 1 < bytes.length; i++) {
      // CRLFCRLF
      if (
        bytes[i] === CR &&
        bytes[i + 1] === LF &&
        i + 3 < bytes.length &&
        bytes[i + 2] === CR &&
        bytes[i + 3] === LF
      ) {
        return i + 4
      }
      // LFLF (lenient)
      if (bytes[i] === LF && bytes[i + 1] === LF) {
        return i + 2
      }
    }
    return -1
  }

  /** Split the header block (bytes before the blank line) into physical lines,
   * tolerating CRLF or bare LF and dropping a trailing CR. */
  function splitLines(headerBlock: string): string[] {
    return headerBlock.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l))
  }

  /**
   * Parse raw request bytes (or a string) into a structured Request.
   * Throws on a missing/blank request line — everything else is accepted as-is,
   * because the point of this engine is to represent hostile/odd requests, not
   * to validate them.
   */
  export function parse(input: string | Uint8Array): Request {
    const bytes = toBytes(input)

    const headerEnd = findHeaderEnd(bytes)
    const headerBytes = headerEnd === -1 ? bytes : bytes.subarray(0, headerEnd)
    const body = headerEnd === -1 ? new Uint8Array(0) : bytes.subarray(headerEnd)

    const headerText = decoder.decode(headerBytes)
    const lines = splitLines(headerText)
    // Drop the trailing empty line(s) produced by the separator.
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()

    const requestLine = lines.shift()
    if (!requestLine || requestLine.trim() === "") {
      throw new Error("HttpMessage.parse: empty or missing request line")
    }

    // Request line: METHOD SP request-target SP HTTP-version. Split on the FIRST
    // and LAST single space so a target containing spaces (malformed but real in
    // attacks) is preserved intact.
    const firstSpace = requestLine.indexOf(" ")
    const lastSpace = requestLine.lastIndexOf(" ")
    if (firstSpace === -1 || firstSpace === lastSpace) {
      throw new Error(`HttpMessage.parse: malformed request line: ${requestLine}`)
    }
    const method = requestLine.slice(0, firstSpace)
    const target = requestLine.slice(firstSpace + 1, lastSpace)
    const version = requestLine.slice(lastSpace + 1)

    const headers: Header[] = []
    for (const line of lines) {
      if (line === "") continue
      const colon = line.indexOf(":")
      if (colon === -1) {
        // A header line with no colon — keep it as a name with empty value so a
        // parse→serialize round-trip does not silently drop it.
        headers.push({ name: line, value: "" })
        continue
      }
      const name = line.slice(0, colon)
      // Strip a single optional leading OWS (space) after the colon — the
      // canonical form re-adds exactly one on serialize.
      let value = line.slice(colon + 1)
      if (value.startsWith(" ")) value = value.slice(1)
      headers.push({ name, value })
    }

    return { method, target, version, headers, body }
  }

  /**
   * Serialize a Request back to bytes with canonical CRLF line endings.
   * Round-trips the request line, header order/case/duplicates, and body from
   * `parse`. Does not touch or recompute Content-Length — send-time backends
   * own that (design §3.4).
   */
  export function serialize(req: Request): Uint8Array {
    const head =
      `${req.method} ${req.target} ${req.version}\r\n` +
      req.headers.map((h) => `${h.name}: ${h.value}`).join("\r\n") +
      (req.headers.length > 0 ? "\r\n\r\n" : "\r\n")

    const headBytes = encoder.encode(head)
    const out = new Uint8Array(headBytes.length + req.body.length)
    out.set(headBytes, 0)
    out.set(req.body, headBytes.length)
    return out
  }

  /** Convenience: serialize to a latin1 string (byte-faithful, debug/log use). */
  export function toString(req: Request): string {
    return decoder.decode(serialize(req))
  }

  /**
   * Build a Request from structured parts — the counterpart to `parse` for a
   * request constructed from a URL rather than captured bytes. Emits origin-form
   * request-target (path?query), a Host header from the URL, and a Content-Length
   * when a body is present and none was supplied. The caller derives the sendable
   * origin from the same URL (`scheme://host`).
   */
  export function build(input: {
    method: string
    url: URL
    headers?: Record<string, string>
    body?: string | Uint8Array
  }): Request {
    const headers: Header[] = [{ name: "Host", value: input.url.host }]
    if (input.headers)
      for (const [name, value] of Object.entries(input.headers)) headers.push({ name, value: String(value) })
    const body =
      input.body == null ? new Uint8Array(0) : typeof input.body === "string" ? encoder.encode(input.body) : input.body
    if (body.length > 0 && !headers.some((h) => h.name.toLowerCase() === "content-length")) {
      headers.push({ name: "Content-Length", value: String(body.length) })
    }
    return {
      method: input.method.toUpperCase(),
      target: (input.url.pathname || "/") + input.url.search,
      version: "HTTP/1.1",
      headers,
      body,
    }
  }
}
