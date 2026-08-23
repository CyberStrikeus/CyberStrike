// Field-level mutation over the HttpMessage model (design §3.2 query, §3.3
// headers, plus method/target/version). Pure functions that clone the request
// and return a new one — never mutate the input, so a battery can derive many
// variants from one base without cross-contamination.
//
// Values are treated as RAW: nothing here URL-encodes or decodes. Encoding is a
// separate, explicit toolkit (design §3.5) so the agent controls exactly what
// bytes land on the wire — e.g. testing a double-encoded payload deterministically.
//
// No network, no dependencies.

import { HttpMessage } from "./message"

export namespace Mutate {
  /** Deep-clone a Request so mutations can't leak back to the base. */
  export function clone(req: HttpMessage.Request): HttpMessage.Request {
    return {
      method: req.method,
      target: req.target,
      version: req.version,
      headers: req.headers.map((h) => ({ name: h.name, value: h.value })),
      body: req.body.slice(),
    }
  }

  // ── Request line ───────────────────────────────────────────────────────────

  export function setMethod(req: HttpMessage.Request, method: string): HttpMessage.Request {
    const out = clone(req)
    out.method = method
    return out
  }

  export function setTarget(req: HttpMessage.Request, target: string): HttpMessage.Request {
    const out = clone(req)
    out.target = target
    return out
  }

  export function setVersion(req: HttpMessage.Request, version: string): HttpMessage.Request {
    const out = clone(req)
    out.version = version
    return out
  }

  // ── Query string ─────────────────────────────────────────────────────────

  /** One query parameter, kept raw. `hasEquals` distinguishes `k=` (empty value)
   * from a bare `k` (no `=` at all) — both occur in real apps and change parsing. */
  export interface QueryParam {
    key: string
    value: string
    hasEquals: boolean
  }

  /** Split a request-target into its path and ordered query params. The path
   * keeps everything before the first `?` verbatim (no normalization). */
  export function splitTarget(target: string): { path: string; query: QueryParam[] } {
    const q = target.indexOf("?")
    if (q === -1) return { path: target, query: [] }
    const path = target.slice(0, q)
    const rest = target.slice(q + 1)
    if (rest === "") return { path, query: [] }
    const query = rest.split("&").map((pair) => {
      const eq = pair.indexOf("=")
      if (eq === -1) return { key: pair, value: "", hasEquals: false }
      return { key: pair.slice(0, eq), value: pair.slice(eq + 1), hasEquals: true }
    })
    return { path, query }
  }

  /** Reassemble a path + ordered query params back into a request-target. */
  export function joinTarget(path: string, query: QueryParam[]): string {
    if (query.length === 0) return path
    const qs = query.map((p) => (p.hasEquals ? `${p.key}=${p.value}` : p.key)).join("&")
    return `${path}?${qs}`
  }

  function withQuery(
    req: HttpMessage.Request,
    fn: (query: QueryParam[]) => QueryParam[],
  ): HttpMessage.Request {
    const { path, query } = splitTarget(req.target)
    return setTarget(req, joinTarget(path, fn(query)))
  }

  /** Replace the value of every param named `key`. No-op if the key is absent
   * (use addQuery to introduce it). Sets `hasEquals` so `k` becomes `k=value`. */
  export function setQuery(req: HttpMessage.Request, key: string, value: string): HttpMessage.Request {
    return withQuery(req, (query) =>
      query.map((p) => (p.key === key ? { key, value, hasEquals: true } : p)),
    )
  }

  /** Append a param, even if `key` already exists — enables HTTP parameter
   * pollution (`?id=1&id=2`). */
  export function addQuery(req: HttpMessage.Request, key: string, value: string): HttpMessage.Request {
    return withQuery(req, (query) => [...query, { key, value, hasEquals: true }])
  }

  /** Remove every param named `key`. */
  export function removeQuery(req: HttpMessage.Request, key: string): HttpMessage.Request {
    return withQuery(req, (query) => query.filter((p) => p.key !== key))
  }

  // ── Headers ────────────────────────────────────────────────────────────────

  /** Replace the value of every header named `name` (case-insensitive match). If
   * none exists, append one. Case of an existing header's name is preserved. */
  export function setHeader(req: HttpMessage.Request, name: string, value: string): HttpMessage.Request {
    const out = clone(req)
    const lower = name.toLowerCase()
    let found = false
    out.headers = out.headers.map((h) => {
      if (h.name.toLowerCase() === lower) {
        found = true
        return { name: h.name, value }
      }
      return h
    })
    if (!found) out.headers.push({ name, value })
    return out
  }

  /** Append a header unconditionally, even if one with the same name exists
   * (duplicate headers — smuggling / parser-differential tests). */
  export function addHeader(req: HttpMessage.Request, name: string, value: string): HttpMessage.Request {
    const out = clone(req)
    out.headers.push({ name, value })
    return out
  }

  /** Remove every header named `name` (case-insensitive). */
  export function removeHeader(req: HttpMessage.Request, name: string): HttpMessage.Request {
    const out = clone(req)
    const lower = name.toLowerCase()
    out.headers = out.headers.filter((h) => h.name.toLowerCase() !== lower)
    return out
  }

