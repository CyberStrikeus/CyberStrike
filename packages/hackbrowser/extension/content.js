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
  // Idempotent: a fresh --load-extension profile can miss the declarative injection, so
  // the popup re-injects this file. Run the setup once; a re-injection is a no-op (the
  // first run's panel-visibility listener still handles show/hide).
  if (window.__csHb2Loaded) return
  window.__csHb2Loaded = true

  const LOGO_SRC = chrome.runtime.getURL("logo.png")
  // Eye icons for the in-page reasoning-overlay (hue) on/off toggle.
  const EYE_ON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>`
  const EYE_OFF = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="m1 1 22 22"/></svg>`

  // Message the background without ever throwing. The callback form + lastError check
  // means a sleeping/erroring MV3 service worker resolves to undefined instead of
  // rejecting — so a click handler never dead-ends (and never leaves a button stuck
  // disabled). Every button handler uses this.
  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          void chrome.runtime.lastError
          resolve(res)
        })
      } catch {
        resolve(undefined)
      }
    })
  }

  // Driver palette — one source for the three shadow roots (glow, transition, dock),
  // which can't share CSS vars because each has its own <style>.
  const AI_RGB = "37,99,235"
  const HUMAN_RGB = "240,180,41"
  const AI_TINT = "#7ea8ff"

  // Role identity hue — SEPARATE from the driver palette above. Each role label maps
  // deterministically to a distinct color so N spawned browsers are told apart at a
  // glance. Same label → same color across every profile/session.
  function roleColor(label) {
    let h = 0
    const s = String(label || "")
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
    return `hsl(${h % 360} 72% 56%)`
  }

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
  function flashTransition(text, cls, color, ms) {
    msg.textContent = text
    msg.className = "msg " + (cls || "")
    // Optional explicit color (role hue) — overrides the driver-class shadow; reset when
    // absent so driver transitions keep their CSS styling.
    msg.style.boxShadow = color ? `0 0 0 1px ${color}, 0 10px 40px -8px ${color}` : ""
    msg.style.color = color || ""
    trans.classList.add("show")
    if (transTimer) clearTimeout(transTimer)
    transTimer = setTimeout(() => trans.classList.remove("show"), ms || 1400)
  }

  // --- AI activity overlay --------------------------------------------------
  // Makes the AI's actions VISIBLE: a synthetic cursor glides to the element the AI is about
  // to act on, a ring flashes on that element, and a toast names the action ("AI clicks: …").
  // The AI clicks via el.click() (no real pointer moves), so without this the page just changes
  // with no indication anything is driving it. pointer-events:none so it never blocks the page.
  const cursorHost = document.createElement("div")
  cursorHost.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;"
  const curRoot = cursorHost.attachShadow({ mode: "closed" })
  curRoot.innerHTML = `
    <style>
      .cur { position: fixed; left:-100px; top:-100px; margin:-3px 0 0 -3px; pointer-events:none;
             opacity:0; transition: left .28s cubic-bezier(.4,0,.2,1), top .28s cubic-bezier(.4,0,.2,1), opacity .2s; }
      .cur.on { opacity:1; }
      .cur svg { display:block; filter: drop-shadow(0 1px 3px rgba(0,0,0,.55)); }
      .dot { position:absolute; left:0; top:0; width:26px; height:26px; margin:-13px 0 0 -13px; border-radius:50%;
             border:2px solid rgba(${AI_RGB},.9); opacity:0; }
      .cur.pulse .dot { animation: aiPulse .5s ease-out; }
      @keyframes aiPulse { 0%{ transform:scale(.3); opacity:.9 } 100%{ transform:scale(1.5); opacity:0 } }
      /* "Thinking" breathing while the model plans the next move. */
      .cur.thinking .dot { animation: aiBreathe 1.15s ease-in-out infinite; }
      @keyframes aiBreathe { 0%,100%{ transform:scale(.55); opacity:.3 } 50%{ transform:scale(1.25); opacity:.85 } }
      .ring { position: fixed; pointer-events:none; border-radius:6px; opacity:0;
              box-shadow: 0 0 0 2px rgba(${AI_RGB},.95), 0 0 16px 3px rgba(${AI_RGB},.5); }
      .ring.flash { animation: aiRing 1s ease-out; }
      @keyframes aiRing { 0%{opacity:.95} 70%{opacity:.5} 100%{opacity:0} }
      .act { position: fixed; left:50%; top:16px; transform: translateX(-50%);
             font: 600 12px ui-sans-serif, system-ui, -apple-system, sans-serif; letter-spacing:.01em;
             color:#fff; background: rgba(${AI_RGB},.94); padding:7px 14px; border-radius:999px;
             box-shadow: 0 6px 24px rgba(0,0,0,.35); opacity:0; transition: opacity .2s;
             white-space:nowrap; max-width:72vw; overflow:hidden; text-overflow:ellipsis; }
      .act.show { opacity:1; }
    </style>
    <div class="cur" id="aicur"><svg width="20" height="20" viewBox="0 0 24 24"><path d="M4 2 L20 12 L13 13 L11 21 Z" fill="#fff" stroke="rgba(${AI_RGB},1)" stroke-width="1.5" stroke-linejoin="round"/></svg><div class="dot"></div></div>
    <div class="ring" id="airing"></div>
    <div class="act" id="aiact"></div>
  `
  const aicur = curRoot.getElementById("aicur")
  const airing = curRoot.getElementById("airing")
  const aiactEl = curRoot.getElementById("aiact")
  let aiActTimer = null
  // In-page reasoning overlay ("hue"): the AI cursor, target ring, and activity/reason bubbles.
  // Toggled by the panel's eye button; persisted per browser. Default ON. When OFF, all in-page
  // AI visuals are suppressed (the panel Reasoning log still updates — that's not the "hue").
  let hueOn = true
  try {
    hueOn = localStorage.getItem("cs_hue") !== "0"
  } catch {}
  function setHue(on) {
    hueOn = !!on
    try {
      localStorage.setItem("cs_hue", hueOn ? "1" : "0")
    } catch {}
    if (!hueOn) {
      aicur.classList.remove("on")
      aiactEl.classList.remove("show")
    }
  }
  function aiActivity(text) {
    if (!hueOn) return
    aiactEl.textContent = text
    aiactEl.classList.add("show")
    if (aiActTimer) clearTimeout(aiActTimer)
    aiActTimer = setTimeout(() => aiactEl.classList.remove("show"), 2600)
  }
  // Thinking cue while the model plans (no target yet): keep the cursor visible with a breathing
  // pulse + a persistent "planning…" bubble (no auto-hide), cleared when the next action arrives.
  function aiThinking() {
    if (!hueOn) return
    aicur.classList.add("on", "thinking")
    aiactEl.textContent = "planning next move…"
    aiactEl.classList.add("show")
    if (aiActTimer) clearTimeout(aiActTimer)
  }
  function aiPointAt(el) {
    if (!hueOn) return
    aicur.classList.remove("thinking") // a concrete target → stop the thinking breathe
    let r
    try {
      r = el.getBoundingClientRect()
    } catch {
      return
    }
    const x = Math.max(0, Math.min(innerWidth, r.left + r.width / 2))
    const y = Math.max(0, Math.min(innerHeight, r.top + r.height / 2))
    aicur.style.left = x + "px"
    aicur.style.top = y + "px"
    aicur.classList.add("on")
    airing.style.left = r.left + "px"
    airing.style.top = r.top + "px"
    airing.style.width = r.width + "px"
    airing.style.height = r.height + "px"
    airing.classList.remove("flash")
    void airing.offsetWidth
    airing.classList.add("flash")
  }
  function aiClickPulse() {
    if (!hueOn) return
    aicur.classList.remove("pulse")
    void aicur.offsetWidth
    aicur.classList.add("pulse")
  }

  // --- Role identity layer (Phase 2) ----------------------------------------
  // A spawned profile carries a role (from #__cs_cred). Show a persistent role-colored
  // top edge bar (which browser is which) + a dismissable "log in as this identity"
  // banner. Anonymous (no role) shows neither.
  const roleHost = document.createElement("div")
  roleHost.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483646;pointer-events:none;"
  const roleRoot = roleHost.attachShadow({ mode: "closed" })
  roleRoot.innerHTML = `
    <style>
      .bar { height: 3px; width: 100%; background: var(--rc,#888); opacity: 0; transition: opacity .4s ease; }
      .bar.on { opacity: .9; }
      .banner { pointer-events: auto; position: fixed; top: 12px; left: 50%;
        transform: translateX(-50%) translateY(-14px); display: flex; align-items: center; gap: 9px;
        max-width: 82vw; padding: 8px 12px; border-radius: 11px; background: rgba(16,18,23,.95);
        font: 600 12px/1.3 -apple-system,system-ui,sans-serif; color: #fff;
        box-shadow: 0 8px 28px rgba(0,0,0,.45), inset 0 0 0 1px var(--rc,#888);
        opacity: 0; transition: opacity .45s ease, transform .45s ease; }
      .banner.on { opacity: 1; transform: translateX(-50%) translateY(0); }
      .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; background: var(--rc,#888);
        box-shadow: 0 0 9px var(--rc,#888); }
      .txt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .rn { color: var(--rc,#fff); text-transform: uppercase; letter-spacing: .04em; }
      .hint { color: #a7adba; font-weight: 500; }
      .x { pointer-events: auto; cursor: pointer; flex: none; margin-left: 2px; color: #7d8496; font-weight: 700; }
      .x:hover { color: #fff; }
    </style>
    <div class="bar" id="rbar"></div>
    <div class="banner" id="rbanner">
      <span class="dot"></span>
      <span class="txt"><span class="rn" id="rname"></span> <span class="hint">— log in as this identity, then browse</span></span>
      <span class="x" id="rx" title="dismiss">✕</span>
    </div>
  `
  const rbar = roleRoot.getElementById("rbar")
  const rbanner = roleRoot.getElementById("rbanner")
  const rname = roleRoot.getElementById("rname")
  let roleDismissed = false
  let lastRole = null
  roleRoot.getElementById("rx").addEventListener("click", () => {
    roleDismissed = true
    rbanner.classList.remove("on")
  })
  // label falsy/blank → anonymous → hide everything. A changed role resets the dismiss.
  function renderRole(label) {
    let l = label && String(label).trim() ? String(label).trim() : null
    // "anonymous" is the default identity — tagged in captures, but no role banner/hue
    // (a "log in as this identity" prompt makes no sense for it).
    if (l && l.toLowerCase() === "anonymous") l = null
    if (l !== lastRole) {
      roleDismissed = false
      lastRole = l
    }
    if (!l) {
      rbar.classList.remove("on")
      rbanner.classList.remove("on")
      return
    }
    const c = roleColor(l)
    rbar.style.setProperty("--rc", c)
    rbanner.style.setProperty("--rc", c)
    rname.textContent = l // textContent — never innerHTML (role is user-supplied)
    rbar.classList.add("on")
    if (!roleDismissed) rbanner.classList.add("on")
  }

  // --- Confirm overlay (Yes/No) ---------------------------------------------
  const confirmHost = document.createElement("div")
  confirmHost.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;"
  const confirmRoot = confirmHost.attachShadow({ mode: "closed" })
  confirmRoot.innerHTML = `
    <style>
      .wrap { position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
        background: rgba(0,0,0,.45); pointer-events: auto; }
      .wrap.on { display: flex; }
      .card { background: #121319; color: #fff; border-radius: 12px; padding: 18px 20px; max-width: 360px;
        box-shadow: 0 20px 60px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.08);
        font: 13px/1.5 -apple-system,system-ui,sans-serif; }
      .msg { margin-bottom: 14px; }
      .row { display: flex; gap: 10px; justify-content: flex-end; }
      button { padding: 7px 14px; border: 0; border-radius: 8px; font: 600 12px system-ui,sans-serif; cursor: pointer; }
      .no { background: #2a2f3a; color: #cbd5e1; }
      .yes { background: #dc2626; color: #fff; }
    </style>
    <div class="wrap" id="cwrap">
      <div class="card">
        <div class="msg" id="cmsg"></div>
        <div class="row"><button class="no" id="cno">No</button><button class="yes" id="cyes">Yes</button></div>
      </div>
    </div>
  `
  const cwrap = confirmRoot.getElementById("cwrap")
  const cmsg = confirmRoot.getElementById("cmsg")
  let confirmResolve = null
  function askConfirm(text) {
    cmsg.textContent = text
    cwrap.classList.add("on")
    return new Promise((resolve) => {
      confirmResolve = resolve
    })
  }
  function answerConfirm(v) {
    cwrap.classList.remove("on")
    const r = confirmResolve
    confirmResolve = null
    if (r) r(v)
  }
  confirmRoot.getElementById("cyes").addEventListener("click", () => answerConfirm(true))
  confirmRoot.getElementById("cno").addEventListener("click", () => answerConfirm(false))

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
        cursor: grab; user-select: none; position: relative; z-index: 2;
        transition: transform .16s ease, box-shadow .16s ease;
      }
      /* Quick-action "wings" flanking the logo (Olympic interlock): RED = unauthenticated capture,
         BLUE + = add credential. Tucked behind the FAB (z-index 1); peek out on hover. */
      .wing {
        position: absolute; top: 50%; width: 44px; height: 44px; border-radius: 50%;
        transform: translateY(-50%) scale(.7); z-index: 1;
        display: inline-flex; align-items: center; justify-content: center;
        border: 0; cursor: pointer; color: #fff; font: 800 19px system-ui, sans-serif;
        opacity: 0; pointer-events: none;
        box-shadow: 0 4px 14px rgba(0,0,0,.4), inset 0 0 0 1px rgba(255,255,255,.16);
        transition: opacity .18s ease, transform .18s ease, right .18s ease, left .18s ease, filter .15s ease;
      }
      .wing.right { right: -10px; background: radial-gradient(circle at 50% 40%, #e0343f, #b4232f); justify-content: flex-end; padding-right: 7px; }
      .wing.left  { left:  -10px; background: radial-gradient(circle at 50% 40%, #3b82f6, #2563eb); justify-content: flex-start; padding-left: 7px; }
      .wing .wdot { width: 11px; height: 11px; border-radius: 50%; background: #fff; box-shadow: 0 0 8px rgba(255,255,255,.6); }
      .wing:hover { filter: brightness(1.12); }
      .wing:disabled { opacity: .4 !important; cursor: default; }
      .dock:hover:not(.settings) .wing { opacity: 1; pointer-events: auto; transform: translateY(-50%) scale(1); }
      .dock:hover:not(.settings) .wing.right { right: -32px; }
      .dock:hover:not(.settings) .wing.left  { left:  -32px; }
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
      /* Hue aura around the logo while capturing — driver-colored, gently breathing. */
      .dock.capturing .fab { animation: fabHueAI 3.4s ease-in-out infinite; }
      .dock.capturing.driver-human .fab { animation: fabHueHuman 3.4s ease-in-out infinite; }
      @keyframes fabHueAI {
        0%,100% { box-shadow: 0 5px 18px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.07), 0 0 0 2px rgba(${AI_RGB},.45), 0 0 14px 2px rgba(${AI_RGB},.4); }
        50%     { box-shadow: 0 5px 18px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.07), 0 0 0 2px rgba(${AI_RGB},.65), 0 0 26px 6px rgba(${AI_RGB},.7); }
      }
      @keyframes fabHueHuman {
        0%,100% { box-shadow: 0 5px 18px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.07), 0 0 0 2px rgba(${HUMAN_RGB},.5), 0 0 14px 2px rgba(${HUMAN_RGB},.45); }
        50%     { box-shadow: 0 5px 18px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.07), 0 0 0 2px rgba(${HUMAN_RGB},.7), 0 0 26px 6px rgba(${HUMAN_RGB},.75); }
      }
      @media (prefers-reduced-motion: reduce) {
        .dock.capturing .fab { animation: none; box-shadow: 0 5px 18px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.07), 0 0 16px 3px rgba(${AI_RGB},.55); }
        .dock.capturing.driver-human .fab { animation: none; box-shadow: 0 5px 18px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.07), 0 0 16px 3px rgba(${HUMAN_RGB},.6); }
      }

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
      /* AI reasoning log (panel) — the persistent "why" stream. */
      .rlbl { font-size: 10px; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
      .rlog { max-height: 108px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
      .rlog:empty::after { content: "waiting for the AI…"; color: var(--faint); font-size: 11px; }
      .rent { font-size: 11px; line-height: 1.35; color: var(--dim); border-left: 2px solid rgba(${AI_RGB},.55); padding: 2px 0 2px 7px; }
      .rent b { color: var(--text); font-weight: 600; }
    </style>

    <div class="dock right" id="dock">
      <div class="panel" id="panel">
        <div class="phead"><span class="brand">CYBERSTRIKE</span><span class="st" id="state">detached</span></div>
        <div class="pbody">
          <label class="lbl">CyberStrike server</label>
          <div class="credrow">
            <input class="fld" id="srvUrl" type="text" placeholder="http://127.0.0.1:4096" spellcheck="false" />
            <button class="mini" id="srvConnect">Connect</button>
          </div>
          <input class="fld" id="srvPw" type="password" placeholder="password (remote / tunnel only)" style="margin-bottom:6px" />
          <button class="ctl" id="attachBtn">Start capture</button>
          <label class="lbl">CyberStrike session</label>
          <div class="credrow">
            <select class="fld" id="sess"><option value="">-- New session --</option></select>
            <button class="mini" id="refreshSess" title="Reload sessions from CyberStrike">↻</button>
          </div>
          <label class="lbl">This profile's role (empty = anonymous)</label>
          <div class="credrow">
            <input class="fld" id="cred" type="text" placeholder="Anonymous" />
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
          <div class="brk">
            <div class="rlbl">AI reasoning</div>
            <div class="rlog" id="rlog"></div>
          </div>
        </div>
      </div>
      <div class="bar" id="bar">
        <span class="cap">captured <b id="b-total">0</b></span>
        <button class="gear" id="hueBtn" title="AI reasoning overlay (hue)">${EYE_ON}</button>
        <button class="gear" id="gear" title="Details">${GEAR}</button>
      </div>
      <button class="wing left" id="wLeft" title="Add credential (opens a new browser for a role)">+</button>
      <button class="wing right" id="wRight" title="Start unauthenticated capture"><span class="wdot"></span></button>
      <button class="fab" id="fab" title="Toggle driver"><img src="${LOGO_SRC}" alt="CyberStrike" draggable="false" /></button>
    </div>
  `

  const dock = root.getElementById("dock")
  const fab = root.getElementById("fab")
  const gear = root.getElementById("gear")
  // In-page reasoning-overlay (hue) toggle + the panel reasoning log.
  const hueBtn = root.getElementById("hueBtn")
  const rlog = root.getElementById("rlog")
  function reflectHue() {
    hueBtn.innerHTML = hueOn ? EYE_ON : EYE_OFF
    hueBtn.title = hueOn ? "AI reasoning overlay: on" : "AI reasoning overlay: off"
    hueBtn.style.color = hueOn ? "" : "var(--faint)"
  }
  reflectHue()
  hueBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    setHue(!hueOn)
    reflectHue()
  })
  // Append one reasoning entry. Built with DOM nodes (never innerHTML) — label/intent come from
  // the page/model, so string-interpolating them into HTML would be an injection into our root.
  function addReason(act, label, intent) {
    if (!rlog) return
    const verb = act === "click" ? "click" : act === "type" ? "type into" : act === "navigate" ? "go to" : act === "form" ? "submit" : String(act || "act")
    const row = document.createElement("div")
    row.className = "rent"
    row.append(verb + " ")
    if (label) {
      const b = document.createElement("b")
      b.textContent = String(label)
      row.append(b)
    }
    const why = intent && String(intent).trim()
    if (why) row.append(" — " + String(intent).trim())
    rlog.appendChild(row)
    while (rlog.childElementCount > 40) rlog.removeChild(rlog.firstChild)
    rlog.scrollTop = rlog.scrollHeight
  }
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
  let mountedAt = 0 // when the dock was appended — see panel-visibility (popup toggle)
  let isSpawned = false // true in a browser CyberStrike spawned (opened with a role hash)

  // Hover reveals the toolbar (captured + settings). JS-driven so a gap between
  // the logo and the bar doesn't drop the hover; stays open while settings is on.
  let hoverTimer = null
  // Pause the AI while the user is engaging the panel, so a full-page navigation doesn't wipe the
  // panel out from under them before they can click. Deduped so we don't spam the server on every
  // pointer move; released only once the bar actually hides AND settings is closed.
  let holdOn = false
  function setHold(want) {
    if (want === holdOn) return
    holdOn = want
    send({ type: "set-hold", held: want })
  }
  function showBar() {
    if (hoverTimer) clearTimeout(hoverTimer)
    bar.classList.add("show")
    setHold(true)
  }
  function hideBar() {
    hoverTimer = setTimeout(() => {
      if (!settingsOpen) {
        bar.classList.remove("show")
        setHold(false)
      }
    }, 260)
  }
  fab.addEventListener("mouseenter", showBar)
  fab.addEventListener("mouseleave", hideBar)
  bar.addEventListener("mouseenter", showBar)
  bar.addEventListener("mouseleave", hideBar)

  // --- Settings controls: attach/detach, session, credential (no popup) ------
  const attachBtn = root.getElementById("attachBtn")
  const sess = root.getElementById("sess")
  const refreshSess = root.getElementById("refreshSess")
  const cred = root.getElementById("cred")
  const setCred = root.getElementById("setCred")
  const newRole = root.getElementById("newRole")
  const addRole = root.getElementById("addRole")
  const roleHint = root.getElementById("roleHint")

  // All CyberStrike calls go through the background (CORS-exempt); a content-script
  // fetch to localhost would be blocked by the page's CORS policy.
  async function loadSessions() {
    const res = await send({ type: "list-sessions" })
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

  // Reload the session list — a session created in CyberStrike AFTER the panel opened
  // won't be in the dropdown until refetched. Keeps the current selection if it survives.
  refreshSess.addEventListener("click", async () => {
    refreshSess.disabled = true
    refreshSess.textContent = "…"
    await loadSessions()
    refreshSess.textContent = "↻"
    refreshSess.disabled = false
  })

  // Single role-aware capture toggle. START: ensure session + register the role (default
  // "anonymous") + attach, and flash a hue "Capture started with <role> role". STOP:
  // detach; on the MAIN browser, offer to close the spawned role browsers.
  // CyberStrike server connect (URL + optional password) — lets this one extension work
  // self-installed in any browser, not only spawned CfT. Password is only needed for a remote
  // (tunnel) CS; a local/loopback CS skips auth.
  const srvUrl = root.getElementById("srvUrl")
  const srvPw = root.getElementById("srvPw")
  const srvConnect = root.getElementById("srvConnect")
  send({ type: "get-server" })
    .then((s) => {
      if (s && s.url) srvUrl.value = s.url
    })
    .catch(() => {})
  async function connectServer() {
    const url = srvUrl.value.trim()
    if (!url) return
    srvConnect.disabled = true
    await send({ type: "set-server", url, password: srvPw.value })
    srvPw.value = ""
    srvConnect.disabled = false
    flashTransition("Connecting to " + url.replace(/^https?:\/\//, ""), "", "", 1400)
    loadSessions() // verify reachable + populate the session picker
    poll()
  }
  srvConnect.addEventListener("click", connectServer)
  srvPw.addEventListener("keydown", (e) => {
    if (e.key === "Enter") connectServer()
  })
  srvUrl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") connectServer()
  })

  attachBtn.addEventListener("click", async () => {
    const status = await send({ type: "panel-status" })
    if (!(status && status.attached)) {
      attachBtn.disabled = true
      const role = cred.value.trim() || "Anonymous"
      const res = await send({ type: "start-capture", role, url: location.href })
      attachBtn.disabled = false
      if (res && res.ok) {
        const shown = res.role || role // server's canonical casing (one role, not a case-dup)
        cred.value = shown
        if (res.reused) {
          flashTransition(`"${shown}" role already exists — continuing`, "", roleColor(shown), 1600)
          roleHint.textContent = `Reusing the existing "${shown}" role.`
        } else {
          flashTransition(`Capture started with ${shown} role`, "", roleColor(shown), 1200)
        }
        loadSessions()
      } else {
        roleHint.textContent = (res && res.error) || "failed (need local CyberStrike + reachable server)"
      }
      poll()
      return
    }
    // STOP (detach). A spawned browser never prompts; the main one offers to close roles.
    await send({ type: "toggle-attach-self" })
    poll()
    if (isSpawned) return
    const c = await send({ type: "spawned-count" })
    const n = c && c.ok ? c.count : 0
    if (n <= 0) return
    const ok = await askConfirm(
      `Close the ${n} role browser${n > 1 ? "s" : ""} too? Their last captures flush first.`,
    )
    if (ok) chrome.runtime.sendMessage({ type: "close-role-browsers" }, () => void chrome.runtime.lastError)
  })

  setCred.addEventListener("click", async () => {
    const label = cred.value.trim()
    if (!label) return
    // background registers against the active session (kept in sync via storage).
    const res = await send({ type: "set-credential-label", label })
    if (res && res.ok) {
      cred.value = label
      cred.placeholder = "e.g. admin"
    } else {
      cred.value = ""
      cred.placeholder = (res && res.error) || "select a session first"
    }
  })

  // Add credential → ENQUEUE the role for sequential setup. Its browser opens when its
  // turn comes (after the previous role's Start capture), not immediately — so the user
  // sets up one identity at a time instead of juggling N windows.
  async function enqueueRoleClick() {
    const role = newRole.value.trim()
    if (!role) return
    const res = await send({ type: "enqueue-role", role })
    if (res && res.ok) {
      roleHint.textContent = `“${role}” queued — opens after you Start capture.`
      newRole.value = ""
    } else {
      roleHint.textContent = (res && res.error) || "failed (need a session + local CyberStrike)"
    }
  }
  addRole.addEventListener("click", enqueueRoleClick)
  newRole.addEventListener("keydown", (e) => {
    if (e.key === "Enter") enqueueRoleClick()
  })

  // Logo "wings": RED (right) = start unauthenticated capture; BLUE "+" (left) = add credential.
  const wRight = root.getElementById("wRight")
  const wLeft = root.getElementById("wLeft")
  wRight.addEventListener("click", async (e) => {
    e.stopPropagation()
    const status = await send({ type: "panel-status" })
    if (status && status.attached) return void flashTransition("Already capturing", "", "", 1100)
    wRight.disabled = true
    const res = await send({ type: "start-capture", role: "Anonymous", url: location.href })
    wRight.disabled = false
    if (res && res.ok) flashTransition("Unauthenticated capture started", "", "#b4232f", 1300)
    else roleHint.textContent = (res && res.error) || "failed (need local CyberStrike + reachable server)"
    poll()
  })
  wLeft.addEventListener("click", (e) => {
    e.stopPropagation()
    // Add credential needs a role NAME → open the panel focused on the role input.
    settingsOpen = true
    dock.classList.add("settings")
    bar.classList.add("show")
    try {
      newRole.focus()
    } catch {}
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
    attachBtn.textContent = attached ? "Stop capture" : "Start capture"
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

  // Auto-close the settings menu when the pointer leaves the dock — but NOT while a
  // field inside it has focus (don't yank the panel away mid-typing). Re-entering the
  // dock cancels a pending close.
  let settingsTimer = null
  function cancelCloseSettings() {
    if (settingsTimer) {
      clearTimeout(settingsTimer)
      settingsTimer = null
    }
  }
  function closeSettings() {
    const a = root.activeElement
    if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) {
      settingsTimer = setTimeout(closeSettings, 400) // still editing — retry later
      return
    }
    settingsOpen = false
    dock.classList.remove("settings")
    bar.classList.remove("show")
  }
  dock.addEventListener("mouseenter", cancelCloseSettings)
  dock.addEventListener("mouseleave", () => {
    if (!settingsOpen) return
    cancelCloseSettings()
    settingsTimer = setTimeout(closeSettings, 320)
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
  // Single selector for "a thing a user clicks" — used by the trigger-correlation click
  // listener (closest()). Observation now casts a MUCH wider net (below), so the two
  // deliberately differ: the listener only needs to attribute captured requests to a
  // semantic clickable, while observation must show the AI EVERY interactive affordance.
  const CLICKABLE_SEL = "a[href],button,[role=button],input[type=submit],input[type=button],[onclick]"
  const elMap = new Map()
  const idOf = new Map() // element → its E-id, so forms can reference their field/submit elements

  // --- Rich DOM observation (§3.3, 2.0) — the AI's eyes -----------------------
  // Goal: the AI must not struggle to understand the page. We surface not just semantic
  // controls but anything MADE interactive (cursor:pointer, onclick, tabindex, role,
  // contenteditable, framework listeners), across open shadow roots and same-origin
  // iframes, each tagged with WHY it is interactive, its aria state, and where it sits.
  // Caveats we cannot beat from a content script: getEventListeners() is DevTools-only
  // (so real listeners are INFERRED, not read); closed shadow roots and cross-origin
  // iframes are opaque (noted, not pierced); canvas content is not introspectable.
  const INTERACTIVE_ROLES = new Set([
    "button", "link", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "checkbox",
    "radio", "switch", "option", "combobox", "textbox", "searchbox", "slider", "spinbutton",
    "treeitem", "gridcell", "listbox",
  ])
  const OBSERVE_SEL =
    "a[href],button,input,select,textarea,summary,[role],[onclick],[tabindex],[contenteditable],[jsaction],[data-action],[ng-click],[data-toggle],[data-testid]"
  const CURSOR_SEL = "div,span,li,td,th,i,svg,img,label,p,h1,h2,h3,article,section"
  const MAX_CLICKABLE = 400
  const MAX_DEEP_NODES = 4000 // shadow/iframe traversal budget per observe
  const ioVisible = new WeakMap() // el → live in-viewport truth from IntersectionObserver
  let io = null
  let lastVisCount = -1
  let mutationBursts = 0

  // Collect elements matching sel across the doc, OPEN shadow roots and SAME-ORIGIN
  // iframes. Budget-capped so a pathological SPA can't hang the observe.
  function deepCollect(sel, root, frameSrc, out, budget) {
    if (budget.n >= MAX_DEEP_NODES) return
    let nodes
    try { nodes = root.querySelectorAll(sel) } catch { return }
    for (const el of nodes) {
      out.push({ el, frameSrc })
      if (out.length >= MAX_CLICKABLE * 3) return
    }
    let all
    try { all = root.querySelectorAll("*") } catch { all = [] }
    for (const h of all) {
      budget.n++
      if (budget.n >= MAX_DEEP_NODES) return
      if (h.shadowRoot) deepCollect(sel, h.shadowRoot, frameSrc, out, budget) // open only; closed → null
      if (h.tagName === "IFRAME") {
        let doc = null
        try { doc = h.contentDocument } catch {}
        if (doc) deepCollect(sel, doc, h.getAttribute("src") || frameSrc || "(iframe)", out, budget)
      }
    }
  }

  function cursorPointer(el) {
    try { return getComputedStyle(el).cursor === "pointer" } catch { return false }
  }
  // Why is this element interactive? Empty ⇒ not interactive (skip). This is the signal
  // that lets the AI trust the list instead of re-reading the DOM.
  function whyInteractive(el, tag) {
    const why = []
    if (tag === "a" && el.getAttribute("href")) why.push("semantic")
    else if (tag === "button" || tag === "select" || tag === "textarea" || tag === "summary") why.push("semantic")
    else if (tag === "input" && (el.getAttribute("type") || "text").toLowerCase() !== "hidden") why.push("semantic")
    const role = el.getAttribute("role")
    if (role && INTERACTIVE_ROLES.has(role.toLowerCase())) why.push("role")
    if (el.hasAttribute("onclick")) why.push("onclick")
    const ti = el.getAttribute("tabindex")
    if (ti !== null && parseInt(ti, 10) >= 0 && !/^(a|button|input|select|textarea|summary)$/.test(tag)) why.push("tabindex")
    const ce = el.getAttribute("contenteditable")
    if (ce === "" || ce === "true") why.push("contenteditable")
    if (
      el.hasAttribute("jsaction") || el.hasAttribute("data-action") || el.hasAttribute("ng-click") ||
      el.hasAttribute("data-toggle") || el.hasAttribute("v-on:click") || el.hasAttribute("@click")
    ) why.push("listener")
    if (why.length === 0 && cursorPointer(el)) why.push("cursor")
    return why
  }
  function ariaOf(el) {
    const a = {}
    const lbl = el.getAttribute("aria-label")
    if (lbl) a.label = lbl.replace(/\s+/g, " ").trim().slice(0, 80)
    for (const k of ["expanded", "haspopup", "controls", "checked", "selected", "current", "pressed", "level", "disabled"]) {
      const v = el.getAttribute("aria-" + k)
      if (v !== null) a[k] = v
    }
    return a
  }
  function isDisabled(el) {
    return el.disabled === true || el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true"
  }
  function inViewport(el) {
    if (ioVisible.has(el)) return ioVisible.get(el) // live truth (survives pure scroll)
    try {
      const r = el.getBoundingClientRect()
      return r.bottom > 0 && r.right > 0 && r.top < (innerHeight || 0) && r.left < (innerWidth || 0)
    } catch { return false }
  }
  function testidOf(el) {
    return (
      el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-cy") ||
      el.getAttribute("data-qa") || ""
    )
  }

  function observePage() {
    const clickables = []
    elMap.clear()
    idOf.clear()
    const raw = []
    deepCollect(OBSERVE_SEL, document, "", raw, { n: 0 })
    // Second pass: cursor:pointer elements with no semantic/attribute hint (divs "made
    // clickable" by JS+CSS). Bounded — getComputedStyle is not free.
    const cursorRaw = []
    deepCollect(CURSOR_SEL, document, "", cursorRaw, { n: 0 })
    for (const r of cursorRaw) raw.push(r)

    const seenEl = new Set()
    let i = 0
    const tracked = []
    for (const { el, frameSrc } of raw) {
      if (i >= MAX_CLICKABLE) break
      if (!el || seenEl.has(el)) continue
      seenEl.add(el)
      if (!visible(el)) continue
      const tag = el.tagName.toLowerCase()
      const why = whyInteractive(el, tag)
      if (why.length === 0) continue
      const eid = "E" + i++
      elMap.set(eid, el)
      idOf.set(el, eid)
      tracked.push(el)
      const c = {
        id: eid,
        tag,
        role: roleOf(el),
        label: labelOf(el),
        href: el.getAttribute("href") || "",
        why: why.join(","),
      }
      const aria = ariaOf(el)
      if (Object.keys(aria).length) c.aria = aria
      if (isDisabled(el)) c.disabled = true
      c.in_viewport = inViewport(el)
      const section = componentPath(el)
      if (section) c.section = section.slice(0, 120)
      const testid = testidOf(el)
      if (testid) c.testid = testid
      if (frameSrc) c.frame = frameSrc
      const rootNode = el.getRootNode && el.getRootNode()
      if (rootNode && rootNode !== document && rootNode.host) c.shadow = true
      clickables.push(c)
    }
    reregisterIO(tracked)

    const forms = []
    for (const f of document.querySelectorAll("form")) {
      if (forms.length >= 40) break
      const fields = []
      for (const el of f.elements) {
        if (!el.name && !el.id) continue
        // id links the field to a real element the AI can type into (empty when the field
        // wasn't captured as interactive — e.g. hidden). name/type/required as before.
        fields.push({ id: idOf.get(el) || "", name: el.name || el.id, type: (el.getAttribute("type") || el.tagName).toLowerCase(), required: el.hasAttribute("required") })
      }
      const sb = f.querySelector('button[type="submit"],input[type="submit"],input[type="image"],button:not([type])')
      forms.push({
        action: f.getAttribute("action") || "",
        method: (f.getAttribute("method") || "get").toLowerCase(),
        fields,
        submit_id: (sb && idOf.get(sb)) || "",
      })
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
    // KEEP IN SYNC with classify.ts Clickable + page-state.ts Observation (cross-runtime
    // wire contract — can't import a shared type here).
    return {
      url: location.href,
      title: document.title,
      clickables,
      forms,
      links,
      description: pageDescription(),
      location: pageLocation(),
      landmarks: landmarksOf(),
      frames: framesOf(),
      canvas: document.querySelectorAll("canvas").length,
      dynamic: mutationBursts > 0,
      tech: collectTech(), // framework fingerprint signals (P2) — server runs FrameworkFingerprinter
    }
  }

  // --- Framework fingerprint signals (P2) — raw markers only; the server classifies them ------
  // Reads page globals via a synchronous MAIN-world probe (content scripts can't see page
  // globals directly). Strict CSP can block the inline script → we simply fall back to the DOM/
  // cookie/meta signals below, which cover most stacks (FLAG: React 18 without the global is the
  // main miss). Never throws — a fingerprint failure must not break observation.
  function readGlobals() {
    try {
      const s = document.createElement("script")
      s.textContent =
        "(function(){try{var g=[],w=window;" +
        "if(w.React||w.__REACT_DEVTOOLS_GLOBAL_HOOK__)g.push('React');" +
        "if(w.ng||w.getAllAngularRootElements)g.push('ng');" +
        "if(w.Vue||w.__VUE__)g.push('Vue');" +
        "if(w.jQuery||(w.$&&w.$.fn&&w.$.fn.jquery))g.push('jQuery');" +
        "if(w.Zone)g.push('Zone');" +
        "if(w.__NEXT_DATA__)g.push('__NEXT_DATA__');" +
        "if(w.__NUXT__)g.push('__NUXT__');" +
        "if(w.__remixContext)g.push('__remixContext');" +
        "document.documentElement.setAttribute('data-cs-tech',g.join(','));}catch(e){}})();"
      document.documentElement.appendChild(s)
      s.remove()
      const v = document.documentElement.getAttribute("data-cs-tech") || ""
      document.documentElement.removeAttribute("data-cs-tech")
      return v ? v.split(",").filter(Boolean) : []
    } catch {
      return []
    }
  }
  function collectTech() {
    const out = { globals: [], dom: [], cookies: [], meta: "", scripts: [] }
    try {
      out.globals = readGlobals()
      if (document.querySelector("[ng-version]")) out.dom.push("ng-version")
      if (document.querySelector("[data-reactroot]")) out.dom.push("data-reactroot")
      if (document.querySelector("[data-sveltekit-hydrate],[data-sveltekit-preload-data]")) out.dom.push("data-sveltekit")
      if (document.getElementById("__NEXT_DATA__")) out.dom.push("__next_data__")
      if (document.querySelector('input[name="__VIEWSTATE"]')) out.dom.push("__viewstate")
      if (document.querySelector('input[name*="javax.faces.ViewState"]')) out.dom.push("javax.faces.viewstate")
      // Vue scoped-style attributes (data-v-<hash>) — bounded scan, can't select by prefix.
      let n = 0
      for (const el of document.querySelectorAll("body *")) {
        if (n++ > 300) break
        if (el.hasAttributes() && [...el.attributes].some((a) => a.name.startsWith("data-v-"))) {
          out.dom.push("data-v")
          break
        }
      }
      out.cookies = (document.cookie || "").split(";").map((c) => c.trim().split("=")[0]).filter(Boolean)
      const gen = document.querySelector('meta[name="generator"]')
      out.meta = (gen && gen.getAttribute("content")) || ""
      const wanted = ["/_next/", "/_nuxt/", "angular", "react", "vue", "jquery"]
      const seen = new Set()
      for (const sc of document.querySelectorAll("script[src]")) {
        const src = (sc.getAttribute("src") || "").toLowerCase()
        for (const w of wanted) if (src.includes(w) && !seen.has(w)) { seen.add(w); out.scripts.push(w) }
      }
    } catch {}
    return out
  }

  // --- Page orientation: "what page is this, where in the app am I" -----------
  function pageDescription() {
    const meta = document.querySelector('meta[name="description"]')
    if (meta && meta.getAttribute("content")) return meta.getAttribute("content").replace(/\s+/g, " ").trim().slice(0, 200)
    const h1 = document.querySelector("h1")
    if (h1 && h1.innerText) return h1.innerText.replace(/\s+/g, " ").trim().slice(0, 200)
    const main = document.querySelector("main,[role=main]") || document.body
    return ((main && main.innerText) || "").replace(/\s+/g, " ").trim().slice(0, 200)
  }
  function pageLocation() {
    const trail = []
    let bc = null
    try { bc = document.querySelector('[aria-label*="breadcrumb" i],nav.breadcrumb,.breadcrumb,[class*="breadcrumb" i]') } catch {}
    if (bc) {
      for (const a of bc.querySelectorAll("a,span,li")) {
        const t = (a.innerText || "").replace(/\s+/g, " ").trim()
        if (t && !trail.includes(t)) trail.push(t)
        if (trail.length >= 6) break
      }
    }
    if (trail.length === 0) {
      let cur = null
      try { cur = document.querySelector('[aria-current="page"],nav [aria-current]') } catch {}
      if (cur && cur.innerText) trail.push(cur.innerText.replace(/\s+/g, " ").trim())
    }
    for (const s of location.pathname.split("/").filter(Boolean)) if (!trail.includes(s)) trail.push(s)
    return trail.slice(0, 8)
  }
  const LANDMARK_SEL = [
    ["header", "banner"], ["nav", "navigation"], ["main", "main"], ["aside", "complementary"],
    ["footer", "contentinfo"], ['[role="search"]', "search"], ['[role="dialog"]', "dialog"],
    ['[role="banner"]', "banner"], ['[role="navigation"]', "navigation"], ['[role="main"]', "main"],
    ['[role="region"][aria-label]', "region"],
  ]
  function landmarksOf() {
    const out = []
    const seen = new Set()
    for (const [sel, role] of LANDMARK_SEL) {
      let els
      try { els = document.querySelectorAll(sel) } catch { continue }
      for (const el of els) {
        if (!visible(el)) continue
        const h = el.querySelector && el.querySelector("h1,h2,legend")
        const label = (el.getAttribute("aria-label") || (h && h.innerText) || "").replace(/\s+/g, " ").trim().slice(0, 60)
        const key = role + "|" + label
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ role, label })
        if (out.length >= 12) return out
      }
    }
    return out
  }
  function framesOf() {
    const out = []
    for (const f of document.querySelectorAll("iframe")) {
      let same = false
      try { same = !!f.contentDocument } catch { same = false }
      out.push({ src: f.getAttribute("src") || "", same_origin: same, title: f.getAttribute("title") || "" })
      if (out.length >= 10) break
    }
    return out
  }

  // --- Live observers: re-observe as the page changes -------------------------
  // MutationObserver → DOM structure/attributes changed (SPA nav, modal open, an element
  // made clickable AFTER load). ResizeObserver → layout/responsive reveal. IntersectionObserver
  // → keeps in_viewport truthful under pure scroll and re-observes when a meaningful batch
  // of content scrolls into view (lazy / infinite scroll). All debounced into one reobserve.
  let reobserveTimer = null
  function scheduleReobserve() {
    if (reobserveTimer) return
    reobserveTimer = setTimeout(() => {
      reobserveTimer = null
      if (host.isConnected) sendObservation()
    }, 800)
  }
  function reregisterIO(els) {
    if (!io) return
    try {
      io.disconnect()
      for (const el of els) io.observe(el)
    } catch {}
  }
  function startObservers() {
    try {
      const mo = new MutationObserver((muts) => {
        mutationBursts += muts.length
        scheduleReobserve()
      })
      mo.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ["class", "style", "hidden", "disabled", "aria-hidden", "aria-expanded", "role", "tabindex", "onclick", "href"],
      })
    } catch {}
    try {
      const ro = new ResizeObserver(() => scheduleReobserve())
      if (document.body) ro.observe(document.body)
    } catch {}
    try {
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) ioVisible.set(e.target, e.isIntersecting)
          let vis = 0
          for (const e of entries) if (e.isIntersecting) vis++
          // Reobserve only on a MEANINGFUL change in visible count (≥3) — a steady page
          // re-fires the same count, so this cannot self-trigger a loop.
          if (lastVisCount >= 0 && Math.abs(vis - lastVisCount) >= 3) scheduleReobserve()
          lastVisCount = vis
        },
        { threshold: 0.01 },
      )
    } catch {}
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
    // A native dialog the MAIN-world patch suppressed (alert/confirm/prompt) — surface it in the
    // HBLog so it's observable (and an alert-based XSS PoC isn't lost) without blocking the loop.
    if (d.__cs_dialog) return void send({ type: "hblog", event: "dialog-suppressed", data: d.__cs_dialog })
    const rec = d.__cs_capture
    if (!rec) return
    rec.page_url = location.href
    if (lastTrigger) {
      rec.trigger_element = lastTrigger.element
      rec.ui_context = lastTrigger.ui_context
    }
    chrome.runtime.sendMessage({ type: "captured", rec }, () => void chrome.runtime.lastError)
  })

  // --- Human-like input (anti-mechanical) ------------------------------------
  // Fill fields as a person would — character by character with an irregular rhythm and full
  // key events — not one instant el.value assignment. Makes AI-driven typing look human and
  // fires the same handlers a real keyboard would (frameworks that listen on keydown/keyup).
  const csleep = (ms) => new Promise((r) => setTimeout(r, ms))
  // React/Vue/Angular override the input's value setter to track state; a plain `el.value = x`
  // is then invisible to them. Setting through the PROTOTYPE's native setter + dispatching input
  // is the only way a programmatic value registers (design §6.3 / P5 native-setter mode).
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, "value")
    if (desc && desc.set) desc.set.call(el, value)
    else el.value = value
  }
  async function humanType(el, text, native) {
    el.focus()
    el.dispatchEvent(new Event("focus", { bubbles: true }))
    const editable = el.isContentEditable
    const put = (v) => {
      if (editable) el.textContent = v
      else if (native) setNativeValue(el, v)
      else {
        try {
          el.value = v
        } catch {}
      }
    }
    put("")
    const s = String(text == null ? "" : text)
    let acc = ""
    for (const ch of s) {
      // 45–165ms per key, with an occasional longer "thinking" pause (~8% of keys).
      await csleep(45 + Math.floor(Math.random() * 120) + (Math.random() < 0.08 ? 250 + Math.floor(Math.random() * 300) : 0))
      el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }))
      el.dispatchEvent(new KeyboardEvent("keypress", { key: ch, bubbles: true }))
      acc += ch
      put(acc)
      el.dispatchEvent(new InputEvent("input", { data: ch, inputType: "insertText", bubbles: true }))
      el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }))
    }
    el.dispatchEvent(new Event("change", { bubbles: true }))
  }

  // Best-effort hydration wait (P5): meta-framework SSR HTML is inert until its JS hydrates. We
  // can't observe framework-internal hydration from an isolated content script, so we approximate:
  // wait for document-complete, then two animation frames + a short settle (hydration runs right
  // after load). Bounded by timeoutMs so it never hangs the driver.
  async function waitHydrated(timeoutMs) {
    const deadline = Date.now() + (Number(timeoutMs) || 4000)
    while (document.readyState !== "complete" && Date.now() < deadline) await csleep(50)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    await csleep(Math.min(200, Math.max(0, deadline - Date.now())))
  }

  chrome.runtime.onMessage.addListener((m, s, sendResponse) => {
    // Popup show/hide toggle for the on-page dock (the panel IS the control surface;
    // the popup is just this toggle). show/hide are explicit; anything else toggles.
    if (m.type === "panel-visibility") {
      // A "toggle" right after a fresh (re)injection means the popup just brought the
      // panel up on a profile that had missed it → show, don't immediately hide.
      const justUp = !host.isConnected || Date.now() - mountedAt < 1500
      const show =
        m.action === "show" ? true : m.action === "hide" ? false : justUp ? true : host.style.display === "none"
      host.style.display = show ? "" : "none"
      sendResponse({ ok: true, visible: show })
      return
    }
    if (m.type !== "perform") return
    const cmd = m.cmd || {}
    // Async so typing can run a human-like keystroke sequence — return true to keep the
    // sendResponse channel open (MV3 requirement).
    ;(async () => {
      try {
        if (cmd.op === "click") {
          const el = elMap.get(cmd.elementId)
          if (!el) return sendResponse({ ok: false, error: "element not found" })
          el.scrollIntoView({ block: "center" })
          await csleep(60)
          aiActivity("AI clicks: " + (labelOf(el) || el.tagName.toLowerCase()))
          aiPointAt(el)
          await csleep(300) // let the cursor visibly glide to the target
          aiClickPulse()
          el.click()
          return sendResponse({ ok: true })
        }
        if (cmd.op === "type") {
          const el = elMap.get(cmd.elementId)
          if (!el) return sendResponse({ ok: false, error: "element not found" })
          el.scrollIntoView({ block: "center" })
          await csleep(60)
          aiActivity("AI types: " + (labelOf(el) || el.getAttribute("name") || "field"))
          aiPointAt(el)
          await csleep(260)
          await humanType(el, cmd.text || "", cmd.mode === "native-setter")
          return sendResponse({ ok: true })
        }
        if (cmd.op === "wait") {
          if (cmd.until === "hydrated") await waitHydrated(cmd.timeoutMs)
          return sendResponse({ ok: true })
        }
        if (cmd.op === "narrate") {
          // "thinking" = the model is planning (no target yet) → breathing cue, no panel entry.
          if (cmd.act === "thinking") {
            aiThinking()
            return sendResponse({ ok: true })
          }
          // A concrete action: panel log always; in-page hue (ring + reason bubble) only when the
          // toggle is on (aiPointAt/aiActivity self-guard on hueOn).
          addReason(cmd.act, cmd.label, cmd.intent)
          aicur.classList.remove("thinking") // planning done — a move was chosen
          const tgt = cmd.elementId ? elMap.get(cmd.elementId) : null
          if (tgt) aiPointAt(tgt)
          if (cmd.intent || cmd.label) aiActivity(cmd.intent || cmd.label)
          return sendResponse({ ok: true })
        }
        if (cmd.op === "navigate") {
          if (!cmd.url) return sendResponse({ ok: false, error: "url required" })
          aiActivity("AI navigates → " + cmd.url)
          await csleep(200)
          location.href = cmd.url
          return sendResponse({ ok: true })
        }
        sendResponse({ ok: false, error: "unknown op" })
      } catch (e) {
        sendResponse({ ok: false, error: String(e) })
      }
    })()
    return true
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
    const csUrl = decodeHash(h.match(/__cs_url=([^&]+)/))
    if (label === null && sess === null && csUrl === null) return
    history.replaceState(null, "", location.pathname + location.search || "/")
    // Point the extension at THIS server (the launcher passes its real URL — may be a non-4096
    // port when 4096 was taken). Without it the extension defaults to :4096 and can talk to a
    // stale/other server, so nothing (observe / driver / control) reaches the running instance.
    if (csUrl) chrome.storage.local.set({ cyberstrike: csUrl.replace(/\/+$/, "") })
    // Set the shared session so this profile joins the one that spawned it.
    if (sess) chrome.storage.local.set({ session: sess })
    if (!label) return
    isSpawned = true // opened by CyberStrike with a role — don't prompt to close others
    // Spawned role browser: a fresh profile lands on the LOGIN screen, so we do NOT
    // auto-capture (that would record login noise and there's no session yet). Pre-fill
    // the role and guide the user to log in first; they click Start capture afterward,
    // which registers the role + attaches on the shared session.
    cred.value = label
    renderRole(label) // shows the "<ROLE> — log in as this identity" banner
    roleHint.textContent = `Log in as "${label}", then press Start capture.`
  }

  let lastUrl = location.href
  // The orchestrator (first, non-spawned) browser shows what's mid-setup in the queue.
  let hadSetup = false
  function pollQueue() {
    if (isSpawned) return
    chrome.runtime.sendMessage({ type: "queue-status" }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) return
      const setup = res.status && res.status.setup
      if (setup) {
        hadSetup = true
        roleHint.textContent =
          setup.phase === "spawning"
            ? `Spawning “${setup.label}” browser…`
            : `Please sign in as “${setup.label}” in the new window, then Start capture there.`
      } else if (hadSetup) {
        hadSetup = false
        roleHint.textContent = ""
      }
    })
  }

  function poll() {
    chrome.runtime.sendMessage({ type: "panel-status" }, (res) => {
      if (chrome.runtime.lastError) return
      render(res)
    })
    pollQueue()
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
    document.body.appendChild(cursorHost)
    document.body.appendChild(roleHost)
    document.body.appendChild(confirmHost)
    document.body.appendChild(host)
    mountedAt = Date.now()
    readCredFromHash()
    updateSide()
    // Diagnostics: proves THIS content script (current build) is running in the tab.
    send({ type: "hblog", event: "content-mounted", data: { url: location.href } })
    startObservers()
    sendObservation()
    loadSessions()
    chrome.storage.local.get("credential", (o) => {
      const label = o && o.credential ? o.credential.label || "" : ""
      // Don't clobber a role already pre-filled by readCredFromHash (spawned browser).
      if (!cred.value) cred.value = label || "Anonymous"
      if (label) renderRole(label)
    })
    poll()
    setInterval(poll, 1500)
  }

  // Credential is set asynchronously (hash → background register → storage), and can
  // change (switch role) or clear (Browse anonymous). Keep the role layer in sync.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.credential) return
    const c = changes.credential.newValue
    renderRole(c && c.label ? c.label : null)
  })

  if (document.body) mount()
  else document.addEventListener("DOMContentLoaded", mount)
})()
