// CyberStrike HackBrowser 2.0 — panel (content script).
//
// Interaction:
//   - a large transparent CyberStrike logo sits in a corner (draggable)
//   - hover reveals a small toolbar toward center: captured count + settings gear
//   - clicking the logo TOGGLES the driver (AI <-> Human) and flashes a soft
//     center-screen line ("AI Driving the session" / "Human Driving the session")
//   - the settings gear opens the breakdown panel (captured/API/JS/static/page)
//   - while capturing, a very faint edge hue floats around the viewport:
//     navy for AI-driven, amber for human
// Everything is injected in closed shadow roots.

;(function () {
  if (window !== window.top) return

  const LOGO_SRC = chrome.runtime.getURL("logo.png")

  // Driver palette — one source for the three shadow roots (glow, transition, dock),
  // which can't share CSS vars because each has its own <style>.
  const AI_RGB = "37,99,235"
  const HUMAN_RGB = "240,180,41"
  const AI_TINT = "#7ea8ff"

  // --- Edge glow (very faint) -----------------------------------------------
  const glowHost = document.createElement("div")
  glowHost.style.cssText = "position:fixed;inset:0;z-index:2147483645;pointer-events:none;"
  const glowRoot = glowHost.attachShadow({ mode: "closed" })
  glowRoot.innerHTML = `
    <style>
      .glow { position: fixed; inset: 0; pointer-events: none; opacity: 0; transition: opacity .6s ease; }
      .glow.on { animation: breathe 4s ease-in-out infinite; }
      .glow.ai { box-shadow: inset 0 0 56px 12px rgba(${AI_RGB},.5); }
      .glow.human { box-shadow: inset 0 0 56px 12px rgba(${HUMAN_RGB},.5); }
      @keyframes breathe { 0%,100% { opacity: .95; } 50% { opacity: .6; } }
    </style>
    <div class="glow" id="glow"></div>
  `
  const glow = glowRoot.getElementById("glow")

  // --- Center transition line ------------------------------------------------
  const transHost = document.createElement("div")
  transHost.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;"
  const transRoot = transHost.attachShadow({ mode: "closed" })
  transRoot.innerHTML = `
    <style>
      .trans {
        position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
        pointer-events: none; opacity: 0; transition: opacity .45s ease, transform .45s ease;
        transform: scale(.98);
      }
      .trans.show { opacity: 1; transform: scale(1); }
      .msg {
        font: 600 19px ui-sans-serif, system-ui, -apple-system, sans-serif;
        text-transform: uppercase; letter-spacing: .18em;
        color: rgba(255,255,255,.95); text-shadow: 0 2px 30px rgba(0,0,0,.6);
        padding: 15px 30px; border-radius: 12px;
        background: rgba(10,14,20,.4); backdrop-filter: blur(3px);
      }
      .msg.ai { box-shadow: 0 0 0 1px rgba(${AI_RGB},.35), 0 8px 40px rgba(${AI_RGB},.2); }
      .msg.human { box-shadow: 0 0 0 1px rgba(${HUMAN_RGB},.35), 0 8px 40px rgba(${HUMAN_RGB},.2); }
    </style>
    <div class="trans" id="trans"><div class="msg" id="msg"></div></div>
  `
  const trans = transRoot.getElementById("trans")
  const msg = transRoot.getElementById("msg")
  let transTimer = null
  function flashTransition(text, cls) {
    msg.textContent = text
    msg.className = "msg " + cls
    trans.classList.add("show")
    if (transTimer) clearTimeout(transTimer)
    transTimer = setTimeout(() => trans.classList.remove("show"), 1400)
  }

  // --- Dock ------------------------------------------------------------------
  const host = document.createElement("div")
  host.id = "cyberstrike-panel-host"
  host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;"
  const root = host.attachShadow({ mode: "closed" })

  const GEAR = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>`

  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .dock {
        --panel: #0f161d; --line: #1e2a36; --text: #d7e0ea;
        --dim: #8aa0b4; --faint: #6b7684; --ai: #2563eb; --human: #f0b429;
        font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif;
        color: var(--text);
        display: flex; align-items: center; gap: 8px;
      }
      .dock.right { flex-direction: row-reverse; }
      .dock.left { flex-direction: row; }

      /* Round dark disc behind the logo → readable on light AND dark pages */
      .fab {
        flex: none; width: 52px; height: 52px; padding: 0; border: 0; border-radius: 50%;
        display: inline-flex; align-items: center; justify-content: center;
        background: radial-gradient(circle at 50% 40%, #141c26, #0b0f14);
        box-shadow: 0 5px 18px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.07);
        cursor: grab; user-select: none;
        transition: transform .16s ease, box-shadow .16s ease;
      }
      .fab:hover {
        transform: scale(1.09);
        box-shadow: 0 8px 24px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.14);
      }
      .fab:active { cursor: grabbing; }
      .fab img {
        width: 44px; height: 44px; display: block; pointer-events: none;
      }
      /* No rotation at all; hover just scales the disc (.fab:hover above). */
      .fab.tapped { animation: tap .32s ease; }
      @keyframes tap { 0% { transform: scale(1);} 40% { transform: scale(.84);} 100% { transform: scale(1);} }
      .dock.capturing .fab { box-shadow: 0 5px 18px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.07), 0 0 0 2px rgba(${AI_RGB},.35); }
      .dock.capturing.driver-human .fab { box-shadow: 0 5px 18px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.07), 0 0 0 2px rgba(${HUMAN_RGB},.4); }

      /* Hover toolbar: captured count + settings — absolute so it never takes
         layout space; shown via JS on hover (or while settings is open). */
      .bar {
        position: absolute; top: 50%;
        display: flex; align-items: center; gap: 6px;
        height: 30px; padding: 0 6px 0 10px;
        background: #0b0f14; border: 1px solid var(--line); border-radius: 999px;
        box-shadow: 0 4px 16px rgba(0,0,0,.4);
        opacity: 0; pointer-events: none;
        transition: opacity .15s ease, transform .15s ease;
      }
      .dock.right .bar { right: 62px; transform: translateY(-50%) translateX(6px); }
      .dock.left .bar { left: 62px; transform: translateY(-50%) translateX(-6px); }
      .dock.right .bar.show, .dock.left .bar.show { opacity: 1; transform: translateY(-50%); pointer-events: auto; }
      .cap { font-size: 11px; color: var(--dim); white-space: nowrap; }
      .cap b { color: var(--text); font-variant-numeric: tabular-nums; }
      .dock.capturing.driver-ai .cap b { color: ${AI_TINT}; }
      .dock.capturing.driver-human .cap b { color: var(--human); }
      .gear {
        display: inline-flex; align-items: center; justify-content: center;
        width: 24px; height: 24px; border: 0; border-radius: 50%;
        background: transparent; color: var(--dim); cursor: pointer;
        transition: color .15s ease, background .15s ease;
      }
      .gear:hover { color: var(--text); background: #16212b; }

      /* Settings panel (breakdown) */
      .panel {
        position: absolute; bottom: 60px; width: 244px;
        background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
        box-shadow: 0 14px 44px rgba(0,0,0,.5); overflow: hidden;
        opacity: 0; transform: translateY(6px) scale(.98); pointer-events: none;
        transition: opacity .16s ease, transform .16s ease;
      }
      .dock.right .panel { right: 0; }
      .dock.left .panel { left: 0; }
      .dock.settings .panel { opacity: 1; transform: none; pointer-events: auto; }
      .phead { display: flex; align-items: center; gap: 8px; padding: 11px 13px; border-bottom: 1px solid var(--line); }
      .brand { font-weight: 700; letter-spacing: .07em; font-size: 11px; }
      .st { margin-left: auto; font-size: 10px; padding: 2px 8px; border-radius: 999px; background: #16212b; color: var(--dim); }
      .dock.capturing.driver-ai .st { background: rgba(${AI_RGB},.15); color: ${AI_TINT}; }
      .dock.capturing.driver-human .st { background: rgba(${HUMAN_RGB},.15); color: var(--human); }
      .pbody { padding: 12px 13px; display: flex; flex-direction: column; }
      .ctl {
        width: 100%; padding: 9px; margin-bottom: 4px; border: 0; border-radius: 9px;
        font: 700 12px system-ui, sans-serif; cursor: pointer; color: #fff; background: var(--ai);
        transition: filter .15s ease;
      }
      .ctl:hover { filter: brightness(1.08); }
      .ctl.on { background: #b4232f; }
      .lbl { font-size: 10px; color: var(--faint); margin: 9px 0 3px; text-transform: uppercase; letter-spacing: .06em; }
      .fld {
        width: 100%; padding: 6px 8px; border: 1px solid var(--line); border-radius: 7px;
        background: #0b0f14; color: var(--text); font: 12px system-ui, sans-serif;
      }
      .credrow { display: flex; gap: 6px; }
      .credrow .fld { flex: 1; }
      .mini {
        padding: 0 12px; border: 0; border-radius: 7px; background: #16212b; color: var(--text);
        cursor: pointer; font: 600 11px system-ui, sans-serif;
      }
      .mini:hover { background: #1e2a36; }
      .brk { margin-top: 11px; padding-top: 6px; border-top: 1px solid var(--line); }
      .row { display: flex; justify-content: space-between; align-items: baseline; padding: 5px 0; border-bottom: 1px dashed #17222d; }
      .row:last-child { border-bottom: 0; }
      .row .k { color: var(--dim); font-size: 11px; }
      .row .v { color: var(--text); font-weight: 700; font-variant-numeric: tabular-nums; }
    </style>

    <div class="dock right" id="dock">
      <div class="panel" id="panel">
        <div class="phead"><span class="brand">CYBERSTRIKE</span><span class="st" id="state">detached</span></div>
        <div class="pbody">
          <button class="ctl" id="btnAnon">Browse anonymous (start capture)</button>
          <button class="ctl" id="attachBtn">Attach capture</button>
          <label class="lbl">CyberStrike session</label>
          <select class="fld" id="sess"><option value="">-- New session --</option></select>
          <label class="lbl">This profile's role (empty = anonymous)</label>
          <div class="credrow">
            <input class="fld" id="cred" type="text" placeholder="anonymous" />
            <button class="mini" id="setCred">Set</button>
          </div>
          <label class="lbl">Add credential (opens a new browser)</label>
          <div class="credrow">
            <input class="fld" id="newRole" type="text" placeholder="e.g. user" />
            <button class="mini" id="addRole">Add</button>
          </div>
          <div class="lbl" id="roleHint" style="min-height:13px"></div>
          <div class="brk">
            <div class="row"><span class="k">captured</span><span class="v" id="s-total">0</span></div>
            <div class="row"><span class="k">API endpoints</span><span class="v" id="s-api">0</span></div>
            <div class="row"><span class="k">JavaScript files</span><span class="v" id="s-js">0</span></div>
            <div class="row"><span class="k">static assets</span><span class="v" id="s-static">0</span></div>
            <div class="row"><span class="k">page elements</span><span class="v" id="s-page">0</span></div>
          </div>
        </div>
      </div>
      <div class="bar" id="bar">
        <span class="cap">captured <b id="b-total">0</b></span>
        <button class="gear" id="gear" title="Details">${GEAR}</button>
      </div>
      <button class="fab" id="fab" title="Toggle driver"><img src="${LOGO_SRC}" alt="CyberStrike" draggable="false" /></button>
    </div>
  `

  const dock = root.getElementById("dock")
  const fab = root.getElementById("fab")
  const gear = root.getElementById("gear")
  const stateEl = root.getElementById("state")
  const sTotal = root.getElementById("s-total")
  const sApi = root.getElementById("s-api")
  const sJs = root.getElementById("s-js")
  const sStatic = root.getElementById("s-static")
  const sPage = root.getElementById("s-page")
  const bTotal = root.getElementById("b-total")
  const bar = root.getElementById("bar")

  let driver = "ai"
  let settingsOpen = false
  let pageCount = 0

  // Hover reveals the toolbar (captured + settings). JS-driven so a gap between
  // the logo and the bar doesn't drop the hover; stays open while settings is on.
  let hoverTimer = null
  function showBar() {
    if (hoverTimer) clearTimeout(hoverTimer)
    bar.classList.add("show")
  }
  function hideBar() {
    hoverTimer = setTimeout(() => {
      if (!settingsOpen) bar.classList.remove("show")
    }, 260)
  }
  fab.addEventListener("mouseenter", showBar)
  fab.addEventListener("mouseleave", hideBar)
  bar.addEventListener("mouseenter", showBar)
  bar.addEventListener("mouseleave", hideBar)

  // --- Settings controls: attach/detach, session, credential (no popup) ------
  const btnAnon = root.getElementById("btnAnon")
  const attachBtn = root.getElementById("attachBtn")
  const sess = root.getElementById("sess")
  const cred = root.getElementById("cred")
  const setCred = root.getElementById("setCred")
  const newRole = root.getElementById("newRole")
  const addRole = root.getElementById("addRole")
  const roleHint = root.getElementById("roleHint")

  // All CyberStrike calls go through the background (CORS-exempt); a content-script
  // fetch to localhost would be blocked by the page's CORS policy.
  async function loadSessions() {
    const res = await chrome.runtime.sendMessage({ type: "list-sessions" })
    if (!res || !res.ok) {
      sess.innerHTML = '<option value="">-- CyberStrike unreachable --</option>'
      return
    }
    const active = (await chrome.storage.local.get("session")).session || ""
    sess.innerHTML = '<option value="">-- New session --</option>'
    for (const s of res.sessions || []) {
      const o = document.createElement("option")
      o.value = s.id
      o.textContent = s.title ? s.title.slice(0, 30) : s.id
      if (s.id === active) o.selected = true
      sess.appendChild(o)
    }
  }

  sess.addEventListener("change", () => chrome.storage.local.set({ session: sess.value }))

  attachBtn.addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ type: "toggle-attach-self" })
    const on = !!(res && res.attached)
    attachBtn.textContent = on ? "Detach capture" : "Attach capture"
    attachBtn.classList.toggle("on", on)
  })

  // Browse anonymous: create/ensure a session + start capturing this tab, no credential.
  // One click removes the "pick a session first" friction.
  btnAnon.addEventListener("click", async () => {
    roleHint.textContent = "starting…"
    const res = await chrome.runtime.sendMessage({ type: "bootstrap-anonymous" })
    if (res && res.ok) {
      attachBtn.textContent = "Detach capture"
      attachBtn.classList.add("on")
      cred.value = ""
      cred.placeholder = "anonymous"
      roleHint.textContent = "capturing as anonymous — browse the site."
      loadSessions()
    } else {
      roleHint.textContent = (res && res.error) || "failed (need local CyberStrike)"
    }
  })

  setCred.addEventListener("click", async () => {
    const label = cred.value.trim()
    if (!label) return
    // background registers against the active session (kept in sync via storage).
    const res = await chrome.runtime.sendMessage({ type: "set-credential-label", label })
    if (res && res.ok) {
      cred.value = label
      cred.placeholder = "e.g. admin"
    } else {
      cred.value = ""
      cred.placeholder = (res && res.error) || "select a session first"
    }
  })

  // Add role → ask the backend to open a NEW Chrome profile (its own cookie jar) on
  // this session tagged with the role. The extension can't spawn a profile itself, so
  // CyberStrike does it. The new browser reads the role from its URL hash, then the
  // user logs in there as that role.
  async function spawnRole() {
    const role = newRole.value.trim()
    if (!role) return
    roleHint.textContent = `opening “${role}” browser…`
    const res = await chrome.runtime.sendMessage({ type: "spawn-role", role, url: location.origin })
    if (res && res.ok) {
      roleHint.textContent = `“${role}” browser opened — log in there as ${role}.`
      newRole.value = ""
    } else {
      roleHint.textContent = (res && res.error) || "failed (need a session + local CyberStrike)"
    }
  }
  addRole.addEventListener("click", spawnRole)
  newRole.addEventListener("keydown", (e) => {
    if (e.key === "Enter") spawnRole()
  })

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
    attachBtn.textContent = attached ? "Detach capture" : "Attach capture"
    attachBtn.classList.toggle("on", attached)

    if (status && status.stats) {
      const st = status.stats
      sTotal.textContent = st.total || 0
      sApi.textContent = st.api || 0
      sJs.textContent = st.js || 0
      sStatic.textContent = st.static || 0
      bTotal.textContent = st.total || 0
    }
    sPage.textContent = pageCount
    stateEl.textContent = !attached ? "detached" : driver === "human" ? "you drive" : "AI driving"

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
    host.style.left = Math.max(4, Math.min(origLeft + dx, window.innerWidth - host.offsetWidth - 4)) + "px"
    host.style.top = Math.max(4, Math.min(origTop + dy, window.innerHeight - host.offsetHeight - 4)) + "px"
    updateSide()
  }
  function onDragEnd() {
    dragging = false
  }
  fab.addEventListener("mousedown", onDragStart)
  fab.addEventListener("touchstart", onDragStart, { passive: false })
  document.addEventListener("mousemove", onDragMove)
  document.addEventListener("touchmove", onDragMove, { passive: false })
  document.addEventListener("mouseup", onDragEnd)
  document.addEventListener("touchend", onDragEnd)

  // Logo click → toggle driver (not a drag) + flash transition.
  fab.addEventListener("click", () => {
    if (moved) {
      moved = false
      return
    }
    fab.classList.remove("tapped")
    void fab.offsetWidth
    fab.classList.add("tapped")
    driver = driver === "ai" ? "human" : "ai"
    flashTransition(
      driver === "human" ? "Human Driving the session" : "AI Driving the session",
      driver === "human" ? "human" : "ai",
    )
    chrome.runtime.sendMessage({ type: "set-driver", driver }, (res) => render(res))
  })

  gear.addEventListener("click", (e) => {
    e.stopPropagation()
    settingsOpen = !settingsOpen
    dock.classList.toggle("settings", settingsOpen)
    if (settingsOpen) bar.classList.add("show")
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
  // DOM element → Playwright-style semantic role. Explicit role attr wins, else
  // infer from tag/type. Used for BOTH the observation `role` and the
  // trigger_element "role:label" key, so Faz B availability compares cleanly.
  function roleOf(el) {
    const r = el.getAttribute("role")
    if (r) return r.toLowerCase()
    const tag = el.tagName.toLowerCase()
    if (tag === "a" && el.getAttribute("href")) return "link"
    if (tag === "button") return "button"
    if (tag === "select") return "combobox"
    if (tag === "textarea") return "textbox"
    if (tag === "input") {
      const t = (el.getAttribute("type") || "text").toLowerCase()
      if (t === "submit" || t === "button" || t === "reset" || t === "image") return "button"
      if (t === "checkbox") return "checkbox"
      if (t === "radio") return "radio"
      return "textbox"
    }
    return tag
  }
  // A form field's visible label: <label for>, wrapping <label>, else aria/placeholder.
  function fieldLabel(el) {
    try {
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        if (l && l.innerText) return l.innerText.replace(/\s+/g, " ").trim().slice(0, 80)
      }
    } catch {}
    const wrap = el.closest && el.closest("label")
    if (wrap && wrap.innerText) return wrap.innerText.replace(/\s+/g, " ").trim().slice(0, 80)
    return (el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").slice(0, 80)
  }
  // DOM form control → UIField (types.ts UIField). Richer than the observation's
  // thin field shape on purpose: ui_context feeds CyberStrike's param/UI diff.
  function fieldOf(el) {
    const type = (el.getAttribute("type") || el.tagName).toLowerCase()
    let value = ""
    try {
      if (type === "checkbox" || type === "radio") value = el.checked ? el.value || "on" : ""
      else value = el.value || ""
    } catch {}
    const field = {
      name: el.name || el.id || el.getAttribute("aria-label") || "",
      label: fieldLabel(el),
      value: typeof value === "string" ? value.slice(0, 120) : "",
      type,
      isReadOnly: el.hasAttribute("readonly"),
      isDisabled: el.disabled === true || el.hasAttribute("disabled"),
      isHidden: type === "hidden" || !visible(el),
      isDisplayOnly: false,
      validation: {},
    }
    if (type === "hidden") field.hiddenReason = "type=hidden"
    const v = field.validation
    if (el.hasAttribute("required")) v.required = true
    if (el.hasAttribute("min")) v.min = el.getAttribute("min")
    if (el.hasAttribute("max")) v.max = el.getAttribute("max")
    if (el.hasAttribute("maxlength")) v.maxLength = el.getAttribute("maxlength")
    if (el.hasAttribute("pattern")) v.pattern = el.getAttribute("pattern")
    return field
  }
  // Human-readable path to the element through landmark/form ancestors.
  function componentPath(el) {
    const parts = []
    let n = el
    let hops = 0
    while (n && n !== document.body && hops < 40 && parts.length < 4) {
      const lbl = n.getAttribute && (n.getAttribute("aria-label") || n.getAttribute("data-testid"))
      if (lbl) parts.unshift(lbl.trim())
      else if (/^(SECTION|NAV|FORM|MAIN|ASIDE|HEADER|DIALOG)$/.test(n.tagName)) {
        const h = n.querySelector && n.querySelector("h1,h2,h3,legend")
        if (h && h.innerText) parts.unshift(h.innerText.trim())
      }
      n = n.parentElement
      hops++
    }
    return parts.slice(0, 4).join(" > ").slice(0, 200)
  }
  // UIContext (types.ts) static part for a triggering element. hiddenParams is left
  // to background forward() — only there is the final request body known.
  function uiContextFor(el) {
    const form = el.closest ? el.closest("form") : null
    const fields = []
    if (form) {
      for (const f of form.elements) {
        if (!f.name && !f.id && !f.getAttribute("aria-label")) continue
        fields.push(fieldOf(f))
        if (fields.length >= 60) break
      }
    }
    return {
      pageUrl: location.href,
      pageTitle: document.title,
      componentPath: componentPath(el),
      formName: form ? form.getAttribute("name") || form.getAttribute("id") || form.getAttribute("aria-label") || "" : "",
      fields,
    }
  }
  // Single selector for "a thing a user clicks" — used by both the page observation
  // and the trigger-correlation click listener, so they never drift.
  const CLICKABLE_SEL = "a[href],button,[role=button],input[type=submit],input[type=button],[onclick]"
  const elMap = new Map()
  function observePage() {
    const clickables = []
    elMap.clear()
    let i = 0
    for (const el of document.querySelectorAll(CLICKABLE_SEL)) {
      if (!visible(el)) continue
      const eid = "E" + i++
      elMap.set(eid, el)
      clickables.push({ id: eid, tag: el.tagName.toLowerCase(), role: roleOf(el), label: labelOf(el), href: el.getAttribute("href") || "" })
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
    // KEEP IN SYNC with codriving.ts PageObservation / classify.ts Clickable
    // (cross-runtime wire contract — can't import a shared type here).
    return { url: location.href, title: document.title, clickables, forms, links }
  }
  function sendObservation() {
    const obs = observePage()
    pageCount = obs.clickables.length + obs.forms.length
    chrome.runtime.sendMessage({ type: "observe", observation: obs }, () => void chrome.runtime.lastError)
    return obs
  }

  // --- Trigger correlation (Faz A enrichment) --------------------------------
  // The last user/AI click OWNS every dynamic request until the next click or a
  // navigation that is not that click's own effect. Capture phase → the trigger is
  // recorded BEFORE the page's click handler fires the request. trigger_element =
  // "role:label" (single colon), matching 1.x's wire format (types.ts IngestPayload).
  const NAV_GRACE_MS = 1000
  let lastTrigger = null // { element, ui_context, ts }

  document.addEventListener(
    "click",
    (e) => {
      const t = e.target && e.target.closest ? e.target.closest(CLICKABLE_SEL) : null
      if (!t) return // dead click (empty space) triggers no UI element — keep the last
      lastTrigger = { element: roleOf(t) + ":" + labelOf(t), ui_context: uiContextFor(t), ts: Date.now() }
    },
    true, // capture phase — before the page's own handler runs
  )

  // A navigation ends the window UNLESS it happened within NAV_GRACE_MS of the click
  // (then the nav was caused by that click, so its requests still belong to it).
  // SPA navs (history.pushState) are signalled from the MAIN world via __cs_nav,
  // since a content-script history patch can't see the page's own pushState calls.
  function onNav() {
    if (!lastTrigger || Date.now() - lastTrigger.ts > NAV_GRACE_MS) lastTrigger = null
  }
  window.addEventListener("popstate", onNav)
  window.addEventListener("hashchange", onNav)

  // Relay captured fetch/XHR records from the MAIN-world patch to the background,
  // enriched with page_url + the owning trigger's element/ui_context (Faz A).
  window.addEventListener("message", (e) => {
    if (e.source !== window) return
    const d = e.data
    if (!d) return
    if (d.__cs_nav) return void onNav()
    const rec = d.__cs_capture
    if (!rec) return
    rec.page_url = location.href
    if (lastTrigger) {
      rec.trigger_element = lastTrigger.element
      rec.ui_context = lastTrigger.ui_context
    }
    chrome.runtime.sendMessage({ type: "captured", rec }, () => void chrome.runtime.lastError)
  })

  chrome.runtime.onMessage.addListener((m, s, sendResponse) => {
    if (m.type !== "perform") return
    const cmd = m.cmd || {}
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

  function decodeHash(m) {
    if (!m) return null
    try {
      return decodeURIComponent(m[1])
    } catch {
      return m[1]
    }
  }
  // Launcher-injected config: #__cs_cred=<label>&__cs_sess=<id>. session makes all
  // profiles share ONE CyberStrike session so captures compare per-credential
  // (IDOR/BFLA); credential self-registers. Then strip the hash.
  function readCredFromHash() {
    const h = location.hash || ""
    const label = decodeHash(h.match(/__cs_cred=([^&]+)/))
    const sess = decodeHash(h.match(/__cs_sess=([^&]+)/))
    if (label === null && sess === null) return
    history.replaceState(null, "", location.pathname + location.search || "/")
    // Set the shared session BEFORE the credential (which registers against it).
    if (sess) chrome.storage.local.set({ session: sess })
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
    document.body.appendChild(transHost)
    document.body.appendChild(host)
    readCredFromHash()
    updateSide()
    sendObservation()
    loadSessions()
    chrome.storage.local.get("credential", (o) => {
      if (o && o.credential) cred.value = o.credential.label || ""
    })
    poll()
    setInterval(poll, 1500)
  }

  if (document.body) mount()
  else document.addEventListener("DOMContentLoaded", mount)
})()
