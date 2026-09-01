// CyberStrike HackBrowser 2.0 — panel (content script).
//
// A logo dock: a large CyberStrike mark sits in a corner; clicking it expands a
// panel HORIZONTALLY toward screen-center (left if docked right, right if docked
// left). The panel shows the capture breakdown (captured / API / JS / static /
// page elements), computed by the background from resource_type. When a tab is
// being captured a hue floats around the viewport edges — navy for AI-driven,
// amber for human (co-driving handover). Injected in a closed shadow root.

;(function () {
  if (window !== window.top) return // top frame only

  const LOGO_SRC = chrome.runtime.getURL("logo.png")

  // --- Edge glow overlay (like Claude-in-Chrome's border hue) ---------------
  const glowHost = document.createElement("div")
  glowHost.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;"
  const glowRoot = glowHost.attachShadow({ mode: "closed" })
  glowRoot.innerHTML = `
    <style>
      .glow {
        position: fixed; inset: 0; pointer-events: none;
        opacity: 0; transition: opacity .4s ease, box-shadow .4s ease;
      }
      .glow.on { opacity: 1; animation: breathe 3s ease-in-out infinite; }
      .glow.ai { box-shadow: inset 0 0 46px 8px rgba(37,99,235,.55); }
      .glow.human { box-shadow: inset 0 0 46px 8px rgba(240,180,41,.55); }
      @keyframes breathe { 0%,100% { opacity: .9; } 50% { opacity: .45; } }
    </style>
    <div class="glow" id="glow"></div>
  `
  const glow = glowRoot.getElementById("glow")

  // --- Dock (logo + panel) --------------------------------------------------
  const host = document.createElement("div")
  host.id = "cyberstrike-panel-host"
  host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;"
  const root = host.attachShadow({ mode: "closed" })

  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .dock {
        --panel: #0f161d; --line: #1e2a36; --text: #d7e0ea;
        --dim: #8aa0b4; --faint: #6b7684;
        --ai: #2563eb; --human: #f0b429;
        font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif;
        color: var(--text);
        display: flex; align-items: flex-end; gap: 12px;
      }
      .dock.left { flex-direction: row; }          /* logo left  → panel right */
      .dock.right { flex-direction: row-reverse; } /* logo right → panel left  */

      /* Big logo button */
      .fab {
        flex: none; width: 54px; height: 54px; padding: 0;
        display: inline-flex; align-items: center; justify-content: center;
        background: transparent; border: 0; cursor: grab; user-select: none;
        filter: drop-shadow(0 4px 12px rgba(0,0,0,.5));
        transition: transform .15s ease;
      }
      .fab:hover { transform: scale(1.06); }
      .fab:active { cursor: grabbing; }
      .fab img { width: 54px; height: 54px; display: block; pointer-events: none; }
      .dock.capturing.driver-ai .fab img { animation: pulse 1.8s ease-in-out infinite; }
      .dock.capturing.driver-human .fab img { animation: pulse 1.8s ease-in-out infinite; }
      @keyframes pulse {
        0%,100% { filter: drop-shadow(0 0 0 transparent); opacity: 1; }
        50% { filter: drop-shadow(0 0 6px rgba(255,255,255,.5)); opacity: .8; }
      }

      /* Panel */
      .panel {
        width: 248px; background: var(--panel);
        border: 1px solid var(--line); border-radius: 12px;
        box-shadow: 0 14px 44px rgba(0,0,0,.5);
        overflow: hidden;
        transform-origin: bottom center;
        transition: opacity .16s ease, transform .16s ease, width .16s ease;
      }
      .dock:not(.open) .panel {
        opacity: 0; width: 0; border: 0; padding: 0;
        transform: scale(.97); pointer-events: none;
      }
      .phead {
        display: flex; align-items: center; gap: 8px;
        padding: 11px 13px; border-bottom: 1px solid var(--line);
        cursor: grab;
      }
      .phead:active { cursor: grabbing; }
      .brand { font-weight: 700; letter-spacing: .07em; font-size: 11px; white-space: nowrap; }
      .state {
        margin-left: auto; font-size: 10px; padding: 2px 8px; border-radius: 999px;
        background: #16212b; color: var(--dim); white-space: nowrap;
      }
      .dock.capturing.driver-ai .state { background: rgba(37,99,235,.15); color: #7ea8ff; }
      .dock.capturing.driver-human .state { background: rgba(240,180,41,.15); color: var(--human); }

      .pbody { padding: 12px 13px; display: flex; flex-direction: column; gap: 2px; }
      .stat {
        display: flex; align-items: baseline; justify-content: space-between;
        padding: 5px 0; border-bottom: 1px dashed #17222d;
      }
      .stat:last-of-type { border-bottom: 0; }
      .stat .k { color: var(--dim); font-size: 11px; }
      .stat .v { color: var(--text); font-weight: 700; font-variant-numeric: tabular-nums; }
      .stat .v.accent { color: #7ea8ff; }

      button.act {
        margin-top: 10px; width: 100%; padding: 9px; border: 0; border-radius: 9px;
        font: 700 12px system-ui, sans-serif; cursor: pointer;
        background: var(--ai); color: #fff; transition: filter .15s ease;
      }
      button.act:hover { filter: brightness(1.08); }
      button.act.human { background: var(--human); color: #1a1205; }
    </style>

    <div class="dock right" id="dock">
      <div class="panel" id="panel">
        <div class="phead">
          <span class="brand">CYBERSTRIKE</span>
          <span class="state" id="state">detached</span>
        </div>
        <div class="pbody">
          <div class="stat"><span class="k">captured</span><span class="v accent" id="s-total">0</span></div>
          <div class="stat"><span class="k">API endpoints</span><span class="v" id="s-api">0</span></div>
          <div class="stat"><span class="k">JavaScript files</span><span class="v" id="s-js">0</span></div>
          <div class="stat"><span class="k">static assets</span><span class="v" id="s-static">0</span></div>
          <div class="stat"><span class="k">page elements</span><span class="v" id="s-page">0</span></div>
          <button class="act" id="handover">AI is driving — take over</button>
        </div>
      </div>
      <button class="fab" id="fab" title="CyberStrike"><img src="${LOGO_SRC}" alt="CyberStrike" draggable="false" /></button>
    </div>
  `

  const dock = root.getElementById("dock")
  const fab = root.getElementById("fab")
  const stateEl = root.getElementById("state")
  const sTotal = root.getElementById("s-total")
  const sApi = root.getElementById("s-api")
  const sJs = root.getElementById("s-js")
  const sStatic = root.getElementById("s-static")
  const sPage = root.getElementById("s-page")
  const handover = root.getElementById("handover")

  let driver = "ai"
  let expanded = false
  let pageCount = 0

  // Dock side (left/right) from the host position — panel opens toward center.
  function updateSide() {
    const cx = host.getBoundingClientRect().left + host.offsetWidth / 2
    const onRight = cx > window.innerWidth / 2
    dock.classList.toggle("right", onRight)
    dock.classList.toggle("left", !onRight)
  }

  function render(status) {
    const attached = !!(status && status.attached)
    if (status && status.driver) driver = status.driver
    dock.classList.toggle("capturing", attached)
    dock.classList.toggle("driver-ai", driver !== "human")
    dock.classList.toggle("driver-human", driver === "human")

    if (status && status.stats) {
      const st = status.stats
      sTotal.textContent = st.total || 0
      sApi.textContent = st.api || 0
      sJs.textContent = st.js || 0
      sStatic.textContent = st.static || 0
    }
    sPage.textContent = pageCount

    stateEl.textContent = !attached ? "detached" : driver === "human" ? "you drive" : "AI driving"
    handover.textContent = driver === "human" ? "You're driving — give back to AI" : "AI is driving — take over"
    handover.classList.toggle("human", driver === "human")

    // Edge glow: navy when AI-driven, amber when human — only while capturing.
    glow.classList.toggle("on", attached)
    glow.classList.toggle("ai", attached && driver !== "human")
    glow.classList.toggle("human", attached && driver === "human")
  }

  // --- Drag ------------------------------------------------------------------
  let dragging = false
  let moved = false
  let startX = 0
  let startY = 0
  let origLeft = 0
  let origTop = 0

  function onDragStart(e) {
    dragging = true
    moved = false
    const p = e.touches ? e.touches[0] : e
    startX = p.clientX
    startY = p.clientY
    const r = host.getBoundingClientRect()
    origLeft = r.left
    origTop = r.top
    host.style.left = origLeft + "px"
    host.style.top = origTop + "px"
    host.style.right = "auto"
    host.style.bottom = "auto"
    e.preventDefault()
  }
  function onDragMove(e) {
    if (!dragging) return
    const p = e.touches ? e.touches[0] : e
    const dx = p.clientX - startX
    const dy = p.clientY - startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true
    let left = Math.max(4, Math.min(origLeft + dx, window.innerWidth - host.offsetWidth - 4))
    let top = Math.max(4, Math.min(origTop + dy, window.innerHeight - host.offsetHeight - 4))
    host.style.left = left + "px"
    host.style.top = top + "px"
    updateSide()
  }
  function onDragEnd() {
    dragging = false
  }

  fab.addEventListener("mousedown", onDragStart)
  fab.addEventListener("touchstart", onDragStart, { passive: false })
  const phead = root.querySelector(".phead")
  if (phead) {
    phead.addEventListener("mousedown", onDragStart)
    phead.addEventListener("touchstart", onDragStart, { passive: false })
  }
  document.addEventListener("mousemove", onDragMove)
  document.addEventListener("touchmove", onDragMove, { passive: false })
  document.addEventListener("mouseup", onDragEnd)
  document.addEventListener("touchend", onDragEnd)

  fab.addEventListener("click", () => {
    if (moved) {
      moved = false
      return
    }
    updateSide()
    expanded = !expanded
    dock.classList.toggle("open", expanded)
  })

  handover.addEventListener("click", (e) => {
    e.stopPropagation()
    driver = driver === "ai" ? "human" : "ai"
    chrome.runtime.sendMessage({ type: "set-driver", driver }, (res) => render(res))
  })

  // --- Deterministic page observation (§3.3) --------------------------------
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
      clickables.push({ id: eid, tag: el.tagName.toLowerCase(), role: el.getAttribute("role") || "", label: labelOf(el), href: el.getAttribute("href") || "" })
      if (i >= 300) break
    }
    const forms = []
    for (const f of document.querySelectorAll("form")) {
      if (forms.length >= 40) break
      const fields = []
      for (const el of f.elements) {
        if (!el.name && !el.id) continue
        fields.push({ name: el.name || el.id, type: (el.getAttribute("type") || el.tagName).toLowerCase(), required: el.hasAttribute("required") })
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
    pageCount = obs.clickables.length + obs.forms.length
    chrome.runtime.sendMessage({ type: "observe", observation: obs }, () => void chrome.runtime.lastError)
    return obs
  }

  // Execute a guard-approved command (background relays only allowed ones).
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== "perform") return
    const cmd = msg.cmd || {}
    try {
      if (cmd.op === "click") {
        const el = elMap.get(cmd.elementId)
        if (!el) return sendResponse({ ok: false, error: "element not found" })
        el.scrollIntoView({ block: "center" })
        el.click()
        return sendResponse({ ok: true })
      }
      if (cmd.op === "type") {
        const el = elMap.get(cmd.elementId)
        if (!el) return sendResponse({ ok: false, error: "element not found" })
        el.focus()
        el.value = cmd.text || ""
        el.dispatchEvent(new Event("input", { bubbles: true }))
        el.dispatchEvent(new Event("change", { bubbles: true }))
        return sendResponse({ ok: true })
      }
      if (cmd.op === "navigate") {
        if (!cmd.url) return sendResponse({ ok: false, error: "url required" })
        location.href = cmd.url
        return sendResponse({ ok: true })
      }
      sendResponse({ ok: false, error: "unknown op" })
    } catch (e) {
      sendResponse({ ok: false, error: String(e) })
    }
  })

  // Launcher-injected credential: #__cs_cred=<label> → self-register + strip.
  function readCredFromHash() {
    const m = location.hash.match(/__cs_cred=([^&]+)/)
    if (!m) return
    let label
    try {
      label = decodeURIComponent(m[1])
    } catch {
      label = m[1]
    }
    history.replaceState(null, "", location.pathname + location.search || "/")
    if (label) chrome.runtime.sendMessage({ type: "set-credential-label", label }, () => void chrome.runtime.lastError)
  }

  let lastUrl = location.href
  function poll() {
    chrome.runtime.sendMessage({ type: "panel-status" }, (res) => {
      if (chrome.runtime.lastError) return
      render(res)
    })
    if (location.href !== lastUrl) {
      lastUrl = location.href
      sendObservation()
    }
  }

  function mount() {
    if (!document.body) return
    if (document.getElementById("cyberstrike-panel-host")) return
    document.body.appendChild(glowHost)
    document.body.appendChild(host)
    readCredFromHash()
    updateSide()
    sendObservation()
    poll()
    setInterval(poll, 1500)
  }

  if (document.body) mount()
  else document.addEventListener("DOMContentLoaded", mount)
})()
