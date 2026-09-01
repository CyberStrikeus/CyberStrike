// CyberStrike HackBrowser 2.0 — capture receiver.
//
// Where captured requests are sent. The extension (or any CaptureSource) POSTs
// enriched-HAR records here; this walking-skeleton receiver validates, classifies
// by resource_type, and logs a running tally. Forwarding into CyberStrike's ingest
// + persistence comes next — this first proves the extension → receiver flow.
//
// Run: bun run packages/hackbrowser/src/v2/receiver.ts   (listens on :4097)

import { annotateClickables, type Clickable, type ElementKind } from "./classify"
import { actionPolicy } from "./guard"

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
  clickables: Clickable[]
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
// Active CyberStrike session for the capture stream. Empty = "New Session": the
// next forward creates one and stores its id here. The popup can set this via
// /select-session to attach capture to an existing session (Firefox-ext pattern).
let session = ""

function authHeader(): Record<string, string> {
  if (!CYBERSTRIKE_PASSWORD) return {}
  return { Authorization: `Basic ${btoa(`cyberstrike:${CYBERSTRIKE_PASSWORD}`)}` }
}

// Proxy CyberStrike's session list to the popup (extension has no direct CS access
// in our model — receiver is the single hop). Returns [] on any failure so the
// popup degrades gracefully when CS is down.
async function listSessions(): Promise<Array<{ id: string; title?: string }>> {
  try {
    const res = await fetch(`${CYBERSTRIKE_URL}/session?limit=20&roots=true`, { headers: authHeader() })
    if (!res.ok) return []
    const data = (await res.json()) as unknown
    if (!Array.isArray(data)) return []
    return data
      .filter((s): s is { id: string; title?: string } => !!s && typeof (s as { id?: unknown }).id === "string")
      .map((s) => ({ id: s.id, title: s.title }))
  } catch {
    return []
  }
}

// Credential proxy (Firefox-ext pattern, profile-local per §3.1): each profile's
// extension registers ONE credential label and tags its captures with the id.
async function listCredentials(sid: string): Promise<Array<{ id: string; label: string }>> {
  try {
    const res = await fetch(`${CYBERSTRIKE_URL}/session/${sid}/web/credentials`, { headers: authHeader() })
    if (!res.ok) return []
    const data = (await res.json()) as unknown
    if (!Array.isArray(data)) return []
    return data
      .filter((c): c is { id: string; label: string } => !!c && typeof (c as { id?: unknown }).id === "string")
      .map((c) => ({ id: c.id, label: String((c as { label?: unknown }).label ?? "") }))
  } catch {
    return []
  }
}

