// CyberStrike HackBrowser 2.0 — capture receiver.
//
// Where captured requests are sent. The extension (or any CaptureSource) POSTs
// enriched-HAR records here; this walking-skeleton receiver validates, classifies
// by resource_type, and logs a running tally. Forwarding into CyberStrike's ingest
// + persistence comes next — this first proves the extension → receiver flow.
//
// Run: bun run packages/hackbrowser/src/v2/receiver.ts   (listens on :4097)

const PORT = Number(process.env.HB2_PORT ?? 4097)

// --- Scope enforcement (risk #2) --------------------------------------------
// Capture records everything (3rd-party analytics/CDN/ads included), but ONLY
// in-scope hosts are forwarded to CyberStrike for analysis — out-of-scope hosts
// must never reach the analysis/replay path (authorization boundary). Set
// HB2_SCOPE to a comma-separated list of hosts/wildcards, e.g.
//   HB2_SCOPE="app.example.com,*.api.example.com"
// A bare host matches itself and its subdomains; "*.x" matches subdomains only.

const SCOPE_PATTERNS = (process.env.HB2_SCOPE ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

function inScope(host: string): boolean {
  if (SCOPE_PATTERNS.length === 0) return true // no scope set → permissive (dev), warned at startup
  const h = host.toLowerCase()
  for (const p of SCOPE_PATTERNS) {
    if (p.startsWith("*.")) {
      const suffix = p.slice(1) // ".example.com"
      if (h.endsWith(suffix)) return true
      continue
    }
    if (h === p || h.endsWith("." + p)) return true
  }
  return false
}

function hostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).host
  } catch {
    return ""
  }
}

// Enriched-HAR record as emitted by a CaptureSource (§2.1.1). Kept minimal and
// permissive — this is the contract the extension and the future proxy/Playwright
// sources all speak.
interface CaptureRecord {
  url: string
  method: string
  status: number
  resourceType: string
  bodyClass: "static" | "dynamic"
  requestHeaders: Record<string, string>
  requestBody: string | null
  responseHeaders: Record<string, string>
  responseBody: string | null
  responseSize: number
  contentType: string
  scheme: "http" | "https"
  timestamp: number
  driver: "ai" | "human"
  credentialId: string | null
  triggerElement: string | null
  elementRoles: string[] | null
  pageUrl: string | null
  pageVisitedBy: string[] | null
  isPrefetch: boolean
}

// Coarse traffic class for routing (§4.3). Static assets are inventory/mining
// fodder; dynamic requests are the API/IDOR substrate.
function trafficClass(type: string): "api" | "js" | "html" | "static" | "realtime" | "other" {
  if (type === "xhr" || type === "fetch") return "api"
  if (type === "script") return "js"
  if (type === "document") return "html"
  if (type === "image" || type === "font" || type === "stylesheet" || type === "media") return "static"
  if (type === "websocket" || type === "eventsource") return "realtime"
  return "other"
}

// Deterministic page observation (§3.3) — what the extension extracts with no LLM.
interface PageObservation {
  url: string
  title: string
  clickables: { id: string; tag: string; role: string; label: string; href: string }[]
  forms: { action: string; method: string; fields: { name: string; type: string; required: boolean }[] }[]
  links: string[]
  driver?: "ai" | "human"
}

// url → latest observation. get_page_state reads from here.
const pageState = new Map<string, PageObservation>()

const tally = { total: 0, api: 0, js: 0, html: 0, static: 0, realtime: 0, other: 0, forwarded: 0, failed: 0, outOfScope: 0 }

// --- CyberStrike forwarding -------------------------------------------------
// Dynamic/API + HTML records are forwarded to CyberStrike's existing ingest
// endpoint (§ "same endpoint"). Static/JS are held back (mining runs later,
// out of band — they never enter the LLM ingest path). One CyberStrike session
// is reused for the whole capture stream: the first forward creates it, the
// returned sessionID rides along on every subsequent record.

const CYBERSTRIKE_URL = (process.env.CYBERSTRIKE_URL ?? "http://127.0.0.1:4096").replace(/\/$/, "")
const CYBERSTRIKE_PASSWORD = process.env.CYBERSTRIKE_SERVER_PASSWORD ?? ""
let session = ""

function authHeader(): Record<string, string> {
  if (!CYBERSTRIKE_PASSWORD) return {}
  return { Authorization: `Basic ${btoa(`cyberstrike:${CYBERSTRIKE_PASSWORD}`)}` }
}

// Rebuild a raw HTTP request string from the record — the format /session/ingest
// expects in its `text` field (same shape the 1.x hackbrowser / Firefox ext send).
function toRawHttp(rec: CaptureRecord): string {
  let path = rec.url
  let host = ""
  try {
    const u = new URL(rec.url)
    path = u.pathname + u.search
    host = u.host
  } catch {
    // leave url as-is if unparseable
  }
  const lines = [`${rec.method} ${path} HTTP/1.1`]
  if (host && !rec.requestHeaders["host"] && !rec.requestHeaders["Host"]) lines.push(`Host: ${host}`)
  for (const name of Object.keys(rec.requestHeaders)) lines.push(`${name}: ${rec.requestHeaders[name]}`)
  const head = lines.join("\r\n")
  return rec.requestBody ? `${head}\r\n\r\n${rec.requestBody}` : `${head}\r\n\r\n`
}