  // ── Body ─────────────────────────────────────────────────────────────────

  /** Replace the raw body bytes. Does NOT touch Content-Length — send-time
   * backends own that (design §3.4), so a deliberate length mismatch stays
   * possible. */
  export function setBody(req: HttpMessage.Request, body: string | Uint8Array): HttpMessage.Request {
    const out = clone(req)
    out.body = typeof body === "string" ? new TextEncoder().encode(body) : body.slice()
    return out
  }

  // ── Cookie (individual cookie manipulation) ─────────────────────────────

  function parseCookieHeader(header: string): Map<string, string> {
    const cookies = new Map<string, string>()
    for (const pair of header.split(";")) {
      const trimmed = pair.trim()
      if (!trimmed) continue
      const eq = trimmed.indexOf("=")
      if (eq === -1) {
        cookies.set(trimmed, "")
        continue
      }
      cookies.set(trimmed.slice(0, eq), trimmed.slice(eq + 1))
    }
    return cookies
  }

  function serializeCookieHeader(cookies: Map<string, string>): string {
    return [...cookies].map(([k, v]) => (v ? `${k}=${v}` : k)).join("; ")
  }

  export function setCookie(req: HttpMessage.Request, name: string, value: string): HttpMessage.Request {
    const out = clone(req)
    const idx = out.headers.findIndex((h) => h.name.toLowerCase() === "cookie")
    if (idx === -1) {
      out.headers.push({ name: "Cookie", value: `${name}=${value}` })
      return out
    }
    const cookies = parseCookieHeader(out.headers[idx].value)
    cookies.set(name, value)
    out.headers[idx] = { name: out.headers[idx].name, value: serializeCookieHeader(cookies) }
    return out
  }

  export function removeCookie(req: HttpMessage.Request, name: string): HttpMessage.Request {
    const out = clone(req)
    const idx = out.headers.findIndex((h) => h.name.toLowerCase() === "cookie")
    if (idx === -1) return out
    const cookies = parseCookieHeader(out.headers[idx].value)
    cookies.delete(name)
    if (cookies.size === 0) {
      out.headers = out.headers.filter((_, i) => i !== idx)
      return out
    }
    out.headers[idx] = { name: out.headers[idx].name, value: serializeCookieHeader(cookies) }
    return out
  }

  // ── JSON body (field-level manipulation) ────────────────────────────────

  function parseJsonBody(req: HttpMessage.Request): Record<string, unknown> {
    try {
      return JSON.parse(new TextDecoder().decode(req.body))
    } catch {
      return {}
    }
  }

  function setNested(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split(".")
    let cur: Record<string, unknown> = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i]
      if (cur[k] === undefined || cur[k] === null || typeof cur[k] !== "object") cur[k] = {}
      cur = cur[k] as Record<string, unknown>
    }
    cur[parts[parts.length - 1]] = value
  }

  function removeNested(obj: Record<string, unknown>, path: string): void {
    const parts = path.split(".")
    let cur: Record<string, unknown> = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i]
      if (cur[k] === undefined || typeof cur[k] !== "object") return
      cur = cur[k] as Record<string, unknown>
    }
    delete cur[parts[parts.length - 1]]
  }

  function tryParseJson(value: string): unknown {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }

  /** Merge JSON fields into the existing body. Does not replace the body —
   * shallow-merges top-level keys from `fields` (a JSON string) into the
   * parsed body, so the agent can inject extra fields without knowing or
   * copying the original body content. */
  export function bodyMerge(req: HttpMessage.Request, fields: string): HttpMessage.Request {
    const obj = parseJsonBody(req)
    let merge: Record<string, unknown>
    try {
      merge = JSON.parse(fields)
    } catch {
      return req
    }
    return setBody(req, JSON.stringify({ ...obj, ...merge }))
  }

  /** Set a nested JSON field by dot-path (e.g. "user.role"). The value
   * string is parsed as JSON first; if that fails it is kept as a raw string.
   * Intermediate objects are created when missing. */
  export function bodySetField(req: HttpMessage.Request, path: string, value: string): HttpMessage.Request {
    const obj = parseJsonBody(req)
    setNested(obj, path, tryParseJson(value))
    return setBody(req, JSON.stringify(obj))
  }

  /** Remove a nested JSON field by dot-path. No-op if the path does not exist. */
  export function bodyRemoveField(req: HttpMessage.Request, path: string): HttpMessage.Request {
    const obj = parseJsonBody(req)
    removeNested(obj, path)
    return setBody(req, JSON.stringify(obj))
  }

  // ── Path parameters ─────────────────────────────────────────────────────

  /** Replace a path segment by its 0-based position. The position counts
   * slash-separated segments including the leading empty segment (position 0
   * is before the first `/`), so for `/api/users/123` the segments are
   * `["", "api", "users", "123"]` — position 3 is `"123"`. */
  export function setPathParam(req: HttpMessage.Request, position: number, value: string): HttpMessage.Request {
    const { path, query } = splitTarget(req.target)
    const segments = path.split("/")
    if (position < 0 || position >= segments.length) return req
    segments[position] = value
    return setTarget(req, joinTarget(segments.join("/"), query))
  }
}
