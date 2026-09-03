// CyberStrike HackBrowser 2.0 — background service worker.
//
// NO chrome.debugger (so no "…started debugging this browser" bar). Capture is:
//   - dynamic request/response bodies (xhr/fetch) via the MAIN-world fetch/XHR
//     patch (capture-patch.js), relayed here as `captured` messages → ingest.
//   - per-request metadata (all resource types) via chrome.webRequest → the panel
//     breakdown only (no bodies).
// Static asset bodies aren't captured (metadata only; pulled later via http_replay).

// Extension talks DIRECTLY to CyberStrike's existing routes (host_permissions lets
// it bypass CORS, same as the 1.x worker / Firefox ext). No intermediate receiver.
const DEFAULT_CS = "http://127.0.0.1:4096"

function csUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get("cyberstrike", (out) => {
      resolve(out && out.cyberstrike ? out.cyberstrike : DEFAULT_CS)
    })
  })
}

// The active session id, falling back to storage when the in-memory value hasn't caught
// up yet. A spawned profile writes the session from its #__cs_sess hash to storage, and
// our activeSession only syncs via storage.onChanged — so a capture firing in that gap
// would otherwise ingest with no session and create a WRONG new one. Reading storage
// here makes the hash-provided session authoritative everywhere (ingest, observe, etc.).
async function currentSession() {
  if (activeSession) return activeSession
  const s = await new Promise((r) => chrome.storage.local.get("session", (o) => r(o && o.session)))
  if (s) activeSession = s
  return activeSession
}

// Same idea for the profile's credential: a spawned role browser auto-attaches and
// captures immediately, before storage.onChanged has synced activeCredential — so the
// first requests would go untagged. Read storage to tag them with the right role at once.
async function currentCredential() {
  if (activeCredential) return activeCredential
  const c = await new Promise((r) => chrome.storage.local.get("credential", (o) => r(o && o.credential)))
  if (c && c.id) activeCredential = c
  return activeCredential
}

// Register a credential label with CyberStrike and make it this profile's identity.
// Shared by the panel "Set" button, spawned role browsers, and Browse-anonymous — the
// last one registers a real "anonymous" role so it is a first-class identity in the TUI
// and the access-control comparison, not an untagged NULL that never surfaces.
async function registerCredential(label) {
  const sid = await currentSession()
  if (!sid) throw new Error("no session selected")
  const base = await csUrl()
  const res = await fetch(`${base}/session/${sid}/web/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  })
  const d = await res.json().catch(() => ({}))
  if (!d || !d.id) throw new Error("register failed")
  activeCredential = { id: d.id, label: d.label || label }
  await chrome.storage.local.set({ credential: activeCredential })
  return activeCredential
}

// Return the active session, creating one in CyberStrike if none is set yet. This is
// the chicken-egg fix: the panel's Anonymous / Add-credential actions need a session
// BEFORE any capture, so we create it up front (POST /session) instead of waiting for
// the first ingest to auto-create it. Idempotent — reuses an existing activeSession.
// A single in-flight promise coalesces concurrent callers (rapid Anonymous +
// Add-credential clicks) so they share ONE session instead of racing two into being.
let sessionCreating = null
async function ensureSession() {
  const existing = await currentSession()
  if (existing) return existing
  if (sessionCreating) return sessionCreating
  sessionCreating = (async () => {
    const base = await csUrl()
    const res = await fetch(`${base}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
    if (!res.ok) throw new Error(`session create failed (${res.status})`)
    const d = await res.json().catch(() => ({}))
    if (!d || typeof d.id !== "string") throw new Error("session create: no id in response")
    activeSession = d.id
    await chrome.storage.local.set({ session: activeSession })
    return activeSession
  })()
  try {
    return await sessionCreating
  } finally {
    sessionCreating = null
  }
}

