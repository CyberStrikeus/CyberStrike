// CyberStrike HackBrowser 2.0 — MAIN-world capture patch.
//
// Runs in the PAGE's JS context (world: MAIN) and wraps fetch + XMLHttpRequest so
// we can read DYNAMIC request/response bodies WITHOUT chrome.debugger — so no
// "…started debugging this browser" bar (like Claude-in-Chrome, which doesn't use
// the debugger either). Static assets aren't captured here (they aren't page-JS
// requests); their metadata comes from webRequest and their bodies are pulled later
// via http_replay. Findings are posted to the isolated content script via
// window.postMessage, which relays them to the background.

;(function () {
  const MARK = "__cs_capture"
  function post(rec) {
    try {
      window.postMessage({ [MARK]: rec }, window.location.origin || "*")
    } catch {
      // ignore — best effort
    }
  }

  function headersToObj(h) {
    const o = {}
    try {
      h.forEach((v, k) => (o[k] = v))
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
                url: url || (res && res.url) || "",
                method,
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

  // --- XMLHttpRequest ---
  const origOpen = XMLHttpRequest.prototype.open
  const origSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__cs = { method: (method || "GET").toUpperCase(), url }
    return origOpen.apply(this, arguments)
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
        url: self.__cs.url,
        method: self.__cs.method,
        requestBody: bodyString(body),
        status: self.status,
        responseHeaders: parseXhrHeaders(self.getAllResponseHeaders()),
        responseBody: respBody,
      })
    })
    return origSend.apply(this, arguments)
  }
})()
