// Mutation application + curl-equivalent export (design §3.1 / §3.12). Pure glue
// between the agent-facing mutation list and the Mutate/Encode primitives, kept
// out of the tool file so it can be unit-tested without the CS workspace. A
// mutation's `value` is optionally passed through an Encode pipeline BEFORE it is
// applied, so the agent controls exactly what bytes land (single vs double
// url-encode, base64, etc.).
//
// No network, no dependencies.

import { HttpMessage } from "./message"
import { Mutate } from "./mutate"
import { Encode } from "./encode"

export namespace Apply {
  export type Op =
    | "set-query"
    | "add-query"
    | "remove-query"
    | "set-header"
    | "add-header"
    | "remove-header"
    | "set-body"
    | "set-method"
    | "set-target"
    | "body-merge"
    | "body-set-field"
    | "body-remove-field"
    | "set-cookie"
    | "remove-cookie"
    | "set-path-param"

  export interface Mutation {
    op: Op
    /** Param/header name; ignored for set-body/set-method/set-target. */
    name?: string
    /** New value; for set-method it's the method, for set-target the request-target. */
    value?: string
    /** Encode pipeline applied to `value` before it is set (WAF-bypass control). */
    encode?: Encode.Codec[]
  }

  function encoded(m: Mutation): string {
    const v = m.value ?? ""
    return m.encode && m.encode.length > 0 ? Encode.pipeline(v, m.encode) : v
  }

  /**
   * Apply an ordered list of mutations to a request, returning a new request
   * (each Mutate.* call is immutable). Unknown/incomplete mutations throw so a
   * malformed agent request surfaces loudly rather than silently no-op'ing.
   */
  export function mutations(req: HttpMessage.Request, ops: Mutation[]): HttpMessage.Request {
    let out = req
    for (const m of ops) {
      const val = encoded(m)
      switch (m.op) {
        case "set-query":
          out = Mutate.setQuery(out, req_name(m), val)
          break
        case "add-query":
          out = Mutate.addQuery(out, req_name(m), val)
          break
        case "remove-query":
          out = Mutate.removeQuery(out, req_name(m))
          break
        case "set-header":
          out = Mutate.setHeader(out, req_name(m), val)
          break
        case "add-header":
          out = Mutate.addHeader(out, req_name(m), val)
          break
        case "remove-header":
          out = Mutate.removeHeader(out, req_name(m))
          break
        case "set-body":
          out = Mutate.setBody(out, val)
          break
        case "set-method":
          out = Mutate.setMethod(out, val)
          break
        case "set-target":
          out = Mutate.setTarget(out, val)
          break
        case "body-merge":
          out = Mutate.bodyMerge(out, val)
          break
        case "body-set-field":
          out = Mutate.bodySetField(out, req_name(m), val)
          break
        case "body-remove-field":
          out = Mutate.bodyRemoveField(out, req_name(m))
          break
        case "set-cookie":
          out = Mutate.setCookie(out, req_name(m), val)
          break
        case "remove-cookie":
          out = Mutate.removeCookie(out, req_name(m))
          break
        case "set-path-param":
          out = Mutate.setPathParam(out, parseInt(req_name(m), 10), val)
          break
      }
    }
    return out
  }

  function req_name(m: Mutation): string {
    if (!m.name) throw new Error(`mutation ${m.op} requires a "name"`)
    return m.name
  }

  /**
   * Build a copy-pasteable curl command equivalent to this request against
   * `origin` — evidence for the report (§3.12). Not executed; single-quoted so
   * the shell would treat payloads as literal data.
   */
  export function toCurl(req: HttpMessage.Request, origin: string): string {
    const url = origin.replace(/\/+$/, "") + req.target
    const parts = [`curl -sk -X ${sq(req.method)}`, sq(url)]
    for (const h of req.headers) {
      if (h.name.toLowerCase() === "content-length") continue // curl sets it
      parts.push(`-H ${sq(`${h.name}: ${h.value}`)}`)
    }
    if (req.body.length > 0) {
      parts.push(`--data-raw ${sq(new TextDecoder("latin1").decode(req.body))}`)
    }
    return parts.join(" ")
  }

  /** Single-quote for shell display: wrap in ' and escape embedded ' as '\''. */
  function sq(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`
  }
}
