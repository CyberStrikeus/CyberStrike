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
const DEFAULT_RECEIVER = "http://127.0.0.1:4097/capture"

// tabId → true, for tabs we've attached to
const attached = new Map()
// `${tabId}:${requestId}` → in-flight request record awaiting its response
const pending = new Map()
// tabId → "ai" | "human" — co-driving state; set from the panel handover toggle.
// Tags each forwarded record so human-driven captures are distinguishable (§6.4).
const driverByTab = new Map()
// tabId → count of records forwarded (shown in the panel)
const countByTab = new Map()

function receiverUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get("receiver", (out) => {
      resolve(out && out.receiver ? out.receiver : DEFAULT_RECEIVER)
    })
  })
}

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

// --- WS control channel (receiver → extension) ------------------------------
// Receives click/type/navigate commands the AI issued (already guard-checked by
// the receiver — a denied command never arrives here) and executes them via the
// content script. Reconnects on drop so the channel survives receiver restarts.
let controlWs = null

function controlUrl(base) {
  // http://127.0.0.1:4097/capture → ws://127.0.0.1:4097/control
  return base.replace(/^http/, "ws").replace(/\/capture$/, "/control")
}

async function connectControl() {
  if (controlWs) return
  const base = await receiverUrl()
  const wsUrl = controlUrl(base)
  try {
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => {
      controlWs = ws
    }
    ws.onmessage = (e) => {
      let cmd
      try {
        cmd = JSON.parse(e.data)
      } catch {
        return
      }
      handleCommand(cmd)
    }
    ws.onclose = () => {
      controlWs = null
      setTimeout(connectControl, 2000) // reconnect
    }
    ws.onerror = () => {}
  } catch (e) {
    setTimeout(connectControl, 2000)
  }
}

function ackCommand(id, ok, error) {
  if (controlWs) controlWs.send(JSON.stringify({ id, ok: !!ok, error: error || undefined }))
}

function handleCommand(cmd) {
  // Route to an attached tab's content script for execution. Single-tab for now.
  const tabId = [...attached.keys()][0]
  if (tabId === undefined) {
    ackCommand(cmd.id, false, "no attached tab")
    return
  }
  chrome.tabs.sendMessage(tabId, { type: "perform", cmd }, (res) => {
    if (chrome.runtime.lastError) {
      ackCommand(cmd.id, false, chrome.runtime.lastError.message)
      return
    }
    ackCommand(cmd.id, res && res.ok, res && res.error)
  })
}

async function attach(tabId) {
  if (attached.has(tabId)) return
  await chrome.debugger.attach({ tabId }, DEBUGGER_VERSION)
  await chrome.debugger.sendCommand({ tabId }, "Network.enable", {})
  attached.set(tabId, true)
  connectControl() // open the control channel once we're capturing
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

async function forward(record) {
  const url = await receiverUrl()
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    })
  } catch (e) {
    console.warn("[hackbrowser] forward failed", e)
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
    countByTab.set(tabId, (countByTab.get(tabId) || 0) + 1)
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
      // enrichment fields — filled in later phases (multi-credential, panel triggers)
      credentialId: null,
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
  countByTab.delete(tabId)
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
        count: tabId !== undefined ? countByTab.get(tabId) || 0 : 0,
        driver: tabId !== undefined ? driverByTab.get(tabId) || "ai" : "ai",
      })
      return
    }
    if (msg.type === "set-driver") {
      const tabId = sender.tab && sender.tab.id
      if (tabId !== undefined) driverByTab.set(tabId, msg.driver === "human" ? "human" : "ai")
      sendResponse({
        attached: tabId !== undefined && attached.has(tabId),
        count: tabId !== undefined ? countByTab.get(tabId) || 0 : 0,
        driver: tabId !== undefined ? driverByTab.get(tabId) || "ai" : "ai",
      })
      return
    }
    if (msg.type === "observe") {
      const tabId = sender.tab && sender.tab.id
      const base = await receiverUrl()
      const obsUrl = base.replace(/\/capture$/, "/observe")
      try {
        await fetch(obsUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...msg.observation, driver: tabId !== undefined ? driverByTab.get(tabId) || "ai" : "ai" }),
        })
      } catch (e) {
        // receiver down — observation is best-effort
      }
      sendResponse({ ok: true })
      return
    }
    sendResponse({ ok: false, error: "unknown message" })
  })()
  return true // async sendResponse
})
