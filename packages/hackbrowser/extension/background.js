// CyberStrike HackBrowser 2.0 — background service worker.
//
// Captures ALL network traffic on an attached tab via the Chrome DevTools
// Protocol (chrome.debugger → Network domain) and forwards each request to a
// receiver endpoint. This is the extension CaptureSource: it drives the tab
// in-page rather than through a Playwright/CDP automation stack, so the only
// CDP surface is the Network domain (needed for response bodies).
//
// Body policy (see design §2.1.1): every request's metadata is forwarded;
// response bodies are fetched only for DYNAMIC resources (xhr/fetch/document/
// eventsource) — static assets (script/stylesheet/font/image/media) forward
// URL + hash only, and their bodies are pulled later, out of band.

const DEBUGGER_VERSION = "1.3"
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

// tabId → true, for tabs we've attached to
const attached = new Map()
// `${tabId}:${requestId}` → in-flight request record awaiting its response
const pending = new Map()
// tabId → "ai" | "human" — co-driving state; set from the panel handover toggle.
// Tags each forwarded record so human-driven captures are distinguishable (§6.4).
const driverByTab = new Map()
// tabId → capture breakdown by class (shown in the panel). Computed locally from
// each request's resource_type — no backend needed.
const statsByTab = new Map()

function emptyStats() {
  return { total: 0, api: 0, js: 0, html: 0, static: 0, realtime: 0, other: 0 }
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

// CDP resource type → our normalized resource_type
function normalizeType(cdpType) {
  const t = (cdpType || "").toLowerCase()
  if (t === "document") return "document"
  if (t === "script") return "script"
  if (t === "stylesheet") return "stylesheet"
  if (t === "xhr") return "xhr"
  if (t === "fetch") return "fetch"
  if (t === "image") return "image"
  if (t === "font") return "font"
  if (t === "media") return "media"
  if (t === "websocket") return "websocket"
  if (t === "eventsource") return "eventsource"
  return "other"
}

// Static (idempotent) resources forward URL+hash only; dynamic carry the body.
function bodyClass(resourceType, method) {
  const m = (method || "GET").toUpperCase()
  if (resourceType === "xhr" || resourceType === "fetch" || resourceType === "eventsource") return "dynamic"
  if (resourceType === "document" && m !== "GET" && m !== "HEAD") return "dynamic"
  if (resourceType === "document") return "dynamic" // keep HTML for form/link extraction
  return "static"
}

// NOTE: the WS control channel (AI → extension click/type/navigate) lived on the
// receiver, which we removed. Co-driving/click-brick will return once that path is
// re-homed on CyberStrike; the content-script `perform` handler stays ready. See
// git history for the receiver-based version.

async function attach(tabId) {
  if (attached.has(tabId)) return
  await chrome.debugger.attach({ tabId }, DEBUGGER_VERSION)
  await chrome.debugger.sendCommand({ tabId }, "Network.enable", {})
  attached.set(tabId, true)
}

async function detach(tabId) {
  if (!attached.has(tabId)) return
  try {
    await chrome.debugger.detach({ tabId })
  } catch (e) {
    // tab may already be gone
  }
  attached.delete(tabId)
}

// Forward a captured record straight to CyberStrike's /session/ingest (the existing
// route the 1.x worker used). Only DYNAMIC requests are ingested; static assets are
// skipped (mined later). Session is reused: the first ingest creates one, its id is
// stored and rides along after.
async function forward(record) {
  if (record.bodyClass !== "dynamic") return // static asset — skip ingest
  const base = await csUrl()
  const payload = { text: toRawHttp(record), scheme: record.scheme }
  if (activeSession) payload.sessionID = activeSession
  if (record.credentialId) payload.credential_id = record.credentialId
  if (record.status > 0) {
    payload.response = { status: record.status, headers: record.responseHeaders, body: record.responseBody || "" }
  }
  try {
    const res = await fetch(`${base}/session/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      const d = await res.json().catch(() => ({}))
      if (d && d.sessionID && !activeSession) {
        activeSession = d.sessionID
        chrome.storage.local.set({ session: activeSession })
      }
    }
  } catch (e) {
    console.warn("[hackbrowser] ingest failed", e)
  }
}

// Single global CDP event listener; source.tabId disambiguates.
chrome.debugger.onEvent.addListener(async (source, method, params) => {
  const tabId = source.tabId
  if (tabId === undefined) return
  const key = `${tabId}:${params && params.requestId}`

  if (method === "Network.requestWillBeSent") {
    const req = params.request
    const resourceType = normalizeType(params.type)
    pending.set(key, {
      url: req.url,
      method: req.method,
      requestHeaders: req.headers || {},
      requestBody: req.postData || null,
      resourceType,
      bodyClass: bodyClass(resourceType, req.method),
      scheme: req.url.startsWith("https:") ? "https" : "http",
      timestamp: Date.now(),
      response: null,
    })
    return
  }

  if (method === "Network.responseReceived") {
    const rec = pending.get(key)
    if (!rec) return
    const res = params.response
    rec.response = {
      status: res.status,
      headers: res.headers || {},
      contentType: res.mimeType || "",
    }
    return
  }

  if (method === "Network.loadingFinished") {
    const rec = pending.get(key)
    if (!rec) return
    pending.delete(key)

    let responseBody = null
    let responseSize = 0
    if (rec.bodyClass === "dynamic" && rec.response) {
      try {
        const out = await chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", {
          requestId: params.requestId,
        })
        responseBody = out && out.body ? out.body : null
        responseSize = responseBody ? responseBody.length : 0
      } catch (e) {
        // body no longer available (streamed/evicted) — forward without it
      }
    }

    const response = rec.response || { status: 0, headers: {}, contentType: "" }
    let stats = statsByTab.get(tabId)
    if (!stats) {
      stats = emptyStats()
      statsByTab.set(tabId, stats)
    }
    stats.total++
    stats[classOf(rec.resourceType)]++
    forward({
      url: rec.url,
      method: rec.method,
      status: response.status,
      resourceType: rec.resourceType,
      bodyClass: rec.bodyClass,
      requestHeaders: rec.requestHeaders,
      requestBody: rec.requestBody,
      responseHeaders: response.headers,
      responseBody,
      responseSize,
      contentType: response.contentType,
      scheme: rec.scheme,
      timestamp: rec.timestamp,
      // co-driving provenance: who was driving when this was captured (§6.4)
      driver: driverByTab.get(tabId) || "ai",
      // this profile's identity (§3.1) — null until the popup sets a credential
      credentialId: activeCredential ? activeCredential.id : null,
      // enrichment fields — filled in later phases (panel triggers)
      triggerElement: null,
      elementRoles: null,
      pageUrl: null,
      pageVisitedBy: null,
      isPrefetch: false,
    })
    return
  }
})

// Auto-detach bookkeeping when a tab closes or the user detaches via DevTools.
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== undefined) attached.delete(source.tabId)
})
chrome.tabs.onRemoved.addListener((tabId) => {
  attached.delete(tabId)
  driverByTab.delete(tabId)
  statsByTab.delete(tabId)
  for (const key of pending.keys()) {
    if (key.startsWith(`${tabId}:`)) pending.delete(key)
  }
})

// Popup asks us to attach/detach/status the active tab.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ;(async () => {
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
      const tabId = sender.tab && sender.tab.id
      sendResponse({
        attached: tabId !== undefined && attached.has(tabId),
        stats: tabId !== undefined ? statsByTab.get(tabId) || emptyStats() : emptyStats(),
        driver: tabId !== undefined ? driverByTab.get(tabId) || "ai" : "ai",
      })
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
    if (msg.type === "set-driver") {
      const tabId = sender.tab && sender.tab.id
      if (tabId !== undefined) driverByTab.set(tabId, msg.driver === "human" ? "human" : "ai")
      sendResponse({
        attached: tabId !== undefined && attached.has(tabId),
        stats: tabId !== undefined ? statsByTab.get(tabId) || emptyStats() : emptyStats(),
        driver: tabId !== undefined ? driverByTab.get(tabId) || "ai" : "ai",
      })
      return
    }
    // Launcher-injected credential: register directly with CyberStrike's existing
    // credential route and persist it profile-local (same as the popup "Set" button).
    if (msg.type === "set-credential-label") {
      if (!activeSession) {
        sendResponse({ ok: false, error: "no session selected" })
        return
      }
      const base = await csUrl()
      try {
        const res = await fetch(`${base}/session/${activeSession}/web/credentials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: msg.label }),
        })
        const d = await res.json().catch(() => ({}))
        if (d && d.id) {
          await chrome.storage.local.set({ credential: { id: d.id, label: d.label } })
          sendResponse({ ok: true, id: d.id })
          return
        }
        sendResponse({ ok: false, error: "register failed" })
      } catch (e) {
        sendResponse({ ok: false, error: String(e) })
      }
      return
    }
    if (msg.type === "observe") {
      // Page-state store is a 2.0-only feature not yet in CyberStrike (co-driving /
      // get_page_state). Deferred — the panel still shows counts locally.
      sendResponse({ ok: true })
      return
    }
    sendResponse({ ok: false, error: "unknown message" })
  })()
  return true // async sendResponse
})
