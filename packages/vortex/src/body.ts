// Unified body model for BOTH request and response bodies. A body can be any media type — JSON,
// XML, HTML, form-urlencoded, multipart, GraphQL, plaintext, binary — and request and response
// often differ (POST JSON → HTML error page; GET → JSON). This classifies the kind by content-type
// (falling back to a light content sniff) and extracts a flat name→value field map for the
// structured kinds, so rules and the DSL can address fields in EITHER direction (req.body.x AND
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

// ── HTML attribute helpers (regex, no DOM) ─────────────────────────────────
function attr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`, "i")
  const m = re.exec(attrs)
  if (!m) return undefined
  return m[1] ?? m[2] ?? m[3]
}
function hasAttr(attrs: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`, "i").test(attrs)
}

// ── HTML field extraction (security-relevant structure from response bodies) ─
const MAX_FORMS = 20
const MAX_LINKS = 50
const MAX_COMMENTS = 30
const MAX_SCRIPTS = 30
const MAX_IFRAMES = 10
const MAX_DATA_ATTRS = 50
const MAX_INLINE_SCRIPTS = 10
const META_NAMES: Record<string, string> = {
  "csrf-token": "csrf-token",
  "csrf-param": "csrf-param",
  "content-security-policy": "content-security-policy",
  "referrer": "referrer",
  "robots": "robots",
  "generator": "generator",
}

