// Structured parameter extraction: pull the query params and the body params out of a request as
// flat name→value maps, so rules and HTTPQL can reason about INPUTS (`query.id`, `body.params.
// staff_name`) instead of grepping a raw string. This is what lets an injection rule target the
// exact parameter (the SQLi we found lived in `params.staff_name`).
import type { Transaction } from "./transaction"
import { header } from "./transaction"

export interface Params {
  query: Record<string, string>
  body: Record<string, string>
}

const MAX_KEYS = 200 // guard against a pathological body blowing up the flat map
const MAX_DEPTH = 8

// Flatten nested JSON into dot-path keys with string values: {a:{b:1}} → {"a.b":"1"}. Arrays index:
// {x:[{y:2}]} → {"x.0.y":"2"}. Scalars stringify. Bounded by depth + key count.
function flatten(value: unknown, prefix: string, out: Record<string, string>, depth: number): void {
  if (Object.keys(out).length >= MAX_KEYS) return
  if (value === null || value === undefined) {
    if (prefix) out[prefix] = String(value)
    return
  }
  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) {
      out[prefix] = JSON.stringify(value).slice(0, 200)
      return
    }
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (Object.keys(out).length >= MAX_KEYS) return
      const next = prefix ? `${prefix}.${key}` : key
      flatten((value as Record<string, unknown>)[key], next, out, depth + 1)
    }
    return
  }
  if (prefix) out[prefix] = String(value)
}

function parseQuery(url: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const [k, v] of new URL(url).searchParams) out[k] = v
  } catch {
    const q = url.indexOf("?")
    if (q !== -1) {
      try {
        for (const [k, v] of new URLSearchParams(url.slice(q + 1))) out[k] = v
      } catch {}
    }
  }
  return out
}

function parseBody(tx: Transaction): Record<string, string> {
  const body = tx.request.body
  if (!body) return {}
  const ct = (header(tx.request.headers, "content-type") ?? "").toLowerCase()
  if (ct.includes("application/json") || (body.trim().startsWith("{") && body.trim().endsWith("}"))) {
    try {
      const out: Record<string, string> = {}
      flatten(JSON.parse(body), "", out, 0)
      return out
    } catch {
      return {}
    }
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    const out: Record<string, string> = {}
    try {
      for (const [k, v] of new URLSearchParams(body)) out[k] = v
    } catch {}
    return out
  }
  return {}
}

export function params(tx: Transaction): Params {
  return { query: parseQuery(tx.request.url), body: parseBody(tx) }
}
