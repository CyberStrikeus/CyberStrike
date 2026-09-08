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

// Basic-auth header for a REMOTE CyberStrike (behind a CF tunnel) when the user configured a
// password via the panel's Connect. A local/loopback CS skips auth server-side, so this is empty
// there. Username defaults to "cyberstrike" (matches the server default). One source for auth.
// The Basic token base64("cyberstrike:<pw>"), or "" when no password is set. One source, used by
// both the HTTP header and the control-WS query param (a browser WS can't set a header).
async function authToken() {
  const pw = await new Promise((r) => chrome.storage.local.get("cs_pw", (o) => r(o && o.cs_pw)))
  if (!pw) return ""
  try {
    return btoa("cyberstrike:" + pw)
  } catch {
    return ""
  }
}
async function authHeaders() {
  const t = await authToken()
  return t ? { Authorization: "Basic " + t } : {}
}
// fetch() to the CS server, with the auth header merged in. Used for every CS call so remote
// (tunnel) mode works; a no-op difference for local. Uses globalThis.fetch to avoid self-recursion.
async function csFetch(url, init) {
  const auth = await authHeaders()
  const i = init || {}
  return globalThis.fetch(url, { ...i, headers: { ...(i.headers || {}), ...auth } })
}

// Bound reachability probes so a dead/unroutable remote host fails fast instead of hanging the UI
// (a plain fetch to a no-route host can block for the browser default; connection-refused is quick).
const CS_PING_MS = 5000

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

// Report the panel's driver (AI/Human) to CyberStrike so the server is authoritative:
// it gates web_action (Human blocks the AI) and, later, starts/stops the co-driving loop.
// Fire-and-forget — a failed post must never break the toggle.
async function postDriver(driver) {
  const sid = await currentSession()
  if (!sid) return
  const base = await csUrl()
  try {
    const res = await csFetch(`${base}/session/${encodeURIComponent(sid)}/web/driver`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driver: driver === "human" ? "human" : "ai" }),
    })
    // The server echoes the MAIN model it will plan with — surface it in the panel so the user can
    // see the AI is actually wired up (and to which model).
    const j = res && res.ok ? await res.json().catch(() => null) : null
    if (j && j.model) lastModel = String(j.model)
  } catch (e) {
    console.warn("[hackbrowser] driver post failed", e)
  }
}
// The MAIN model reported by the last successful /web/driver POST — shown in the panel's AI link.
let lastModel = ""

// Pause / resume the AI navigator while the user engages the panel (transient hold — NOT the
// driver toggle). Fire-and-forget; a failed post must never break the hover.
async function postHold(held) {
  const sid = await currentSession()
  if (!sid) return
  const base = await csUrl()
  try {
    await csFetch(`${base}/session/${encodeURIComponent(sid)}/web/hold`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ held: !!held }),
    })
  } catch (e) {
    console.warn("[hackbrowser] hold post failed", e)
  }
}