function parseHtmlFields(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  const full = () => Object.keys(out).length >= MAX_KEYS

  // A.1 — Forms
  const formRe = /<form\b([^>]*)>/gi
  let fm: RegExpExecArray | null
  let fi = 0
  while ((fm = formRe.exec(body)) && fi < MAX_FORMS && !full()) {
    const a = fm[1]!
    const action = attr(a, "action")
    const method = attr(a, "method") ?? "get"
    const enctype = attr(a, "enctype")
    const id = attr(a, "id")
    const name = attr(a, "name")
    if (action) out[`form.${fi}.action`] = action
    out[`form.${fi}.method`] = method
    if (enctype) out[`form.${fi}.enctype`] = enctype
    if (id) out[`form.${fi}.id`] = id
    if (name) out[`form.${fi}.name`] = name
    fi++
  }

  // A.2 — Input fields + A.4 hidden inputs
  const inputRe = /<input\b([^>]*)\/?>/gi
  let im: RegExpExecArray | null
  while ((im = inputRe.exec(body)) && !full()) {
    const a = im[1]!
    const name = attr(a, "name")
    if (!name) continue
    const type = attr(a, "type") ?? "text"
    out[`input.${name}.type`] = type
    const value = attr(a, "value")
    if (value !== undefined) out[`input.${name}.value`] = value.slice(0, 500)
    for (const p of ["maxlength", "pattern", "accept", "autocomplete", "formaction", "formmethod"]) {
      const v = attr(a, p)
      if (v !== undefined) out[`input.${name}.${p}`] = v
    }
    if (hasAttr(a, "required")) out[`input.${name}.required`] = "true"
    if (hasAttr(a, "readonly")) out[`input.${name}.readonly`] = "true"
    if (hasAttr(a, "disabled")) out[`input.${name}.disabled`] = "true"
    if (type.toLowerCase() === "hidden" && value !== undefined) out[`hidden.${name}`] = value.slice(0, 500)
  }

  // A.3 — Select/option
  const selectRe = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi
  let sm: RegExpExecArray | null
  while ((sm = selectRe.exec(body)) && !full()) {
    const name = attr(sm[1]!, "name")
    if (!name) continue
    const optRe = /<option\b([^>]*)>([^<]*)/gi
    const vals: string[] = []
    let selected: string | undefined
    let om: RegExpExecArray | null
    while ((om = optRe.exec(sm[2]!))) {
      const v = attr(om[1]!, "value") ?? om[2]!.trim()
      if (v) vals.push(v)
      if (hasAttr(om[1]!, "selected")) selected = v
    }
    if (vals.length) out[`select.${name}.options`] = vals.join(",")
    if (selected !== undefined) out[`select.${name}.selected`] = selected
  }

  // Textarea
  const textareaRe = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi
  let tm: RegExpExecArray | null
  while ((tm = textareaRe.exec(body)) && !full()) {
    const name = attr(tm[1]!, "name")
    if (!name) continue
    out[`textarea.${name}`] = tm[2]!.slice(0, 500)
    const ml = attr(tm[1]!, "maxlength")
    if (ml) out[`textarea.${name}.maxlength`] = ml
  }

  // Buttons with formaction/formmethod override
  const buttonRe = /<button\b([^>]*)>/gi
  let bm: RegExpExecArray | null
  let bi = 0
  while ((bm = buttonRe.exec(body)) && bi < MAX_FORMS && !full()) {
    const fa = attr(bm[1]!, "formaction")
    const fmethod = attr(bm[1]!, "formmethod")
    if (fa) out[`button.${bi}.formaction`] = fa
    if (fmethod) out[`button.${bi}.formmethod`] = fmethod
    if (fa || fmethod) bi++
  }

  // A.5 — Meta tags
  const metaRe = /<meta\b([^>]*)>/gi
  let mm: RegExpExecArray | null
  while ((mm = metaRe.exec(body)) && !full()) {
    const a = mm[1]!
    const name = (attr(a, "name") ?? attr(a, "http-equiv") ?? "").toLowerCase()
    const content = attr(a, "content")
    if (!content) continue
    if (name === "refresh") out["meta.refresh"] = content
    else if (META_NAMES[name]) out[`meta.${META_NAMES[name]}`] = content.slice(0, 500)
  }

  // A.6 — Base tag
  const baseM = /<base\b([^>]*)>/i.exec(body)
  if (baseM) {
    const href = attr(baseM[1]!, "href")
    if (href) out["base.href"] = href
  }

  // A.7 — Links with params
  const linkRe = /<a\b[^>]*\bhref\s*=\s*["']?([^"'\s>]+)/gi
  let lm: RegExpExecArray | null
  let li = 0
  let jsCount = 0
  let dataUri = false
  while ((lm = linkRe.exec(body))) {
    const href = lm[1]!
    if (/^javascript:/i.test(href)) { jsCount++; continue }
    if (/^data:/i.test(href)) { dataUri = true; continue }
    if (href.includes("?") && li < MAX_LINKS && !full()) {
      out[`link.${li}.href`] = href.slice(0, 500)
      li++
    }
  }
  if (jsCount) out["link.javascript"] = String(jsCount)
  if (dataUri) out["link.data"] = "true"

  // A.8 — Script references
  const scriptSrcRe = /<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi
  let ssm: RegExpExecArray | null
  let si = 0
  while ((ssm = scriptSrcRe.exec(body)) && si < MAX_SCRIPTS && !full()) {
    out[`script.${si}.src`] = ssm[1]!.slice(0, 500)
    si++
  }
  const inlineRe = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi
  let ism: RegExpExecArray | null
  let isi = 0
  while ((ism = inlineRe.exec(body)) && isi < MAX_INLINE_SCRIPTS && !full()) {
    const content = ism[1]!.trim()
    if (content) { out[`script.inline.${isi}`] = content.slice(0, 200); isi++ }
  }

  // A.9 — iframes
  const iframeRe = /<iframe\b([^>]*)>/gi
  let ifm: RegExpExecArray | null
  let ifi = 0
  while ((ifm = iframeRe.exec(body)) && ifi < MAX_IFRAMES && !full()) {
    const a = ifm[1]!
    const src = attr(a, "src")
    if (src) out[`iframe.${ifi}.src`] = src
    if (hasAttr(a, "srcdoc")) out[`iframe.${ifi}.srcdoc`] = "true"
    const sandbox = attr(a, "sandbox")
    if (sandbox !== undefined) out[`iframe.${ifi}.sandbox`] = sandbox || "empty"
    if (src || hasAttr(a, "srcdoc")) ifi++
  }

  // A.10 — HTML comments (WSTG-INFO-05 leakage)
  const commentRe = /<!--([\s\S]*?)-->/g
  let cm: RegExpExecArray | null
  let ci = 0
  while ((cm = commentRe.exec(body)) && ci < MAX_COMMENTS && !full()) {
    const text = cm[1]!.trim()
    if (!text || /^\[if\s/i.test(text)) continue
    out[`comment.${ci}`] = text.slice(0, 200)
    ci++
  }

  // A.11 — Security-relevant data attributes
  const dataRe = /\bdata-((?:api|url|endpoint|token|key|secret|user|id|config|auth)[a-z0-9_-]*)=["']([^"']+)/gi
  let dm: RegExpExecArray | null
  let di = 0
  while ((dm = dataRe.exec(body)) && di < MAX_DATA_ATTRS && !full()) {
    out[`data.${dm[1]}`] = dm[2]!.slice(0, 500)
    di++
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
  if (kind === "html") return { kind, fields: parseHtmlFields(body) }
  return { kind, fields: {} } // text / binary / empty → raw only
}

// Convenience over a message (headers + body) — used for both request and response.
export function messageBody(headers: Header[], body: string | undefined): BodyView {
  return analyzeBody(header(headers, "content-type") ?? "", body)
}