async function forwardToCyberStrike(rec: CaptureRecord): Promise<boolean> {
  const payload: Record<string, unknown> = {
    text: toRawHttp(rec),
    scheme: rec.scheme,
  }
  if (session) payload.sessionID = session
  if (rec.credentialId) payload.credential_id = rec.credentialId
  if (rec.triggerElement) payload.trigger_element = rec.triggerElement
  if (rec.elementRoles) payload.element_roles = rec.elementRoles
  if (rec.pageUrl) payload.page_url = rec.pageUrl
  if (rec.pageVisitedBy) payload.page_visited_by = rec.pageVisitedBy
  if (rec.status > 0) {
    payload.response = { status: rec.status, headers: rec.responseHeaders, body: rec.responseBody ?? "" }
  }

  try {
    const res = await fetch(`${CYBERSTRIKE_URL}/session/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      tally.failed++
      console.warn(`[hb2] ingest ${res.status}: ${await res.text().catch(() => "")}`)
      return false
    }
    const data = (await res.json()) as { sessionID?: string }
    if (data.sessionID && !session) {
      session = data.sessionID
      console.log(`[hb2] cyberstrike session: ${session}`)
    }
    tally.forwarded++
    return true
  } catch (e) {
    tally.failed++
    console.warn(`[hb2] ingest network error: ${String(e)}`)
    return false
  }
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() })

    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, tally, pages: pageState.size }, { headers: corsHeaders() })
    }

    // Deterministic page observation (§3.3): the state the AI pulls via
    // get_page_state instead of re-reading the DOM. Keyed by URL, last-write-wins.
    if (req.method === "POST" && url.pathname === "/observe") {
      let obs: PageObservation
      try {
        obs = (await req.json()) as PageObservation
      } catch {
        return new Response("invalid json", { status: 400, headers: corsHeaders() })
      }
      pageState.set(obs.url, obs)
      console.log(
        `[hb2] observe ${(obs.driver || "ai").padEnd(5)} ${obs.clickables.length}c ${obs.forms.length}f ${obs.links.length}l  ${obs.url}`,
      )
      return Response.json({ ok: true }, { headers: corsHeaders() })
    }

    // get_page_state substrate: return the last observation for a URL (or all).
    if (req.method === "GET" && url.pathname === "/page-state") {
      const want = url.searchParams.get("url")
      if (want) {
        const obs = pageState.get(want)
        if (!obs) return new Response("not found", { status: 404, headers: corsHeaders() })
        return Response.json(obs, { headers: corsHeaders() })
      }
      return Response.json({ urls: [...pageState.keys()] }, { headers: corsHeaders() })
    }

    if (req.method === "POST" && url.pathname === "/capture") {
      let record: CaptureRecord
      try {
        record = (await req.json()) as CaptureRecord
      } catch {
        return new Response("invalid json", { status: 400, headers: corsHeaders() })
      }

      const cls = trafficClass(record.resourceType)
      tally.total++
      tally[cls === "api" || cls === "js" || cls === "html" || cls === "static" || cls === "realtime" ? cls : "other"]++

      // Scope gate (risk #2): out-of-scope hosts are captured/tallied but NEVER
      // forwarded to analysis. Route in-scope dynamic/API + HTML to CyberStrike
      // ingest; static/JS/realtime held for out-of-band mining (§4.3).
      const host = hostOf(record.url)
      const scoped = inScope(host)
      if (!scoped) tally.outOfScope++
      const forwardable = (cls === "api" || cls === "html") && scoped
      let forwarded = false
      if (forwardable) forwarded = await forwardToCyberStrike(record)

      const bodyKB = record.responseBody ? (record.responseBody.length / 1024).toFixed(1) : "-"
      const mark = !scoped ? "oos" : forwardable ? (forwarded ? "→CS" : "→CS!") : "hold"
      const drv = record.driver === "human" ? "HUMAN" : "ai"
      console.log(
        `[hb2] ${cls.padEnd(8)} ${mark.padEnd(5)} ${drv.padEnd(5)} ${record.method.padEnd(6)} ${record.status} ${record.resourceType.padEnd(10)} body=${bodyKB}KB  ${record.url}`,
      )

      return Response.json({ ok: true, forwarded }, { headers: corsHeaders() })
    }

    return new Response("not found", { status: 404, headers: corsHeaders() })
  },
})

console.log(`[hb2] capture receiver listening on http://127.0.0.1:${PORT}`)
console.log(`[hb2]   POST /capture   — extension sends enriched-HAR records here`)
console.log(`[hb2]   GET  /health    — running tally`)
if (SCOPE_PATTERNS.length === 0) {
  console.warn(`[hb2]   ⚠ HB2_SCOPE not set — forwarding ALL hosts (dev only). Set it before real testing.`)
} else {
  console.log(`[hb2]   scope: ${SCOPE_PATTERNS.join(", ")} — out-of-scope hosts captured but NOT forwarded`)
}