// Register a credential label; returns its id, or null on failure (CS down / bad resp).
async function registerCredential(sid: string, label: string): Promise<string | null> {
  try {
    const res = await fetch(`${CYBERSTRIKE_URL}/session/${sid}/web/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ label }),
    })
    if (!res.ok) return null
    const d = (await res.json()) as { id?: unknown }
    return typeof d.id === "string" ? d.id : null
  } catch {
    return null
  }
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

// --- WS control channel (backend → extension) -------------------------------
// The AI drives the browser by POSTing to /action; guard.ts is enforced HERE
// (a denied action never reaches the extension). Allowed commands are relayed
// over a single WebSocket to the extension, which executes them. One control
// socket for now (single tab); multi-tab routing is future work.

type ControlWs = { send: (data: string) => void }
let controlWs: ControlWs | null = null
let cmdSeq = 0
const pendingCmd = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()

function sendCommand(cmd: Record<string, unknown>, timeoutMs = 5000): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    if (!controlWs) {
      reject(new Error("no-extension"))
      return
    }
    const id = `cmd${++cmdSeq}`
    const timer = setTimeout(() => {
      pendingCmd.delete(id)
      reject(new Error("timeout"))
    }, timeoutMs)
    pendingCmd.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
    controlWs.send(JSON.stringify({ id, ...cmd }))
  })
}

function onCommandAck(raw: string) {
  let msg: { id?: string; ok?: boolean; error?: string }
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }
  if (!msg.id) return
  const p = pendingCmd.get(msg.id)
  if (!p) return
  clearTimeout(p.timer)
  pendingCmd.delete(msg.id)
  p.resolve({ ok: !!msg.ok, error: msg.error })
}

Bun.serve({
  port: PORT,
  websocket: {
    open(ws) {
      controlWs = ws
      console.log(`[hb2] control channel: extension connected`)
    },
    message(_ws, message) {
      onCommandAck(typeof message === "string" ? message : message.toString())
    },
    close() {
      controlWs = null
      console.log(`[hb2] control channel: extension disconnected`)
    },
  },
  async fetch(req, server) {
    const url = new URL(req.url)

    // Extension upgrades here to receive click/type/navigate commands.
    if (url.pathname === "/control") {
      if (server.upgrade(req)) return undefined
      return new Response("expected websocket", { status: 426, headers: corsHeaders() })
    }

    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() })

    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, tally, pages: pageState.size, session: session || null }, { headers: corsHeaders() })
    }

    // Session visibility/selection (Firefox-ext pattern): popup lists CS sessions
    // and picks which one capture attaches to.
    if (req.method === "GET" && url.pathname === "/sessions") {
      const sessions = await listSessions()
      return Response.json({ sessions, active: session || null }, { headers: corsHeaders() })
    }
    if (req.method === "POST" && url.pathname === "/select-session") {
      let body: { sessionID?: string }
      try {
        body = (await req.json()) as typeof body
      } catch {
        return Response.json({ ok: false, error: "invalid json" }, { status: 400, headers: corsHeaders() })
      }
      // "" (New Session) → next forward creates a fresh session; a real id attaches to it.
      session = typeof body.sessionID === "string" ? body.sessionID : ""
      console.log(`[hb2] session selected: ${session || "(new)"}`)
      return Response.json({ ok: true, active: session || null }, { headers: corsHeaders() })
    }

    // Credentials for the active session (profile-local identity, §3.1).
    if (req.method === "GET" && url.pathname === "/credentials") {
      if (!session) return Response.json({ credentials: [] }, { headers: corsHeaders() })
      return Response.json({ credentials: await listCredentials(session) }, { headers: corsHeaders() })
    }
    if (req.method === "POST" && url.pathname === "/register-credential") {
      if (!session) {
        return Response.json(
          { ok: false, error: "select or start a session first" },
          { status: 409, headers: corsHeaders() },
        )
      }
      let body: { label?: string }
      try {
        body = (await req.json()) as typeof body
      } catch {
        return Response.json({ ok: false, error: "invalid json" }, { status: 400, headers: corsHeaders() })
      }
      const label = (body.label ?? "").trim()
      if (!label) return Response.json({ ok: false, error: "label required" }, { status: 400, headers: corsHeaders() })
      const id = await registerCredential(session, label)
      if (!id) return Response.json({ ok: false, error: "register failed (CS down?)" }, { status: 502, headers: corsHeaders() })
      console.log(`[hb2] credential registered: ${label} → ${id}`)
      return Response.json({ ok: true, id, label }, { headers: corsHeaders() })
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
      // Deterministic semantic tagging (LLM-free) — makes the observation AI-usable
      // and feeds the destructive/logout guard. Single source of truth: classify.ts.
      const counts = annotateClickables(obs.clickables)
      pageState.set(obs.url, obs)
      const risky = counts.destructive + counts.logout
      console.log(
        `[hb2] observe ${(obs.driver || "ai").padEnd(5)} ${obs.clickables.length}c ${obs.forms.length}f ${obs.links.length}l` +
          ` [${counts.destructive}D ${counts.logout}Lo ${counts.auth}Au ${counts.mutating}M ${counts.query}Q]` +
          (risky > 0 ? " ⚠" : "") +
          `  ${obs.url}`,
      )
      return Response.json({ ok: true, kinds: counts }, { headers: corsHeaders() })
    }

    // get_page_state substrate: return the last observation for a URL (or all).
    // ?view=<kind> filters clickables to one semantic kind (destructive/logout/
    // auth/mutating/query/nav/other) — the sub-view the AI pulls instead of the
    // whole flat list.
    if (req.method === "GET" && url.pathname === "/page-state") {
      const want = url.searchParams.get("url")
      if (want) {
        const obs = pageState.get(want)
        if (!obs) return new Response("not found", { status: 404, headers: corsHeaders() })
        // Attach the action policy per clickable (derived from kind, not stored —
        // guard.ts is the single source). The AI sees deny/confirm/allow alongside
        // each element; the click brick will later enforce the same rule.
        const withPolicy = (cs: Clickable[]) => cs.map((c) => ({ ...c, policy: actionPolicy(c.kind) }))
        const view = url.searchParams.get("view") as ElementKind | null
        const clickables = view ? obs.clickables.filter((c) => c.kind === view) : obs.clickables
        return Response.json({ ...obs, clickables: withPolicy(clickables) }, { headers: corsHeaders() })
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

    // AI drives the browser here. guard.ts is ENFORCED before relaying: a denied
    // action never reaches the extension. This is where "the AI cannot click
    // logout" actually happens (risk #1 / issue #1).
    if (req.method === "POST" && url.pathname === "/action") {
      let body: { op?: string; url?: string; elementId?: string; text?: string }
      try {
        body = (await req.json()) as typeof body
      } catch {
        return Response.json({ ok: false, error: "invalid json" }, { status: 400, headers: corsHeaders() })
      }
      if (!controlWs) {
        return Response.json({ ok: false, error: "no extension connected" }, { status: 503, headers: corsHeaders() })
      }
      const op = body.op

      // navigate: no element to guard (URL-level guard is future work — noted).
      if (op === "navigate") {
        if (!body.url) return Response.json({ ok: false, error: "url required" }, { status: 400, headers: corsHeaders() })
        try {
          const ack = await sendCommand({ op: "navigate", url: body.url })
          return Response.json(ack, { status: ack.ok ? 200 : 502, headers: corsHeaders() })
        } catch (e) {
          const to = e instanceof Error && e.message === "timeout"
          return Response.json({ ok: false, error: String(e) }, { status: to ? 504 : 502, headers: corsHeaders() })
        }
      }

      if (op !== "click" && op !== "type") {
        return Response.json({ ok: false, error: `unknown op: ${op}` }, { status: 400, headers: corsHeaders() })
      }
      // click/type target an element — resolve its kind from page-state and guard it.
      if (!body.url || !body.elementId) {
        return Response.json({ ok: false, error: "url and elementId required" }, { status: 400, headers: corsHeaders() })
      }
      const obs = pageState.get(body.url)
      if (!obs) return Response.json({ ok: false, error: "no page-state for url" }, { status: 404, headers: corsHeaders() })
      const el = obs.clickables.find((c) => c.id === body.elementId)
      if (!el) return Response.json({ ok: false, error: "unknown element" }, { status: 404, headers: corsHeaders() })

      const policy = actionPolicy(el.kind)
      if (policy === "deny") {
        return Response.json(
          { ok: false, policy, kind: el.kind, label: el.label, error: "denied by guard" },
          { status: 403, headers: corsHeaders() },
        )
      }
      if (policy === "confirm") {
        return Response.json(
          { ok: false, policy, kind: el.kind, label: el.label, error: "human confirmation required" },
          { status: 409, headers: corsHeaders() },
        )
      }
      // allow → relay to the extension.
      try {
        const ack = await sendCommand({ op, elementId: body.elementId, text: body.text })
        return Response.json({ ...ack, policy }, { status: ack.ok ? 200 : 502, headers: corsHeaders() })
      } catch (e) {
        const to = e instanceof Error && e.message === "timeout"
        return Response.json({ ok: false, error: String(e) }, { status: to ? 504 : 502, headers: corsHeaders() })
      }
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
