// XSS proof-of-concept builder (#22 follow-up). Turns a CONFIRMED-reflecting payload into a concrete,
// hand-off-ready PoC artifact — so a reflected/stored XSS finding ships with something a reviewer opens
// or runs to see the popup, WITHOUT this tool driving a browser itself. Covers every injection location
// inject_probe reaches (query/path/form/json/header/cookie), each rendered as the RIGHT artifact:
//   - GET query/path            → a clickable URL (open it → the payload reflects → alert fires)
//   - POST form-urlencoded      → a self-submitting HTML page (open it → auto-POST → reflect → alert)
//   - json/header/cookie/multipart → a curl PoC (not clickable; the reproducer that carries the payload)
// Plus domPocUrl() for DOM-based XSS (payload in the URL fragment, executes purely client-side) and
// cspNote() so a PoC that a CSP may block at runtime is flagged rather than overclaimed.
//
// Fidelity: the request is built with the SAME applyPayload() the probe used to confirm reflection, so
// the PoC reproduces exactly what fired. Payload values are the confirmed weapon (e.g. alert("XSS")).
import type { ResolvedRequest, InjPoint, Location } from "./types"
import { applyPayload } from "./mutate"

export interface XssPoc {
  kind: "url" | "form" | "curl" // url = clickable GET; form = self-submitting HTML; curl = command reproducer
  clickable: boolean // true only for a GET URL a reviewer can paste into a browser
  location: Location
  method: string
  poc_url?: string // present for kind "url"
  poc_html?: string // present for kind "form" — a complete self-submitting page
  poc_curl: string // ALWAYS present — the exact request as a curl command
  note?: string
}

// Escape a value for an HTML double-quoted attribute (used in the auto-submit form's hidden inputs).
function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}
// Wrap a value for a single-quoted shell arg (curl), escaping embedded single quotes.
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function curlOf(method: string, url: string, body: string, headers: Record<string, string>): string {
  const flags = Object.entries(headers)
    .filter(([k]) => !["host", "content-length"].includes(k.toLowerCase()))
    .map(([k, v]) => `-H ${shq(`${k}: ${v}`)}`)
    .join(" ")
  const head = method === "GET" ? "curl -sk" : `curl -sk -X ${method}`
  const data = method !== "GET" && body ? ` --data ${shq(body)}` : ""
  return `${head}${flags ? " " + flags : ""}${data} ${shq(url)}`
}

// Build the PoC for a confirmed reflected-XSS payload at an injection point.
export function buildXssPoc(r: ResolvedRequest, point: InjPoint, payload: string): XssPoc {
  const m = applyPayload(r, point, payload) // exact mutated request {url, body, headers}
  const method = (r.method || "GET").toUpperCase()
  const curl = curlOf(method, m.url, m.body, m.headers)
  const base = { location: point.location, method, poc_curl: curl }

  // Clickable GET URL — opening it reproduces the reflection with no further action.
  if (method === "GET" && (point.location === "query" || point.location === "path")) {
    return { ...base, kind: "url", clickable: true, poc_url: m.url }
  }

  // POST form-urlencoded — a self-submitting page fires it on open.
  if (method !== "GET" && point.location === "form_field" && !r.contentType.includes("multipart/form-data")) {
    const fields = [...new URLSearchParams(m.body).entries()]
      .map(([k, v]) => `    <input type="hidden" name="${escAttr(k)}" value="${escAttr(v)}">`)
      .join("\n")
    const poc_html =
      `<!doctype html>\n<!-- Open in a browser: auto-submits the POST that reflects the XSS payload. -->\n` +
      `<form action="${escAttr(m.url)}" method="POST">\n${fields}\n  </form>\n` +
      `<script>document.forms[0].submit()</script>`
    return { ...base, kind: "form", clickable: false, poc_html, note: "POST reflected XSS — open the HTML PoC in a browser (it auto-submits)." }
  }

  // json body / header / cookie / multipart form — a plain link can't carry these; curl is the reproducer.
  const why: Record<string, string> = {
    json_body: "JSON body injection — not a clickable link; reproduce with curl (or a fetch() PoC if same-origin).",
    header: "request-header injection — not reachable from a plain link; reproduce with curl.",
    cookie: "cookie injection — set the cookie then load the page; reproduce with curl.",
    form_field: "multipart form injection — reproduce with curl.",
  }
  return { ...base, kind: "curl", clickable: false, note: why[point.location] ?? `${point.location} injection — reproduce with curl.` }
}

// DOM-based XSS PoC: the payload lives in the URL fragment and executes entirely client-side (no server
// round-trip), for a source→sink flow like `location.hash → innerHTML`. Kept RAW in the fragment (most
// hash-reading sinks consume it verbatim); a sink that URL-decodes may need an encoded variant — the
// caller notes that this is sink-specific.
export function domPocUrl(pageUrl: string, payload: string): string {
  const hash = pageUrl.indexOf("#")
  const base = hash === -1 ? pageUrl : pageUrl.slice(0, hash)
  return `${base}#${payload}`
}

// Flag when a Content-Security-Policy on the reflecting response may block the PoC at runtime, so a
// reflected-un-encoded lead is not overclaimed as guaranteed execution.
export function cspNote(csp?: string): string | undefined {
  if (!csp) return undefined
  const hasScriptSrc = /(?:script-src|default-src)/i.test(csp)
  const allowsInline = /'unsafe-inline'/i.test(csp)
  return hasScriptSrc && !allowsInline
    ? "⚠️ CSP present (script-src/default-src without 'unsafe-inline') — inline/handler execution may be blocked; verify the PoC in a browser."
    : "CSP present — verify the PoC is not blocked at runtime."
}
