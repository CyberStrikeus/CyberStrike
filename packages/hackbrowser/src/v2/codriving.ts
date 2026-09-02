// CyberStrike HackBrowser 2.0 — co-driving control (was receiver.ts, now retired
// as the capture receiver).
//
// Capture/session/credential moved to the extension → CyberStrike direct path, so
// this keeps ONLY the 2.0 co-driving pieces not yet re-homed on CyberStrike:
//   - deterministic page-state store (/observe, /page-state) — the get_page_state
//     substrate the AI pulls instead of re-reading the DOM
//   - AI action + guard enforcement + WS control (/action, /control) — the click
//     brick: a denied action (logout) never reaches the extension
// Kept as a working, testable reference until these move into CyberStrike's server.
//
// Run: bun run packages/hackbrowser/src/v2/codriving.ts   (listens on :4097)

import { annotateClickables, type Clickable, type ElementKind } from "./classify"
import { actionPolicy } from "./guard"

const PORT = Number(process.env.HB2_PORT ?? 4097)

// Deterministic page observation (§3.3) — what the extension extracts with no LLM.
// KEEP IN SYNC with content.js observePage() (cross-runtime wire contract).
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

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }
}

// --- WS control channel (backend → extension) -------------------------------
// The AI drives the browser by POSTing to /action; guard.ts is enforced HERE
// (a denied action never reaches the extension). Allowed commands are relayed
// over a single WebSocket to the extension, which executes them.
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

    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() })

    // Extension upgrades here to receive click/type/navigate commands.
    if (url.pathname === "/control") {
      if (server.upgrade(req)) return undefined
      return new Response("expected websocket", { status: 426, headers: corsHeaders() })
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, pages: pageState.size, extension: !!controlWs }, { headers: corsHeaders() })
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
      // Deterministic semantic tagging (LLM-free) — single source: classify.ts.
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
    // ?view=<kind> filters clickables to one semantic kind; each clickable also
    // carries its action policy (derived from kind via guard.ts).
    if (req.method === "GET" && url.pathname === "/page-state") {
      const want = url.searchParams.get("url")
      if (want) {
        const obs = pageState.get(want)
        if (!obs) return new Response("not found", { status: 404, headers: corsHeaders() })
        const withPolicy = (cs: Clickable[]) => cs.map((c) => ({ ...c, policy: actionPolicy(c.kind) }))
        const view = url.searchParams.get("view") as ElementKind | null
        const clickables = view ? obs.clickables.filter((c) => c.kind === view) : obs.clickables
        return Response.json({ ...obs, clickables: withPolicy(clickables) }, { headers: corsHeaders() })
      }
      return Response.json({ urls: [...pageState.keys()] }, { headers: corsHeaders() })
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

      // navigate: no element to guard (URL-level guard is future work).
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

console.log(`[hb2] co-driving control listening on http://127.0.0.1:${PORT}`)
console.log(`[hb2]   /control (WS)   — extension connects for click/type/navigate`)
console.log(`[hb2]   POST /observe   — page-state store`)
console.log(`[hb2]   GET  /page-state?url=&view=  — get_page_state substrate`)
console.log(`[hb2]   POST /action    — guard-enforced AI action`)
