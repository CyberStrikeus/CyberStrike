// Unified body model for BOTH request and response bodies. A body can be any media type — JSON,
// XML, HTML, form-urlencoded, multipart, GraphQL, plaintext, binary — and request and response
// often differ (POST JSON → HTML error page; GET → JSON). This classifies the kind by content-type
// (falling back to a light content sniff) and extracts a flat name→value field map for the
// structured kinds, so rules and HTTPQL can address fields in EITHER direction (req.body.x AND
// resp.body.x).
import type { Header } from "./transaction"
import { header } from "./transaction"

export type BodyKind = "empty" | "json" | "graphql" | "form" | "multipart" | "xml" | "html" | "text" | "binary"

export interface BodyView {
  kind: BodyKind
  // Flattened fields for structured kinds (json/graphql/form/multipart/xml). Empty for text/html/
  // binary — for those the raw body is what rules regex over.
  fields: Record<string, string>
}

const MAX_KEYS = 200
const MAX_DEPTH = 8

// Flatten nested JSON to dot-path keys: {a:{b:1}} → {"a.b":"1"}; arrays index. Scalars stringify.
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
      flatten((value as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key, out, depth + 1)
    }
    return
  }
  if (prefix) out[prefix] = String(value)
}

function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const [k, v] of new URLSearchParams(body)) out[k] = v
  } catch {}
  return out
}

// Extract multipart fields: text field name→value, file part name→"<file:filename>" + name.filename.
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
    } else {
      out[name] = content.slice(0, 500)
    }
    if (Object.keys(out).length >= MAX_KEYS) break
  }
  return out
}

// Best-effort XML: pull leaf elements (<tag>text</tag>) into tag→text. Not a full parser (no deps,
// no attributes/namespaces) — enough for reflection / field-presence checks; documented as such.
function parseXmlLeaves(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /<([A-Za-z_][\w.:-]*)(?:\s[^>]*)?>([^<]+)<\/\1\s*>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const text = m[2]!.trim()
    if (text) out[m[1]!] = text.slice(0, 300)
    if (Object.keys(out).length >= MAX_KEYS) break
  }
  return out
}

// Classify the media type from the content-type header, falling back to a light content sniff.
export function bodyKind(contentType: string, body?: string): BodyKind {
  if (!body) return "empty"
  const ct = contentType.toLowerCase()
  if (ct.includes("application/graphql")) return "graphql"
  if (ct.includes("json") || ct.endsWith("+json")) return "json"
  if (ct.includes("x-www-form-urlencoded")) return "form"
  if (ct.includes("multipart/form-data")) return "multipart"
  if (ct.includes("xml") || ct.endsWith("+xml")) return "xml"
  if (ct.includes("text/html") || ct.includes("application/xhtml")) return "html"
  if (ct.startsWith("text/")) return "text"
  if (/^(image|audio|video|font)\//.test(ct) || ct.includes("octet-stream") || ct.includes("pdf") || ct.includes("wasm")) return "binary"
  // No/unknown content-type → sniff the body.
  const t = body.trimStart()
  if (t.startsWith("{") || t.startsWith("[")) return "json"
  if (/^<!doctype html/i.test(t) || /^<html/i.test(t)) return "html"
  if (t.startsWith("<")) return "xml"
  return "text"
}

// Classify + extract fields for a body given its content-type header value.
export function analyzeBody(contentType: string, body?: string): BodyView {
  const kind = bodyKind(contentType, body)
  if (!body) return { kind, fields: {} }
  if (kind === "json" || kind === "graphql") {
    try {
      const out: Record<string, string> = {}
      flatten(JSON.parse(body), "", out, 0)
      return { kind, fields: out }
    } catch {
      return { kind, fields: {} }
    }
  }
  if (kind === "form") return { kind, fields: parseForm(body) }
  if (kind === "multipart") {
    const boundary = /boundary=("?)([^";]+)\1/i.exec(contentType)?.[2]
    return { kind, fields: boundary ? parseMultipart(body, boundary) : {} }
  }
  if (kind === "xml") return { kind, fields: parseXmlLeaves(body) }
  return { kind, fields: {} } // html / text / binary / empty → raw only
}

// Convenience over a message (headers + body) — used for both request and response.
export function messageBody(headers: Header[], body: string | undefined): BodyView {
  return analyzeBody(header(headers, "content-type") ?? "", body)
}
