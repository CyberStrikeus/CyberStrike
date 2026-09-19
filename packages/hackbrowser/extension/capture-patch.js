// CyberStrike HackBrowser — MAIN-world capture patch.
//
// Runs in the PAGE's JS context (world: MAIN) and wraps fetch + XMLHttpRequest so
// we can read DYNAMIC request/response bodies WITHOUT chrome.debugger — so no
// "…started debugging this browser" bar (like Claude-in-Chrome, which doesn't use
// the debugger either). Static assets aren't captured here (they aren't page-JS
// requests); their metadata comes from webRequest and their bodies are pulled later
// via http_replay. Findings are posted to the isolated content script via
// window.postMessage, which relays them to the background.

;(function () {
  // Idempotent: the popup may re-inject this (fresh --load-extension profiles miss the
  // first injection). Wrapping fetch/XHR twice would double-report, so run once.
  if (window.__csCapturePatched) return
  window.__csCapturePatched = true

  const MARK = "__cs_capture"
  function post(rec) {
    try {
      window.postMessage({ [MARK]: rec }, window.location.origin || "*")
    } catch {
      // ignore — best effort
    }
  }

  // Native JS dialogs (alert / confirm / prompt) are BROWSER CHROME, not DOM — the content script
  // can't see or click the OK button, and each one BLOCKS the page's JS thread synchronously, which
  // stalls the whole co-driving loop (no observe, no act) until a human dismisses it. Override them
  // here (MAIN world, document_start — before page scripts run) so they never block:
  //   alert   → no-op            (page continues)
  //   confirm → false (Cancel)   safe default, mirroring the guard's "destructive needs human confirm"
  //   prompt  → null  (Cancel)
  // Each is still REPORTED (an XSS alert(document.cookie) PoC stays visible in the HBLog) — the
  // dialog is suppressed, not hidden. NOTE: beforeunload ("Leave site?") is NOT handled yet.
  function reportDialog(kind, message) {
    try {
      window.postMessage({ __cs_dialog: { kind, message: String(message == null ? "" : message).slice(0, 500) } }, window.location.origin || "*")
    } catch {
      // ignore — best effort
    }
  }
  try {
    window.alert = function (m) {
      reportDialog("alert", m)
    }
    window.confirm = function (m) {
      reportDialog("confirm", m)
      return false
    }
    window.prompt = function (m) {
      reportDialog("prompt", m)
      return null
    }
  } catch {
    // a page that froze these properties → leave them; best effort
  }

  // Header keys MUST be lowercased — background.js merges these with webRequest's
  // lowercased headers via Object.assign; mismatched case would keep BOTH keys and
  // emit duplicate Authorization/Cookie lines in the raw HTTP.
  function headersToObj(h) {
    const o = {}
    try {
      h.forEach((v, k) => (o[String(k).toLowerCase()] = v))
    } catch {}
    return o
  }
  function parseXhrHeaders(s) {
    const o = {}
    ;(s || "")
      .trim()
      .split(/\r?\n/)
      .forEach((line) => {
        const i = line.indexOf(":")
        if (i > 0) o[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
      })
    return o
  }
  function bodyString(b) {
    return typeof b === "string" ? b : null
  }
  // Absolute URL so it matches webRequest's URL (which is always absolute) for the
  // header merge in the background.
  function absUrl(u) {
    try {
      return new URL(u, location.href).href
    } catch {
      return u || ""
    }
  }
  // JS-set request headers (Authorization, Content-Type, custom). Cookie and other
  // browser-managed headers are NOT visible here — those come from webRequest.
  function reqHeaders(init, input) {
    const h = {}
    const src = (init && init.headers) || (input && input.headers)
    if (!src) return h
    try {
      // lowercase keys — see headersToObj note (background merge dedups by key)
      if (typeof Headers !== "undefined" && src instanceof Headers) src.forEach((v, k) => (h[String(k).toLowerCase()] = v))
      else if (Array.isArray(src)) src.forEach((p) => (h[String(p[0]).toLowerCase()] = p[1]))
      else Object.keys(src).forEach((k) => (h[k.toLowerCase()] = src[k]))
    } catch {}
    return h
  }

  // --- fetch ---
  const origFetch = window.fetch
  if (origFetch) {
    window.fetch = function (...args) {
      const input = args[0]
      const init = args[1] || {}
      const url = typeof input === "string" ? input : input && input.url
      const method = (init.method || (input && input.method) || "GET").toUpperCase()
      const reqBody = bodyString(init.body)
      return origFetch.apply(this, args).then((res) => {
        try {
          const clone = res.clone()
          clone
            .text()
            .then((body) => {
              post({
                kind: "fetch",
                url: absUrl(url || (res && res.url) || ""),
                method,
                requestHeaders: reqHeaders(init, input),
                requestBody: reqBody,
                status: res.status,
                responseHeaders: headersToObj(res.headers),
                responseBody: body,
              })
            })
            .catch(() => {})
        } catch {}
        return res
      })
    }
  }

  // --- SPA navigation signal ---
  // pushState/replaceState fire in the PAGE's world, invisible to the isolated
  // content script. Wrap them here and post a nav marker so content.js can end the
  // trigger-correlation window on a real client-side navigation.
  function postNav() {
    try {
      window.postMessage({ __cs_nav: 1 }, window.location.origin || "*")
    } catch {}
  }
  for (const m of ["pushState", "replaceState"]) {
    const orig = history[m]
    if (typeof orig === "function") {
      history[m] = function () {
        const r = orig.apply(this, arguments)
        postNav()
        return r
      }
    }
  }
  window.addEventListener("popstate", postNav)

  // --- XMLHttpRequest ---
  const origOpen = XMLHttpRequest.prototype.open
  const origSend = XMLHttpRequest.prototype.send
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__cs = { method: (method || "GET").toUpperCase(), url }
    this.__csH = {}
    return origOpen.apply(this, arguments)
  }
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (!this.__csH) this.__csH = {}
    this.__csH[String(k).toLowerCase()] = v // lowercase — background merge dedups by key
    return origSetHeader.apply(this, arguments)
  }
  XMLHttpRequest.prototype.send = function (body) {
    const self = this
    this.addEventListener("load", function () {
      if (!self.__cs) return
      let respBody = ""
      try {
        respBody = self.responseType === "" || self.responseType === "text" ? self.responseText : ""
      } catch {}
      post({
        kind: "xhr",
        url: absUrl(self.__cs.url),
        method: self.__cs.method,
        requestHeaders: self.__csH || {},
        requestBody: bodyString(body),
        status: self.status,
        responseHeaders: parseXhrHeaders(self.getAllResponseHeaders()),
        responseBody: respBody,
      })
    })
    return origSend.apply(this, arguments)
  }
})()
