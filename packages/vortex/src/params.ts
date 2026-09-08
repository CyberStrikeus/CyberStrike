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
  const ctRaw = header(tx.request.headers, "content-type") ?? ""
  const ct = ctRaw.toLowerCase()
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
  if (ct.includes("multipart/form-data")) {
    // Extract the boundary from the ORIGINAL-case header — the boundary token is case-sensitive and
    // must match the body's delimiter exactly (lowercasing it breaks the split).
    const boundary = /boundary=("?)([^";]+)\1/i.exec(ctRaw)?.[2]
    if (boundary) return parseMultipart(body, boundary)
  }
  return {}
}

// Extract the FIELDS of a multipart/form-data body: text field name→value, and file part
// name→"<file:filename>" (plus name.filename). Binary file content itself is not surfaced — the
// point is the field/attachment SHAPE (a file-upload endpoint's parameters), not the bytes.
function parseMultipart(body: string, boundary: string): Record<string, string> {
  const out: Record<string, string> = {}
  const marker = `--${boundary}`
  for (const raw of body.split(marker)) {
    const part = raw.replace(/^\r?\n/, "")
    if (part === "" || part === "--" || part === "--\r\n") continue
    const sep = part.search(/\r?\n\r?\n/)
    if (sep === -1) continue
    const head = part.slice(0, sep)
    const content = part.slice(sep).replace(/^\r?\n\r?\n/, "").replace(/\r?\n$/, "")
    const cd = /content-disposition:[^\r\n]*/i.exec(head)?.[0] ?? ""
    const name = /\bname=("?)([^";\r\n]+)\1/i.exec(cd)?.[2]
    if (!name) continue
    const filename = /\bfilename=("?)([^";\r\n]*)\1/i.exec(cd)?.[2]
    if (filename !== undefined) {
      out[name] = `<file:${filename}>`
      out[`${name}.filename`] = filename
      if (Object.keys(out).length >= MAX_KEYS) break
      continue
    }
    out[name] = content.slice(0, 500)
    if (Object.keys(out).length >= MAX_KEYS) break
  }
  return out
}

export function params(tx: Transaction): Params {
  return { query: parseQuery(tx.request.url), body: parseBody(tx) }
}