// Rebuild a raw HTTP request string — the format /session/ingest expects in `text`
// (same shape the 1.x hackbrowser worker sent). Scope is enforced by the crawl
// target; here we forward every in-flight dynamic request.
function toRawHttp(rec) {
  let path = rec.url
  let host = ""
  try {
    const u = new URL(rec.url)
    path = u.pathname + u.search
    host = u.host
  } catch {
    // leave url as-is
  }
  const lines = [`${rec.method} ${path} HTTP/1.1`]
  if (host && !rec.requestHeaders["host"] && !rec.requestHeaders["Host"]) lines.push(`Host: ${host}`)
  for (const name of Object.keys(rec.requestHeaders)) lines.push(`${name}: ${rec.requestHeaders[name]}`)
  const head = lines.join("\r\n")
  return rec.requestBody ? `${head}\r\n\r\n${rec.requestBody}` : `${head}\r\n\r\n`
}

// Param names actually present in a request (query string + urlencoded/JSON body).
// Used to derive ui_context.hiddenParams = request params NOT surfaced in the UI —
// the mass-assignment / hidden-field signal CyberStrike reads.
function paramNames(rec) {
  const names = new Set()
  try {
    for (const k of new URL(rec.url).searchParams.keys()) names.add(k)
  } catch {}
  const body = rec.requestBody
  if (typeof body === "string" && body.length) {
    const trimmed = body.trim()
    if (trimmed.startsWith("{")) {
      try {
        const o = JSON.parse(trimmed)
        if (o && typeof o === "object") for (const k of Object.keys(o)) names.add(k)
      } catch {}
    } else {
      try {
        for (const k of new URLSearchParams(body).keys()) names.add(k)
      } catch {}
    }
  }
  return names
}

// tabId → true, for tabs we've attached to
const attached = new Map()
// tabId → "ai" | "human" — co-driving state; set from the panel handover toggle.
// Tags each forwarded record so human-driven captures are distinguishable (§6.4).
const driverByTab = new Map()
// tabId → capture breakdown by class (shown in the panel). Computed locally from
// each request's resource_type — no backend needed.
const statsByTab = new Map()

function emptyStats() {
  return { total: 0, api: 0, js: 0, html: 0, static: 0, realtime: 0, other: 0 }
}

// The panel's status shape — one source, so panel-status and set-driver can't drift.
function panelStatus(tabId) {
  const ok = tabId !== undefined
  return {
    attached: ok && attached.has(tabId),
    stats: (ok && statsByTab.get(tabId)) || emptyStats(),
    driver: (ok && driverByTab.get(tabId)) || "ai",
  }
}

function classOf(resourceType) {
  if (resourceType === "xhr" || resourceType === "fetch") return "api"
  if (resourceType === "script") return "js"
  if (resourceType === "document") return "html"
  if (resourceType === "image" || resourceType === "font" || resourceType === "stylesheet" || resourceType === "media") return "static"
  if (resourceType === "websocket" || resourceType === "eventsource") return "realtime"
  return "other"
}
// This profile's credential (§3.1: one identity per profile). Set from the popup,
// persisted in profile-local storage, stamped onto every captured record.
let activeCredential = null
let activeSession = ""
chrome.storage.local.get(["credential", "session"], (o) => {
  if (o && o.credential) activeCredential = o.credential
  if (o && o.session) activeSession = o.session
})
chrome.storage.onChanged.addListener((changes) => {
  if (changes.credential) activeCredential = changes.credential.newValue || null
  if (changes.session) activeSession = changes.session.newValue || ""
})

// NOTE: the WS control channel (AI → extension click/type/navigate) lived on the
// receiver, which we removed. Co-driving/click-brick will return once that path is
// re-homed on CyberStrike; the content-script `perform` handler stays ready. See
// git history for the receiver-based version.

// Attach is now just a capture flag — NO chrome.debugger, so no "…started debugging
// this browser" bar. Bodies come from the MAIN-world fetch/XHR patch; metadata from
// webRequest. Both check attached.has(tabId).
function attach(tabId) {
  attached.set(tabId, true)
}
function detach(tabId) {
  attached.delete(tabId)
}

