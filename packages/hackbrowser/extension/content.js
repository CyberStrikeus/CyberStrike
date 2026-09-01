// CyberStrike HackBrowser 2.0 — panel (content script).
//
// Injects a small status panel on every page (§S4: panel always via content
// script, never CDP — leak-free, works on real Chrome and CfT alike). Houses the
// co-driving handover toggle: even before the AI control loop exists, flipping to
// "You're driving" tags captured traffic as driver:"human", so human-found requests
// are distinguishable from AI-found ones (§6.4 blind-spot signal).
//
// Isolated in a shadow root so the target page's CSS can't touch it.

;(function () {
  if (window !== window.top) return // top frame only

  const host = document.createElement("div")
  host.id = "cyberstrike-panel-host"
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;"
  const root = host.attachShadow({ mode: "closed" })

  root.innerHTML = `
    <style>
      :host { all: initial; }
      .panel {
        font: 12px system-ui, sans-serif;
        background: #0b0f14; color: #d7e0ea;
        border: 1px solid #24313d; border-radius: 10px;
        padding: 10px 12px; width: 200px;
        box-shadow: 0 8px 28px rgba(0,0,0,.45);
      }
      .row { display: flex; align-items: center; gap: 6px; }
      .title { color: #4ade80; font-weight: 700; letter-spacing: .04em; font-size: 11px; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7684; }
      .dot.on { background: #4ade80; }
      .count { margin-left: auto; font-variant-numeric: tabular-nums; color: #8aa0b4; }
      button {
        width: 100%; margin-top: 9px; padding: 7px; border: 0; border-radius: 7px;
        font-weight: 600; cursor: pointer; background: #1f6feb; color: #fff;
      }
      button.human { background: #d29922; color: #1a1205; }
      .hint { margin-top: 6px; font-size: 10px; color: #6b7684; }
    </style>
    <div class="panel">
      <div class="row">
        <span class="dot" id="dot"></span>
        <span class="title">CYBERSTRIKE</span>
        <span class="count" id="count">0</span>
      </div>
      <button id="handover">AI is driving</button>
      <div class="hint" id="hint">capture attached to this tab</div>
      <div class="hint" id="obs">observing…</div>
    </div>
  `
  const dot = root.getElementById("dot")
  const count = root.getElementById("count")
  const handover = root.getElementById("handover")
  const hint = root.getElementById("hint")
  const obsLine = root.getElementById("obs")

  let driver = "ai"

  function render(status) {
    if (status && status.attached) {
      dot.classList.add("on")
    } else {
      dot.classList.remove("on")
    }
    if (status && typeof status.count === "number") count.textContent = String(status.count)
    if (status && status.driver) driver = status.driver
    if (driver === "human") {
      handover.textContent = "You're driving — give back to AI"
      handover.classList.add("human")
      hint.textContent = "your clicks are captured as 'human'"
    } else {
      handover.textContent = "AI is driving — take over"
      handover.classList.remove("human")
      hint.textContent = "capture attached to this tab"
    }
  }

  handover.addEventListener("click", () => {
    driver = driver === "ai" ? "human" : "ai"
    chrome.runtime.sendMessage({ type: "set-driver", driver }, (res) => render(res))
  })

  // --- Deterministic page observation (§3.3) --------------------------------
  // Extract clickables/forms/links from the DOM with no LLM. This is the state
  // the AI will later pull via get_page_state instead of re-reading the page.

  function visible(el) {
    if (!el || el.offsetParent === null) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }

  function labelOf(el) {
    const raw =
      el.getAttribute("aria-label") ||
      (el.innerText || "").trim() ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      el.getAttribute("value") ||
      ""
    return raw.replace(/\s+/g, " ").trim().slice(0, 80)
  }

  // elementId → live DOM node, so a click/type command can resolve the element
  // the AI referenced from page-state. Rebuilt on every observation.
  const elMap = new Map()

  function observePage() {
    const clickSel = "a[href],button,[role=button],input[type=submit],input[type=button],[onclick]"
    const clickables = []
    elMap.clear()
    let i = 0
    for (const el of document.querySelectorAll(clickSel)) {
      if (!visible(el)) continue
      const eid = "E" + i++
      elMap.set(eid, el)
      clickables.push({
        id: eid,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || "",
        label: labelOf(el),
        href: el.getAttribute("href") || "",
      })
      if (i >= 300) break
    }

    const forms = []
    for (const f of document.querySelectorAll("form")) {
      if (forms.length >= 40) break
      const fields = []
      for (const el of f.elements) {
        if (!el.name && !el.id) continue
        fields.push({
          name: el.name || el.id,
          type: (el.getAttribute("type") || el.tagName).toLowerCase(),
          required: el.hasAttribute("required"),
        })
      }
      forms.push({ action: f.getAttribute("action") || "", method: (f.getAttribute("method") || "get").toLowerCase(), fields })
    }

    const links = []
    const seen = new Set()
    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.href
      if (!href || seen.has(href)) continue
      seen.add(href)
      links.push(href)
      if (links.length >= 300) break
    }

    return { url: location.href, title: document.title, clickables, forms, links }
  }

  function sendObservation() {
    const obs = observePage()
    chrome.runtime.sendMessage({ type: "observe", observation: obs }, () => {
      if (chrome.runtime.lastError) return
    })
    return obs
  }

  // Execute a guard-approved command (background already relayed only allowed ones).
  // First cut uses plain DOM dispatch; human-like CDP bezier/keystroke is future work.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== "perform") return
    const cmd = msg.cmd || {}
    try {
      if (cmd.op === "click") {
        const el = elMap.get(cmd.elementId)
        if (!el) {
          sendResponse({ ok: false, error: "element not found" })
          return
        }
        el.scrollIntoView({ block: "center" })
        el.click()
        sendResponse({ ok: true })
        return
      }
      if (cmd.op === "type") {
        const el = elMap.get(cmd.elementId)
        if (!el) {
          sendResponse({ ok: false, error: "element not found" })
          return
        }
        el.focus()
        el.value = cmd.text || ""
        el.dispatchEvent(new Event("input", { bubbles: true }))
        el.dispatchEvent(new Event("change", { bubbles: true }))
        sendResponse({ ok: true })
        return
      }
      if (cmd.op === "navigate") {
        if (!cmd.url) {
          sendResponse({ ok: false, error: "url required" })
          return
        }
        location.href = cmd.url
        sendResponse({ ok: true })
        return
      }
      sendResponse({ ok: false, error: "unknown op" })
    } catch (e) {
      sendResponse({ ok: false, error: String(e) })
    }
  })

  let lastObs = null
  let lastUrl = location.href

  function showObs(obs) {
    if (!obs) return
    obsLine.textContent = `${obs.clickables.length} clickables · ${obs.forms.length} forms · ${obs.links.length} links`
  }

  function poll() {
    chrome.runtime.sendMessage({ type: "panel-status" }, (res) => {
      if (chrome.runtime.lastError) return // service worker asleep — try next tick
      render(res)
    })
    // SPA route change without full reload → re-observe (§3.3 re-snapshot).
    if (location.href !== lastUrl) {
      lastUrl = location.href
      lastObs = sendObservation()
      showObs(lastObs)
    }
  }

  function mount() {
    if (!document.body) return
    if (document.getElementById("cyberstrike-panel-host")) return
    document.body.appendChild(host)
    poll()
    lastObs = sendObservation()
    showObs(lastObs)
    setInterval(poll, 1500)
  }

  if (document.body) mount()
  else document.addEventListener("DOMContentLoaded", mount)
})()
