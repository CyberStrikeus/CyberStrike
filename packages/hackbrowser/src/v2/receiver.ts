// CyberStrike HackBrowser 2.0 — capture receiver.
//
// Where captured requests are sent. The extension (or any CaptureSource) POSTs
// enriched-HAR records here; this walking-skeleton receiver validates, classifies
// by resource_type, and logs a running tally. Forwarding into CyberStrike's ingest
// + persistence comes next — this first proves the extension → receiver flow.
//
// Run: bun run packages/hackbrowser/src/v2/receiver.ts   (listens on :4097)

const PORT = Number(process.env.HB2_PORT ?? 4097)

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

const tally = { total: 0, api: 0, js: 0, html: 0, static: 0, realtime: 0, other: 0, forwarded: 0, failed: 0 }

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
      return Response.json({ ok: true, tally }, { headers: corsHeaders() })
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

      // Route by class: dynamic/API + HTML go to CyberStrike ingest (LLM path);
      // static/JS/realtime are held back for out-of-band mining (§4.3).
      const forwardable = cls === "api" || cls === "html"
      let forwarded = false
      if (forwardable) forwarded = await forwardToCyberStrike(record)

      const bodyKB = record.responseBody ? (record.responseBody.length / 1024).toFixed(1) : "-"
      const mark = forwardable ? (forwarded ? "→CS" : "→CS!") : "hold"
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