// Ingest a dynamic request captured by the MAIN-world fetch/XHR patch. fetch/XHR
// are always dynamic → always ingested. Session is reused: first ingest creates one.
async function forward(rec) {
  const base = await csUrl()
  let scheme = "http"
  try {
    scheme = new URL(rec.url).protocol === "https:" ? "https" : "http"
  } catch {}
  const raw = toRawHttp({
    url: rec.url,
    method: rec.method || "GET",
    requestHeaders: rec.requestHeaders || {},
    requestBody: rec.requestBody || null,
  })
  // Builds an IngestPayload — keep the field set in sync with types.ts IngestPayload
  // (the single wire contract; this JS runtime can't import the TS type).
  const payload = { text: raw, scheme }
  const sid = await currentSession()
  if (sid) payload.sessionID = sid
  const cred = await currentCredential()
  if (cred) payload.credential_id = cred.id
  if (rec.status > 0) {
    payload.response = { status: rec.status, headers: rec.responseHeaders || {}, body: rec.responseBody || "" }
  }
  // Faz A enrichment (extension-local): which UI element/page drove this request.
  // element_roles / page_visited_by are Faz B (server-side, cross-credential).
  if (rec.page_url) payload.page_url = rec.page_url
  if (rec.trigger_element) payload.trigger_element = rec.trigger_element
  if (rec.ui_context) {
    const fieldNames = new Set((rec.ui_context.fields || []).map((f) => f.name).filter(Boolean))
    const hiddenParams = [...paramNames(rec)].filter((n) => n && !fieldNames.has(n))
    payload.ui_context = Object.assign({}, rec.ui_context, { hiddenParams })
  }
  try {
    const res = await fetch(`${base}/session/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      const d = await res.json().catch(() => ({}))
      if (d && d.sessionID && !sid) {
        activeSession = d.sessionID
        chrome.storage.local.set({ session: activeSession })
      }
    }
  } catch (e) {
    console.warn("[hackbrowser] ingest failed", e)
  }
}

// webRequest resource type → our resource_type (for the panel breakdown).
function webReqType(t) {
  if (t === "xmlhttprequest") return "xhr"
  if (t === "script") return "script"
  if (t === "main_frame" || t === "sub_frame") return "document"
  if (t === "stylesheet") return "stylesheet"
  if (t === "image") return "image"
  if (t === "font") return "font"
  if (t === "media") return "media"
  if (t === "websocket") return "websocket"
  return "other"
}

// Metadata for EVERY request of an attached tab → the panel breakdown (no bodies,
// no debugger). Bodies for dynamic requests arrive separately via the fetch/XHR patch.
chrome.webRequest.onResponseStarted.addListener(
  (details) => {
    if (!attached.has(details.tabId)) return
    let stats = statsByTab.get(details.tabId)
    if (!stats) {
      stats = emptyStats()
      statsByTab.set(details.tabId, stats)
    }
    stats.total++
    stats[classOf(webReqType(details.type))]++
  },
  { urls: ["<all_urls>"] },
)

// Full request/response headers (Cookie + Set-Cookie included, via extraHeaders)
// for XHR/fetch requests — the fetch/XHR patch can't see Cookie. Keyed by
// tab|method|url so the patch's body can merge with these headers at ingest.
// Only xmlhttprequest (fetch is xmlhttprequest in MV3) is stored, so static/script
// requests (which never reach the patch) don't accumulate.
const reqHeadersByKey = new Map()
function hkey(tabId, method, url) {
  return tabId + "|" + (method || "GET").toUpperCase() + "|" + url
}
function headerArrayToObj(arr) {
  const o = {}
  for (const h of arr || []) o[h.name.toLowerCase()] = h.value
  return o
}
chrome.webRequest.onBeforeSendHeaders.addListener(
  (d) => {
    if (!attached.has(d.tabId) || d.type !== "xmlhttprequest") return
    reqHeadersByKey.set(hkey(d.tabId, d.method, d.url), { req: headerArrayToObj(d.requestHeaders) })
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"],
)
chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (!attached.has(d.tabId) || d.type !== "xmlhttprequest") return
    const rec = reqHeadersByKey.get(hkey(d.tabId, d.method, d.url))
    if (!rec) return
    rec.res = headerArrayToObj(d.responseHeaders)
    rec.status = d.statusCode
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders", "extraHeaders"],
)

chrome.tabs.onRemoved.addListener((tabId) => {
  attached.delete(tabId)
  driverByTab.delete(tabId)
  statsByTab.delete(tabId)
  for (const k of reqHeadersByKey.keys()) if (k.startsWith(tabId + "|")) reqHeadersByKey.delete(k)
})

// Popup asks us to attach/detach/status the active tab.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ;(async () => {
    // Dynamic request body from the MAIN-world fetch/XHR patch → merge with the
    // webRequest headers (Cookie + full request/response headers) → ingest.
    if (msg.type === "captured") {
      const tabId = sender.tab && sender.tab.id
      if (tabId !== undefined && attached.has(tabId) && msg.rec) {
        const rec = msg.rec
        const key = hkey(tabId, rec.method, rec.url)
        const wr = reqHeadersByKey.get(key)
        if (wr) {
          // webRequest request headers are authoritative (Cookie + everything the
          // browser actually sent); patch's JS-set headers are a fallback.
          rec.requestHeaders = Object.assign({}, rec.requestHeaders || {}, wr.req)
          if (wr.res) rec.responseHeaders = Object.assign({}, rec.responseHeaders || {}, wr.res)
          if (wr.status) rec.status = wr.status
          reqHeadersByKey.delete(key)
        }
        forward(rec)
      }
      sendResponse({ ok: true })
      return
    }
    if (msg.type === "attach") {
      await attach(msg.tabId)
      sendResponse({ ok: true, attached: true })
      return
    }
    if (msg.type === "detach") {
      await detach(msg.tabId)
      sendResponse({ ok: true, attached: false })
      return
    }
    if (msg.type === "status") {
      sendResponse({ ok: true, attached: attached.has(msg.tabId) })
      return
    }
    // Content-script (panel) messages — tab identified by sender, not payload.
    if (msg.type === "panel-status") {
      sendResponse(panelStatus(sender.tab && sender.tab.id))
      return
    }
    // List CyberStrike sessions for the panel dropdown. MUST run here (background)
    // — a content-script fetch would be CORS-blocked; background fetch is exempt
    // via host_permissions, same as the capture forward.
    if (msg.type === "list-sessions") {
      const base = await csUrl()
      try {
        const r = await fetch(`${base}/session?limit=20&roots=true`)
        if (!r.ok) {
          sendResponse({ ok: false, sessions: [] })
          return
        }
        const d = await r.json()
        const sessions = Array.isArray(d)
          ? d.filter((s) => s && typeof s.id === "string").map((s) => ({ id: s.id, title: s.title }))
          : []
        sendResponse({ ok: true, sessions })
      } catch (e) {
        sendResponse({ ok: false, sessions: [] })
      }
      return
    }
    // Attach/detach this tab from the panel (no popup needed).
    if (msg.type === "toggle-attach-self") {
      const tabId = sender.tab && sender.tab.id
      if (tabId === undefined) {
        sendResponse({ ok: false, attached: false })
        return
      }
      if (attached.has(tabId)) await detach(tabId)
      else await attach(tabId)
      sendResponse({ ok: true, attached: attached.has(tabId) })
      return
    }
    // Idempotent attach — a spawned role browser calls this to start capturing on open
    // (no toggle risk). Warm the session + credential from storage so the very first
    // request is tagged with the right role and lands on the shared session.
    if (msg.type === "attach-self") {
      const tabId = sender.tab && sender.tab.id
      if (tabId === undefined) {
        sendResponse({ ok: false, attached: false })
        return
      }
      await currentSession()
      await currentCredential()
      attach(tabId)
      sendResponse({ ok: true, attached: true })
      return
    }
    if (msg.type === "set-driver") {
      const tabId = sender.tab && sender.tab.id
      if (tabId !== undefined) driverByTab.set(tabId, msg.driver === "human" ? "human" : "ai")
      sendResponse(panelStatus(tabId))
      return
    }
    // Launcher-injected credential: register directly with CyberStrike's existing
    // credential route and persist it profile-local (same as the popup "Set" button).
    if (msg.type === "set-credential-label") {
      try {
        const cred = await registerCredential(msg.label)
        sendResponse({ ok: true, id: cred.id })
      } catch (e) {
        sendResponse({ ok: false, error: e && e.message ? e.message : String(e) })
      }
      return
    }
    // Panel "Add role": ask CyberStrike to spawn a new Chrome profile (its own cookie
    // jar) on this session tagged with the role. Extensions can't spawn a profile —
    // the backend does. Needs a local CyberStrike + an active session.
    if (msg.type === "spawn-role") {
      try {
        const sid = await ensureSession()
        const base = await csUrl()
        const res = await fetch(`${base}/session/${sid}/web/spawn-profile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: msg.role, url: msg.url }),
        })
        const d = await res.json().catch(() => ({}))
        if (res.ok && d && typeof d.pid === "number") {
          sendResponse({ ok: true, pid: d.pid })
          return
        }
        sendResponse({ ok: false, error: (d && d.error) || `spawn failed (${res.status})` })
      } catch (e) {
        sendResponse({ ok: false, error: e && e.message ? e.message : String(e) })
      }
      return
    }
    // Panel "Browse anonymous": create/ensure a session and start capturing THIS tab as
    // an anonymous identity (no credential). The session is the shared container every
    // later role joins, so this is also the natural first step before Add credential.
    if (msg.type === "bootstrap-anonymous") {
      const tabId = sender.tab && sender.tab.id
      if (tabId === undefined) {
        sendResponse({ ok: false, error: "no tab" })
        return
      }
      try {
        await ensureSession()
        // Register "anonymous" as a real role so it shows in the TUI and joins the
        // access-control comparison — not an untagged NULL that never surfaces. Reuse an
        // existing one (web_credential doesn't dedup by label) to avoid duplicates.
        const existing = await currentCredential()
        if (!(existing && existing.label === "anonymous")) await registerCredential("anonymous")
        attach(tabId)
        sendResponse({ ok: true, attached: true, session: activeSession })
      } catch (e) {
        sendResponse({ ok: false, error: e && e.message ? e.message : String(e) })
      }
      return
    }
    // How many role browsers CyberStrike still has open for this session — the branded
    // panel asks before confirming a close-on-detach.
    if (msg.type === "spawned-count") {
      const sid = await currentSession()
      if (!sid) {
        sendResponse({ ok: true, count: 0 })
        return
      }
      const base = await csUrl()
      try {
        const r = await fetch(`${base}/session/${sid}/web/spawned-count`)
        const d = await r.json().catch(() => ({}))
        sendResponse({ ok: true, count: (d && d.count) || 0 })
      } catch (e) {
        sendResponse({ ok: false, count: 0 })
      }
      return
    }
    // Close every spawned role browser for this session (CyberStrike kills the children
    // after a short flush window).
    if (msg.type === "close-role-browsers") {
      const sid = await currentSession()
      if (!sid) {
        sendResponse({ ok: false })
        return
      }
      const base = await csUrl()
      try {
        const r = await fetch(`${base}/session/${sid}/web/close-profiles`, { method: "POST" })
        const d = await r.json().catch(() => ({}))
        sendResponse({ ok: true, closed: (d && d.closed) || 0 })
      } catch (e) {
        sendResponse({ ok: false })
      }
      return
    }
    if (msg.type === "observe") {
      // Forward this page's clickables to CyberStrike as per-credential UI observations
      // (Faz B). Server derives element_roles/page_visited_by at read time. Needs a
      // session to anchor to; credential is this profile's identity (§3.1), null = anon.
      const obs = msg.observation
      const sid = await currentSession()
      if (obs && obs.url && Array.isArray(obs.clickables) && sid) {
        const base = await csUrl()
        const elements = obs.clickables
          .map((c) => ({ role: c.role || "", label: c.label || "" }))
          .filter((e) => e.label)
        if (elements.length > 0) {
          const payload = { page_url: obs.url, elements }
          const cred = await currentCredential()
          if (cred) payload.credential_id = cred.id
          try {
            await fetch(`${base}/session/${sid}/web/observations`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          } catch (e) {
            console.warn("[hackbrowser] observe forward failed", e)
          }
        }
      }
      sendResponse({ ok: true })
      return
    }
    sendResponse({ ok: false, error: "unknown message" })
  })()
  return true // async sendResponse
})
