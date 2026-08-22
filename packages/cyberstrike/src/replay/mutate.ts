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
}