// Post a diagnostic event to CyberStrike's per-session HackBrowser log. The ABSENCE of these
// on the server is the signal that the extension isn't reaching this server / isn't the current
// build / CfT didn't load it. Fire-and-forget; never blocks the flow it observes.
async function hblog(event, data) {
  const sid = await currentSession()
  if (!sid) return
  const base = await csUrl()
  try {
    await csFetch(`${base}/session/${encodeURIComponent(sid)}/web/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "extension", event, data }),
    })
  } catch {}
}

// Register a credential label with CyberStrike and make it this profile's identity.
// Shared by the panel "Set" button, spawned role browsers, and Browse-anonymous — the
// last one registers a real "anonymous" role so it is a first-class identity in the TUI
// and the access-control comparison, not an untagged NULL that never surfaces.
async function registerCredential(label) {
  const sid = await currentSession()
  if (!sid) throw new Error("no session selected")
  const base = await csUrl()
  const res = await csFetch(`${base}/session/${sid}/web/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  })
  const d = await res.json().catch(() => ({}))
  if (!d || !d.id) throw new Error("register failed")
  // Use the server's canonical label (first-registered casing) so the panel shows one role
  // even if the user typed a different case. `reused` tells the caller it already existed.
  activeCredential = { id: d.id, label: d.label || label }
  await chrome.storage.local.set({ credential: activeCredential })
  return { ...activeCredential, reused: !!d.reused }
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
    const res = await csFetch(`${base}/session`, {
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
// The panel's status shape — one source, so panel-status and set-driver can't drift. Capture
// COUNTS are NOT tallied here: the panel/HUD reads them from the server (GET /web/stats, sourced
// from the backend DataCollector) so the extension stays a thin collector with no parallel tally.
function panelStatus(tabId) {
  const ok = tabId !== undefined
  return {
    attached: ok && attached.has(tabId),
    driver: (ok && driverByTab.get(tabId)) || "ai",
    // AI-link troubleshooting: is the control channel to CyberStrike open, and which model is it?
    control: !!(controlWs && controlWs.readyState === WebSocket.OPEN),
    model: lastModel,
  }
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
  // Master enable/disable from the popup. Disabling detaches every tab (content scripts also tear
  // themselves down) so capture stops and the control channel closes — nothing keeps running.
  if (changes.enabled && changes.enabled.newValue === false) {
    for (const tabId of [...attached.keys()]) detach(tabId)
    closeControl()
  }
  if (changes.credential) activeCredential = changes.credential.newValue || null
  if (changes.session) {
    activeSession = changes.session.newValue || ""
    // Session changed while capturing → point the control channel at the new session.
    if (activeSession && drivenTab() !== undefined) {
      try {
        if (controlWs) controlWs.close()
      } catch {}
      connectControl()
    }
  }
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
  void hblog("attach", { tabId })
  persistCapState()
  connectControl() // AI co-driving: open the control channel once we're capturing.
}
function detach(tabId) {
  attached.delete(tabId)
  driverByTab.delete(tabId) // clear the driver too — a later re-attach must start fresh ("ai"),
  // not silently inherit a paused Human/Idle from before (which reconnect would re-post as "human").
  persistCapState()
  if (attached.size === 0) closeControl() // nothing to drive → drop the control channel
}

// MV3 service workers are evicted when idle; `attached` / `driverByTab` live only in SW memory, so
// an eviction would silently stop capture (the webRequest listeners gate on `attached.has`). Mirror
// the capture state to storage and restore it when the SW wakes so capture survives an eviction.
function persistCapState() {
  try {
    chrome.storage.local.set({ capState: { attached: [...attached.keys()], drivers: Object.fromEntries(driverByTab) } })
  } catch {}
}
async function restoreCapState() {
  const cap = await new Promise((r) => chrome.storage.local.get("capState", (o) => r(o && o.capState)))
  if (!cap || !Array.isArray(cap.attached)) return
  let any = false
  for (const tabId of cap.attached) {
    // Only restore tabs that still exist — a tab closed while the SW was evicted must not linger.
    const alive = await new Promise((r) => chrome.tabs.get(tabId, (t) => r(!chrome.runtime.lastError && !!t)))
    if (!alive) continue
    attached.set(tabId, true)
    const d = cap.drivers && cap.drivers[tabId]
    if (d) driverByTab.set(tabId, d)
    any = true
  }
  if (any) {
    persistCapState() // prune any dropped (closed) tabs from storage
    connectControl() // resume the control channel (also re-arms the SW keepalive while co-driving)
  }
}
void restoreCapState()
function closeControl() {
  if (controlReconnectTimer) {
    clearTimeout(controlReconnectTimer)
    controlReconnectTimer = null
  }
  if (controlWs) {
    try {
      controlWs.onclose = null // don't let close trigger a reconnect
      controlWs.close()
    } catch {}
    controlWs = null
  }
}

// --- AI co-driving control channel (CyberStrike → this browser) -------------------
// CyberStrike's /web/action relays click/type/navigate commands over WS /web/control;
// we execute them in the driven tab via the content script's `perform` handler and ack.
// MV3 keeps the service worker alive while a WebSocket is open (Chrome 116+).
let controlWs = null
let controlReconnectTimer = null

// --- Watchdog (dead-man's-switch): don't let a spawned browser OUTLIVE CyberStrike ---------------
// The server-side cleanup (SpawnedProfiles) kills browsers when CS exits gracefully, but it can't
// run if CS is SIGKILLed or crashes. So the browser also self-protects: if the control channel was
// ever up and has now been unreachable for WATCHDOG_MS, we conclude CS is gone and close this
// browser. Gated on `controlEverOpen` so a browser that never reached CS — or a brief CS restart —
// is not force-closed. Reusable liveness pattern (see the reuse note): a component watches its
// controller's heartbeat and takes a fail-safe action when it's lost past a threshold.
const WATCHDOG_MS = 45000
let controlEverOpen = false
let controlDownSince = 0
// controlEverOpen / controlDownSince are SW-memory globals, so an MV3 service-worker eviction
// (Chrome kills an idle SW at ~30s — BELOW WATCHDOG_MS) both stops the setTimeout reconnect loop
// AND resets these to false/0, which made watchdogExpired() unable to ever fire again — the exact
// scenario the dead-man's-switch exists for. Mirror the state to storage (same pattern as
// persistCapState) and restore it whenever the SW wakes, so the watchdog spans an eviction.
function setWatchdog(ever, downSince) {
  controlEverOpen = ever
  controlDownSince = downSince
  try {
    chrome.storage.local.set({ watchdog: { ever, downSince } })
  } catch {}
}
async function loadWatchdog() {
  const w = await new Promise((r) => chrome.storage.local.get("watchdog", (o) => r(o && o.watchdog)))
  if (!w) return
  controlEverOpen = !!w.ever
  controlDownSince = w.downSince || 0
}
function watchdogExpired() {
  return controlEverOpen && controlDownSince > 0 && Date.now() - controlDownSince > WATCHDOG_MS
}
// The eviction-proof backstop: an alarm wakes the SW even after Chrome evicted it, so the check
// runs regardless of whether the reconnect loop is still alive. Created once (not re-created on
// every SW start, which would reset its schedule). 30s is the current chrome.alarms floor; paired
// with the 45s threshold the worst-case self-close latency is ~45–75s after CS vanishes.
const WATCHDOG_ALARM = "cs-watchdog"
try {
  chrome.alarms.get(WATCHDOG_ALARM, (a) => {
    if (!a) chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 })
  })
  chrome.alarms.onAlarm.addListener(async (a) => {
    if (a.name !== WATCHDOG_ALARM) return
    await loadWatchdog() // the SW may have just woken with empty globals
    if (watchdogExpired()) await selfCloseBrowser()
  })
} catch {}
void loadWatchdog() // restore watchdog state on SW startup (survives eviction)
async function selfCloseBrowser() {
  // ONLY a spawned (throwaway CfT) profile self-closes. A user who self-installed this extension
  // in their own browser must NEVER have their windows closed because CS went away.
  const spawned = await new Promise((r) => chrome.storage.local.get("spawned", (o) => r(o && o.spawned)))
  if (!spawned) return
  void hblog("watchdog-selfclose", { downMs: Date.now() - controlDownSince })
  try {
    const wins = await chrome.windows.getAll()
    for (const w of wins) if (w.id !== undefined) await chrome.windows.remove(w.id)
  } catch {}
  try {
    const tabs = await chrome.tabs.query({})
    const ids = tabs.map((t) => t.id).filter((id) => id !== undefined)
    if (ids.length) await chrome.tabs.remove(ids)
  } catch {}
}

// The tab the AI drives — the (first) attached tab in this browser.
function drivenTab() {
  for (const [tabId, on] of attached) if (on) return tabId
  return undefined
}
function controlSend(ws, obj) {
  try {
    ws.send(JSON.stringify(obj))
  } catch {}
}
function scheduleControlReconnect() {
  if (controlReconnectTimer) return
  controlReconnectTimer = setTimeout(() => {
    controlReconnectTimer = null
    // CS unreachable too long → self-close instead of reconnecting forever (the reconnect loop
    // itself keeps the MV3 service worker alive long enough for this check to fire).
    if (watchdogExpired()) return void selfCloseBrowser()
    connectControl()
  }, 3000)
}
async function connectControl() {
  const sid = await currentSession()
  if (!sid) return
  if (controlWs && (controlWs.readyState === WebSocket.CONNECTING || controlWs.readyState === WebSocket.OPEN)) return
  const base = await csUrl()
  let wsUrl = base.replace(/^http/i, "ws") + `/session/${encodeURIComponent(sid)}/web/control`
  // A remote (tunnel) CS requires auth; the browser WS can't send an Authorization header, so pass
  // the same Basic token as a query param (the server's auth middleware also accepts _cs_auth).
  const tok = await authToken()
  if (tok) wsUrl += "?_cs_auth=" + encodeURIComponent(tok)
  let ws
  try {
    ws = new WebSocket(wsUrl)
  } catch {
    scheduleControlReconnect()
    return
  }
  controlWs = ws
  ws.onopen = () => {
    console.log("[hackbrowser] control WS connected")
    void hblog("control-ws-open")
    setWatchdog(true, 0) // watchdog: we reached CS at least once → self-protect if it later vanishes
    // Tell the server who is driving as soon as the control channel is up. The panel default
    // is "ai" (co-driving), so an un-toggled tab must still report "ai" — otherwise the server
    // never learns the driver and the AI loop never starts even though the panel shows "AI
    // driving". A human takeover later re-POSTs "human".
    const t = drivenTab()
    if (t !== undefined) void postDriver(driverByTab.get(t) || "ai")
  }
  ws.onmessage = async (ev) => {
    let msg
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : "")
    } catch {
      return
    }
    if (!msg || !msg.id) return
    // Auth-context fetch (mining): the server asks us to fetch a URL from the BROWSER, so it
    // inherits the session cookies + proxy/TLS (host_permissions also bypass CORS). No tab needed —
    // the background does it directly. Reaches auth-gated JS bundles / API specs a server-side fetch
    // would 401 on. Bounded + best-effort; returns the body in the ack.
    if (msg.op === "fetch") {
      let body = null
      try {
        const res = await fetch(msg.url, { credentials: "include", redirect: "follow", signal: AbortSignal.timeout(10000) })
        if (res.ok) {
          const text = await res.text()
          body = text.length > 3_000_000 ? text.slice(0, 3_000_000) : text
        }
      } catch (e) {
        void hblog("fetch-failed", { url: msg.url, error: String(e) })
      }
      controlSend(ws, body === null ? { id: msg.id, ok: false } : { id: msg.id, ok: true, body })
      return
    }
    console.log("[hackbrowser] perform", msg.op, msg.elementId || msg.url || "")
    void hblog("perform", { op: msg.op, target: msg.elementId || msg.url || "" })
    const tabId = drivenTab()
    if (tabId === undefined) {
      console.warn("[hackbrowser] perform dropped: no attached tab")
      void hblog("perform-dropped", { reason: "no-attached-tab" })
      controlSend(ws, { id: msg.id, ok: false, error: "no attached tab" })
      return
    }
    // Carry the framework-adaptive fields through (P5): `mode` (type: native-setter for
    // React/Vue/Angular controlled inputs) and `until` (wait op: hydration).
    const cmd = { op: msg.op, elementId: msg.elementId, text: msg.text, url: msg.url, mode: msg.mode, until: msg.until, timeoutMs: msg.timeoutMs, act: msg.act, label: msg.label, intent: msg.intent }
    const ack = await new Promise((r) =>
      chrome.tabs.sendMessage(tabId, { type: "perform", cmd }, (res) => {
        void chrome.runtime.lastError
        r(res)
      }),
    )
    controlSend(ws, { id: msg.id, ok: !!(ack && ack.ok), error: ack && ack.error })
  }
  ws.onclose = () => {
    if (controlWs === ws) controlWs = null
    if (!controlDownSince) setWatchdog(controlEverOpen, Date.now()) // watchdog: start the "CS unreachable" clock
    scheduleControlReconnect()
  }
  ws.onerror = () => {
    try {
      ws.close()
    } catch {}
  }
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
    const res = await csFetch(`${base}/session/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    void hblog("ingest", { method: rec.method || "GET", url: rec.url, status: rec.status || 0, ok: res.ok })
    if (res.ok) {
      const d = await res.json().catch(() => ({}))
      if (d && d.sessionID && !sid) {
        activeSession = d.sessionID
        chrome.storage.local.set({ session: activeSession })
      }
    }
  } catch (e) {
    void hblog("ingest-failed", { url: rec.url, error: String(e) })
    console.warn("[hackbrowser] ingest failed", e)
  }
}

// Full request/response headers (Cookie + Set-Cookie included, via extraHeaders)
// for XHR/fetch requests — the fetch/XHR patch can't see Cookie. Keyed by
// tab|method|url so the patch's body can merge with these headers at ingest.
// Only xmlhttprequest (fetch is xmlhttprequest in MV3) is stored, so static/script
// requests (which never reach the patch) don't accumulate.
// tabId|method|url → captured request headers, awaiting the matching fetch/XHR-patch body. Bounded:
// a request the patch never reports back (errored / navigated away mid-flight) would otherwise leak
// an entry forever, so drop the oldest once we exceed the cap (Map preserves insertion order).
const reqHeadersByKey = new Map()
const REQ_HEADERS_CAP = 500
function rememberReqHeaders(key, val) {
  if (reqHeadersByKey.size >= REQ_HEADERS_CAP) {
    const oldest = reqHeadersByKey.keys().next().value
    if (oldest !== undefined) reqHeadersByKey.delete(oldest)
  }
  reqHeadersByKey.set(key, val)
}
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
    if (!attached.has(d.tabId)) return
    // xmlhttprequest: headers merge with the fetch/XHR patch body. main_frame/sub_frame:
    // full-page navigations the patch NEVER sees — capture their headers so we can ingest them.
    if (d.type !== "xmlhttprequest" && d.type !== "main_frame" && d.type !== "sub_frame") return
    rememberReqHeaders(hkey(d.tabId, d.method, d.url), { req: headerArrayToObj(d.requestHeaders) })
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"],
)
chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (!attached.has(d.tabId)) return
    if (d.type === "xmlhttprequest") {
      const rec = reqHeadersByKey.get(hkey(d.tabId, d.method, d.url))
      if (!rec) return
      rec.res = headerArrayToObj(d.responseHeaders)
      rec.status = d.statusCode
      return
    }
    // Full-page / iframe navigations: the fetch/XHR patch can't observe document loads, so a
    // classic (JSP/MPA) app would ingest almost nothing. Ingest them here from webRequest
    // metadata — no body (MV3 webRequest can't read response bodies), but method/url/params/
    // status/headers are the core for endpoint + access-control analysis.
    if (d.type === "main_frame" || d.type === "sub_frame") {
      const key = hkey(d.tabId, d.method, d.url)
      const stored = reqHeadersByKey.get(key)
      reqHeadersByKey.delete(key)
      forward({
        method: d.method,
        url: d.url,
        requestHeaders: (stored && stored.req) || {},
        responseHeaders: headerArrayToObj(d.responseHeaders),
        status: d.statusCode,
        page_url: d.url,
      })
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders", "extraHeaders"],
)

chrome.tabs.onRemoved.addListener((tabId) => {
  attached.delete(tabId)
  driverByTab.delete(tabId)
  for (const k of reqHeadersByKey.keys()) if (k.startsWith(tabId + "|")) reqHeadersByKey.delete(k)
  persistCapState()
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
    // Lightweight reachability probe for the panel's AI link — is CyberStrike answering at all, and
    // what model did the last driver post report. Lets the panel show "connecting / connected · model
    // / CyberStrike unreachable" even before capture (when there is no control WS yet).
    if (msg.type === "ping-cs") {
      const base = await csUrl()
      let reachable = false
      try {
        const r = await csFetch(`${base}/session?limit=1&roots=true`, { signal: AbortSignal.timeout(CS_PING_MS) })
        reachable = !!(r && r.ok)
      } catch {}
      sendResponse({ reachable, model: lastModel })
      return
    }
    // Panel/HUD capture counts — read straight from the server (DataCollector), NOT tallied in the
    // extension, so the panel reflects the backend DB and the extension stays a thin collector.
    if (msg.type === "web-stats") {
      const sid = await currentSession()
      if (!sid) return void sendResponse({ ok: false })
      const base = await csUrl()
      try {
        const r = await csFetch(`${base}/session/${encodeURIComponent(sid)}/web/stats`)
        const stats = r && r.ok ? await r.json().catch(() => null) : null
        sendResponse(stats ? { ok: true, stats } : { ok: false })
      } catch {
        sendResponse({ ok: false })
      }
      return
    }
    if (msg.type === "list-sessions") {
      const base = await csUrl()
      try {
        const r = await csFetch(`${base}/session?limit=20&roots=true`)
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
    if (msg.type === "set-driver") {
      const tabId = sender.tab && sender.tab.id
      if (tabId !== undefined) {
        driverByTab.set(tabId, msg.driver === "human" ? "human" : "ai")
        persistCapState() // survive an SW eviction with the right driver
      }
      // Make the server authoritative on who drives (interlock + loop trigger).
      void postDriver(msg.driver === "human" ? "human" : "ai")
      sendResponse(panelStatus(tabId))
      return
    }
    // Panel hover / settings-open → pause the AI navigator so the page stays stable; leave → resume.
    if (msg.type === "set-hold") {
      void postHold(!!msg.held)
      sendResponse({ ok: true })
      return
    }
    // Connect: point THIS extension at a CyberStrike server (URL + optional password for remote/
    // tunnel). Lets the one extension work self-installed in any browser, not only spawned CfT.
    if (msg.type === "set-server") {
      const patch = {}
      if (typeof msg.url === "string" && msg.url.trim()) patch.cyberstrike = msg.url.trim().replace(/\/+$/, "")
      patch.cs_pw = typeof msg.password === "string" ? msg.password : ""
      chrome.storage.local.set(patch, () => {
        setWatchdog(false, 0) // give the control channel a fresh start against the new server
        sendResponse({ ok: true })
      })
      return true // async sendResponse
    }
    if (msg.type === "get-server") {
      chrome.storage.local.get(["cyberstrike"], (o) => sendResponse({ url: (o && o.cyberstrike) || "" })) // never return the password
      return true
    }
    // Content-script diagnostics → forward to the per-session HackBrowser log.
    if (msg.type === "hblog") {
      void hblog(msg.event, msg.data)
      sendResponse({ ok: true })
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
    // Panel "Add credential": ENQUEUE a role for sequential setup. Its browser is spawned
    // by CyberStrike when its turn comes (the previous role's capture-started).
    // Panel "Add Credential" → open a new browser for this identity RIGHT NOW (direct spawn, not the
    // sequential queue). msg.role = credential label; optional msg.roleName + msg.roleLevel declare a
    // role tier the server turns into a web_role + pre-linked credential (BFLA). Needs a reachable CS
    // (ensureSession creates/points the session there), so a down backend fails cleanly.
    if (msg.type === "spawn-credential") {
      try {
        const sid = await ensureSession()
        const base = await csUrl()
        const roleName = msg.roleName && String(msg.roleName).trim()
        const res = await csFetch(`${base}/session/${sid}/web/spawn-profile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: msg.url, role: msg.role, roleName: roleName || undefined, roleLevel: msg.roleLevel }),
        })
        if (res.ok) {
          sendResponse({ ok: true })
          return
        }
        sendResponse({ ok: false, error: `spawn failed (${res.status})` })
      } catch (e) {
        sendResponse({ ok: false, error: e && e.message ? e.message : String(e) })
      }
      return
    }
    // Orchestrator panel polls the sequential-setup queue to show "spawning <role>…" /
    // "please sign in as <role>".
    if (msg.type === "queue-status") {
      const sid = await currentSession()
      if (!sid) {
        sendResponse({ ok: true, status: { roles: [], setup: null } })
        return
      }
      const base = await csUrl()
      try {
        const r = await csFetch(`${base}/session/${sid}/web/queue-status`)
        const d = await r.json().catch(() => null)
        sendResponse({ ok: true, status: d || { roles: [], setup: null } })
      } catch (e) {
        sendResponse({ ok: false })
      }
      return
    }
    // Panel "Start capture": create/ensure a session, register THIS tab's role (default
    // "anonymous"), and attach. One button, role-aware — the session is the shared
    // container every later role joins.
    if (msg.type === "start-capture") {
      const tabId = sender.tab && sender.tab.id
      if (tabId === undefined) {
        sendResponse({ ok: false, error: "no tab" })
        return
      }
      const role = (msg.role && String(msg.role).trim()) || "Anonymous"
      // Recording needs CyberStrike (it owns the session + the capture pipeline). Verify the server
      // is actually reachable BEFORE attaching — otherwise a stored session + cached credential let
      // capture "start" locally with no backend, a phantom recording. A down server must fail here.
      try {
        const base = await csUrl()
        const ping = await csFetch(`${base}/session?limit=1&roots=true`, { signal: AbortSignal.timeout(CS_PING_MS) })
        if (!ping || !ping.ok) {
          // 401 = reached the server but auth failed (wrong remote password) — a distinct, fixable
          // problem from "unreachable", so the panel can say "check the password".
          const err = ping && ping.status === 401 ? "authentication failed — check the password" : "CyberStrike unreachable"
          sendResponse({ ok: false, error: err })
          return
        }
      } catch {
        sendResponse({ ok: false, error: "CyberStrike unreachable" })
        return
      }
      try {
        await ensureSession()
        // Register the role as a real credential (anonymous included) so it shows in the
        // TUI and joins the access-control comparison. Reuse if it's already this role
        // (web_credential doesn't dedup by label) to avoid duplicates.
        // Reuse if it's already this role (case-insensitive) — the server dedups too, but this
        // avoids an extra round-trip. `reused` + the canonical label flow back to the panel so
        // it can hint "role already exists" and show ONE role.
        const existing = await currentCredential()
        let reused = false
        let canonical = role
        if (existing && existing.label && existing.label.toLowerCase() === role.toLowerCase()) {
          reused = true
          canonical = existing.label
        } else {
          const cred = await registerCredential(role)
          reused = !!cred.reused
          canonical = cred.label || role
        }
        attach(tabId)
        // Advance the sequential role queue — CyberStrike spawns the next role's browser
        // if one is queued. Fire-and-forget: capture is already on locally; the panel
        // polls queue-status for the result.
        const base = await csUrl()
        csFetch(`${base}/session/${activeSession}/web/capture-started`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: canonical, url: msg.url || "" }),
        }).catch(() => {})
        sendResponse({ ok: true, attached: true, session: activeSession, reused, role: canonical })
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
        const r = await csFetch(`${base}/session/${sid}/web/spawned-count`)
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
        const r = await csFetch(`${base}/session/${sid}/web/close-profiles`, { method: "POST" })
        const d = await r.json().catch(() => ({}))
        sendResponse({ ok: true, closed: (d && d.closed) || 0 })
      } catch (e) {
        sendResponse({ ok: false })
      }
      return
    }
    if (msg.type === "observe") {
      // Forward the full page observation to CyberStrike's /web/observe, which feeds BOTH
      // the get_page_state store (what the AI acts on) and the per-credential Faz B
      // UI-affordance store (element_roles). Needs a session to anchor to.
      const obs = msg.observation
      const sid = await currentSession()
      if (obs && obs.url && Array.isArray(obs.clickables) && sid) {
        const base = await csUrl()
        const cred = await currentCredential()
        const tabId = sender.tab && sender.tab.id
        const payload = {
          url: obs.url,
          title: obs.title || "",
          clickables: obs.clickables,
          forms: obs.forms || [],
          links: obs.links || [],
          driver: (tabId !== undefined && driverByTab.get(tabId)) || "ai",
        }
        // Rich page context (2.0) — forward whatever the content script observed. The
        // server validator (zod) drops any key it doesn't declare, so this is safe to spread.
        if (obs.description) payload.description = obs.description
        if (Array.isArray(obs.location)) payload.location = obs.location
        if (Array.isArray(obs.landmarks)) payload.landmarks = obs.landmarks
        if (Array.isArray(obs.frames)) payload.frames = obs.frames
        if (typeof obs.canvas === "number") payload.canvas = obs.canvas
        if (typeof obs.dynamic === "boolean") payload.dynamic = obs.dynamic
        if (obs.tech && typeof obs.tech === "object") payload.tech = obs.tech // framework fingerprint signals (P2)
        if (Array.isArray(obs.js_bundles)) payload.js_bundles = obs.js_bundles // <script src> bundle urls (JS-first discovery)
        if (typeof obs.modal_open === "boolean") payload.modal_open = obs.modal_open // a modal dialog is trapping interaction
        if (cred) payload.credential_id = cred.id
        try {
          await csFetch(`${base}/session/${sid}/web/observe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        } catch (e) {
          console.warn("[hackbrowser] observe forward failed", e)
        }
      }
      sendResponse({ ok: true })
      return
    }
    sendResponse({ ok: false, error: "unknown message" })
  })()
  return true // async sendResponse
})
