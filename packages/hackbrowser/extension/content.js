// CyberStrike HackBrowser 2.0 — panel (content script).
//
// A Vercel-toolbar-style dock: a small floating pill in the corner (collapsed)
// that expands into a panel on click. Injected on every page in a closed shadow
// root so the target page's CSS can't touch it. Houses the co-driving handover
// toggle and shows live capture/observation state.
//
// Deterministic observation (§3.3) + the perform executor live here too; only the
// UI is toolbar-styled — the capture/observe/command logic is unchanged.

;(function () {
  if (window !== window.top) return // top frame only

  const host = document.createElement("div")
  host.id = "cyberstrike-panel-host"
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;"
  const root = host.attachShadow({ mode: "closed" })

  // CyberStrike logo (bundled, exposed via web_accessible_resources).
  const LOGO = `<img class="logo" src="${chrome.runtime.getURL("logo.png")}" width="18" height="18" alt="" draggable="false" />`

  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .dock {
        --bg: #0b0f14; --panel: #0f161d; --line: #1e2a36;
        --text: #d7e0ea; --dim: #8aa0b4; --faint: #6b7684;
        --on: #4ade80; --human: #f0b429; --accent: #1f6feb;
        font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif;
        color: var(--text);
        display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
      }

      /* Collapsed pill */
      .fab {
        display: inline-flex; align-items: center; gap: 8px;
        height: 34px; padding: 0 12px 0 10px;
        background: var(--bg); color: var(--dim);
        border: 1px solid var(--line); border-radius: 999px;
        cursor: grab; user-select: none;
        box-shadow: 0 4px 16px rgba(0,0,0,.4);
        transition: transform .15s ease, border-color .15s ease, color .15s ease;
      }
      .fab:hover { transform: translateY(-1px); border-color: #2b3a49; }
      .fab:active { cursor: grabbing; }
      .phead { cursor: grab; }
      .phead:active { cursor: grabbing; }
      .mark { display: inline-flex; }
      .mark .logo { display: block; width: 18px; height: 18px; }
      .dock.capturing .mark .logo { animation: pulse 1.8s ease-in-out infinite; }
      .label { font-weight: 600; letter-spacing: .02em; }
      .count {
        min-width: 18px; text-align: center; padding: 1px 6px;
        font-variant-numeric: tabular-nums; font-size: 11px;
        background: #16212b; border-radius: 999px; color: var(--dim);
      }
      .dock.capturing .count { color: var(--on); }

      @keyframes pulse {
        0%, 100% { opacity: 1; filter: drop-shadow(0 0 0 rgba(74,222,128,0)); }
        50% { opacity: .75; filter: drop-shadow(0 0 4px rgba(74,222,128,.6)); }
      }

      /* Expanded panel */
      .panel {
        width: 236px; background: var(--panel);
        border: 1px solid var(--line); border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,.5);
        overflow: hidden;
        transform-origin: bottom right;
        transition: opacity .16s ease, transform .16s ease;
      }
      .dock:not(.open) .panel {
        opacity: 0; transform: translateY(6px) scale(.97);
        pointer-events: none; height: 0; border: 0; margin: 0;
      }
      .phead {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 12px; border-bottom: 1px solid var(--line);
      }
      .phead .mark { color: var(--faint); }
      .dock.capturing .phead .mark { color: var(--on); }
      .brand { font-weight: 700; letter-spacing: .06em; font-size: 11px; }
      .pill {
        margin-left: auto; font-size: 10px; padding: 2px 7px; border-radius: 999px;
        background: #16212b; color: var(--dim);
      }
      .dock.capturing .pill { background: rgba(74,222,128,.12); color: var(--on); }
      .pbody { padding: 11px 12px; display: flex; flex-direction: column; gap: 10px; }
      .stat { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--dim); }
      .stat b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
      .obs { font-size: 10px; color: var(--faint); }
      button.act {
        width: 100%; padding: 8px; border: 0; border-radius: 8px;
        font: 600 12px system-ui, sans-serif; cursor: pointer;
        background: var(--accent); color: #fff;
        transition: filter .15s ease;
      }
      button.act:hover { filter: brightness(1.08); }
      button.act.human { background: var(--human); color: #1a1205; }
    </style>

    <div class="dock" id="dock">
      <div class="panel" id="panel">
        <div class="phead">
          <span class="mark">${LOGO}</span>
          <span class="brand">CYBERSTRIKE</span>
          <span class="pill" id="pill">detached</span>
        </div>
        <div class="pbody">
          <div class="stat">captured <b id="pcount">0</b></div>
          <div class="obs" id="obs">observing…</div>
          <button class="act" id="handover">AI is driving — take over</button>
        </div>
      </div>
      <div class="fab" id="fab">
        <span class="mark">${LOGO}</span>
        <span class="label">CS</span>
        <span class="count" id="fcount">0</span>
      </div>
    </div>
  `

  const dock = root.getElementById("dock")
  const fab = root.getElementById("fab")
  const panel = root.getElementById("panel")
  const pill = root.getElementById("pill")
  const fcount = root.getElementById("fcount")
  const pcount = root.getElementById("pcount")
  const handover = root.getElementById("handover")
  const obsLine = root.getElementById("obs")

  let driver = "ai"
  let expanded = false

  function applyDriverClass() {
    dock.classList.toggle("human", driver === "human")
  }

  function render(status) {
    const attached = !!(status && status.attached)
    dock.classList.toggle("capturing", attached && driver !== "human")
    if (status && typeof status.count === "number") {
      fcount.textContent = String(status.count)
      pcount.textContent = String(status.count)
    }
    if (status && status.driver) driver = status.driver
    applyDriverClass()
    pill.textContent = driver === "human" ? "you drive" : attached ? "capturing" : "detached"
    if (driver === "human") {
      handover.textContent = "You're driving — give back to AI"
      handover.classList.add("human")
    } else {
      handover.textContent = "AI is driving — take over"
      handover.classList.remove("human")
    }
  }

  // --- Drag to reposition (like the 1.x draggable bar) ----------------------
  // The dock can be dragged anywhere; a click that didn't move toggles expand.
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
    // switch from right/bottom anchoring to absolute left/top
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
    let left = origLeft + dx
    let top = origTop + dy
    // keep it on-screen
    const w = host.offsetWidth
    const h = host.offsetHeight
    left = Math.max(4, Math.min(left, window.innerWidth - w - 4))
    top = Math.max(4, Math.min(top, window.innerHeight - h - 4))
    host.style.left = left + "px"
    host.style.top = top + "px"
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
      return // was a drag, not a click
    }
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

  function showObs(obs) {
    if (!obs) return
    obsLine.textContent = `${obs.clickables.length} clickables · ${obs.forms.length} forms · ${obs.links.length} links`
  }

  function poll() {
    chrome.runtime.sendMessage({ type: "panel-status" }, (res) => {
      if (chrome.runtime.lastError) return
      render(res)
    })
    if (location.href !== lastUrl) {
      lastUrl = location.href
      showObs(sendObservation())
    }
  }

  function mount() {
    if (!document.body) return
    if (document.getElementById("cyberstrike-panel-host")) return
    document.body.appendChild(host)
    readCredFromHash()
    poll()
    showObs(sendObservation())
    setInterval(poll, 1500)
  }

  if (document.body) mount()
  else document.addEventListener("DOMContentLoaded", mount)
})()
