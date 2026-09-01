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

const tally = { total: 0, api: 0, js: 0, html: 0, static: 0, realtime: 0, other: 0 }

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

      const bodyKB = record.responseBody ? (record.responseBody.length / 1024).toFixed(1) : "-"
      console.log(
        `[hb2] ${cls.padEnd(8)} ${record.method.padEnd(6)} ${record.status} ${record.resourceType.padEnd(10)} body=${bodyKB}KB  ${record.url}`,
      )

      return Response.json({ ok: true }, { headers: corsHeaders() })
    }

    return new Response("not found", { status: 404, headers: corsHeaders() })
  },
})

console.log(`[hb2] capture receiver listening on http://127.0.0.1:${PORT}`)
console.log(`[hb2]   POST /capture   — extension sends enriched-HAR records here`)
console.log(`[hb2]   GET  /health    — running tally`)
