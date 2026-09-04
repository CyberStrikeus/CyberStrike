// CyberStrike HackBrowser 2.0 — panel (content script).
//
// Interaction (final design):
//   - a CyberStrike logo disc sits in the bottom-right corner (draggable, edge-anchored)
//   - hovering it reveals two DETACHED satellites — navy "+" (add credential) on the left,
//     deep-red record (start/stop unauthenticated capture) on the right — plus two sub-buttons
//     below it: an eye (reasoning overlay / HUD toggle) and a gear (settings panel)
//   - tapping the logo CYCLES the driver AI -> Human -> Idle, tinting the whole viewport:
//     AI drives = deep red, Human drives = blue, Idle = navy with NO tab hue (nobody driving)
//   - a bottom-center HUD (also draggable) shows live capture stats + the last 3 AI-reasoning
//     lines; it rides the eye/hue toggle. The AI's synthetic cursor/ring/bubble are cyan.
//   - the gear opens the settings panel (server connect, capture, session, roles, stats, reasoning)
// Driver note: the server only knows ai|human — Idle is a client-only presentation of the human
// interlock (AI paused) shown without the hue; AI drives = "ai" (CoDrive.start).
// Everything is injected in closed shadow roots (dock, HUD, glow, transition, cursor, role, confirm).

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

  // Two SEPARATE color roles (each shadow root inlines these — vars can't cross roots):
  //   1. Driver hue — the whole-viewport / logo mood: AI drives = deep red, Human drives = blue,
  //      Idle = navy (glow off). Used by glow, transition banner, and the dock fab aura.
  //   2. AI-activity cyan — the co-driving overlay (synthetic cursor, target ring, reason bubble)
  //      and the HUD numbers. Kept distinct from the driver hue so "what the AI is touching" reads
  //      as its own signal, not the mood color.
  const AI_RGB = "190,30,40" // driver: AI drives (deep red)
  const HUMAN_RGB = "55,130,246" // driver: Human drives (blue)
  const IDLE_RGB = "41,71,168" // driver: Idle (navy) — glow stays off, only the logo breathes
  const CY_RGB = "34,211,238" // AI-activity + HUD (cyan)

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
      .glow { position: fixed; inset: 0; pointer-events: none; opacity: 0; transition: opacity .5s ease; }
      .glow.on { animation: edgeBreathe 3s ease-in-out infinite; }
      .glow.ai { box-shadow: inset 0 0 100px 18px rgba(${AI_RGB},.5); }
      .glow.human { box-shadow: inset 0 0 100px 18px rgba(${HUMAN_RGB},.5); }
      @keyframes edgeBreathe { 0%,100% { opacity: .45; } 50% { opacity: 1; } }
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
      .trans { position: fixed; inset: 0; pointer-events: none; }
      .msg {
        position: absolute; top: 42%; left: 50%; transform: translate(-50%,-50%) scale(.95);
        font: 700 32px "Space Grotesk", system-ui, -apple-system, sans-serif; letter-spacing: .01em;
        white-space: nowrap; color: #fff; text-shadow: 0 2px 30px rgba(0,0,0,.7);
        padding: 15px 30px; border-radius: 16px;
        background: rgba(8,11,17,.68); backdrop-filter: blur(5px); border: 1px solid rgba(255,255,255,.14);
        opacity: 0; transition: opacity .3s ease, transform .3s ease;
      }
      .trans.show .msg { opacity: 1; transform: translate(-50%,-50%) scale(1); }
      .msg.ai { border-color: rgba(${AI_RGB},.45); text-shadow: 0 2px 30px rgba(0,0,0,.7), 0 0 34px rgba(${AI_RGB},.7); }
      .msg.human { border-color: rgba(${HUMAN_RGB},.45); text-shadow: 0 2px 30px rgba(0,0,0,.7), 0 0 34px rgba(${HUMAN_RGB},.7); }
      .msg.idle { border-color: rgba(${IDLE_RGB},.45); text-shadow: 0 2px 30px rgba(0,0,0,.7), 0 0 34px rgba(${IDLE_RGB},.7); }
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
      .cur { position: fixed; left:-100px; top:-100px; pointer-events:none; opacity:0;
             filter: drop-shadow(0 2px 5px rgba(0,0,0,.6));
             transition: left .5s cubic-bezier(.4,0,.2,1), top .5s cubic-bezier(.4,0,.2,1), opacity .2s; }
      .cur.on { opacity:1; }
      .cur svg { display:block; }
      .dot { position:absolute; left:-13px; top:-13px; width:26px; height:26px; border-radius:50%;
             border:2px solid rgba(${CY_RGB},.85); opacity:0; }
      .cur.pulse .dot { animation: aiPulse .55s ease-out; }
      @keyframes aiPulse { 0%{ transform:scale(.3); opacity:.9 } 100%{ transform:scale(1.6); opacity:0 } }
      /* "Thinking" breathing while the model plans the next move. */
      .cur.thinking .dot { animation: aiBreathe 1.15s ease-in-out infinite; }
      @keyframes aiBreathe { 0%,100%{ transform:scale(.5); opacity:.3 } 50%{ transform:scale(1.25); opacity:.85 } }
      .ring { position: fixed; pointer-events:none; border-radius:8px; opacity:0;
              box-shadow: 0 0 0 2px rgba(${CY_RGB},.95), 0 0 22px 4px rgba(${CY_RGB},.4);
              transition: all .28s cubic-bezier(.4,0,.2,1); }
      .ring.show { opacity:1; }
      .bubble { position: fixed; max-width:300px; padding:9px 13px; border-radius:11px;
                background: rgba(9,14,21,.95); border:1px solid rgba(${CY_RGB},.35);
                box-shadow: 0 10px 34px rgba(0,0,0,.5); color:#dbe6f0; font: 12.5px/1.4 system-ui,-apple-system,sans-serif;
                opacity:0; transform: translateY(4px); transition: all .2s ease; }
      .bubble.show { opacity:1; transform:none; }
      .bubble .who { color:#22d3ee; font-weight:700; font-family:"Space Grotesk",system-ui,sans-serif; font-size:10px;
                     letter-spacing:.1em; text-transform:uppercase; display:block; margin-bottom:3px; }
    </style>
    <div class="cur" id="aicur"><svg width="20" height="20" viewBox="0 0 24 24"><path d="M4 2 L20 12 L13 13 L11 21 Z" fill="#fff" stroke="rgba(${CY_RGB},1)" stroke-width="1.5" stroke-linejoin="round"/></svg><div class="dot"></div></div>
    <div class="ring" id="airing"></div>
    <div class="bubble" id="aibubble"><span class="who" id="aiwho">AI · reasoning</span><span id="aibtxt"></span></div>
  `
  const aicur = curRoot.getElementById("aicur")
  const airing = curRoot.getElementById("airing")
  const aibubble = curRoot.getElementById("aibubble")
  const aiwho = curRoot.getElementById("aiwho")
  const aibtxt = curRoot.getElementById("aibtxt")
  // Position the reasoning bubble just off the cursor (mockup say(): x+20 clamped, y-54 clamped).
  function positionBubble() {
    const cx = parseFloat(aicur.style.left) || 0
    const cy = parseFloat(aicur.style.top) || 0
    aibubble.style.left = Math.min(cx + 20, window.innerWidth - 320) + "px"
    aibubble.style.top = Math.max(cy - 54, 8) + "px"
  }

  // --- Center HUD: capture stats + live AI reasoning (bottom-center, draggable) --------------
  // A page-centered heads-up display mirroring the panel's stats + reasoning, shown while the
  // reasoning overlay (eye/hue) is on. Reasoning is capped to the last 3 lines. Draggable.
  const hudHost = document.createElement("div")
  hudHost.style.cssText = "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483646;"
  const hudRoot = hudHost.attachShadow({ mode: "closed" })
  hudRoot.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .hud { width: min(430px, 88vw); display: flex; flex-direction: column; gap: 8px;
        font-family: system-ui,-apple-system,"Segoe UI",sans-serif; cursor: grab; }
      .hud:active { cursor: grabbing; }
      .box { background: rgba(9,13,20,.82); backdrop-filter: blur(12px); border: 1px solid #1f2b3a; border-radius: 13px;
        box-shadow: 0 18px 46px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.03); }
      .stats { display: grid; grid-template-columns: repeat(4,1fr); padding: 11px 6px; }
      .hs { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 2px 6px; position: relative; }
      .hs + .hs::before { content: ""; position: absolute; left: 0; top: 16%; height: 68%; width: 1px; background: #17222f; }
      .hs .n { font-family: ui-monospace,SFMono-Regular,Menlo,monospace; font-size: 20px; font-weight: 600; color: #22d3ee;
        font-variant-numeric: tabular-nums; line-height: 1; text-shadow: 0 0 16px rgba(${CY_RGB},.3); }
      .hs .l { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: #e8eef5; font-weight: 600; }
      .reason { padding: 9px 13px 10px; }
      .rhead { font-size: 9px; letter-spacing: .1em; text-transform: uppercase; color: #8a99ab; margin-bottom: 6px;
        display: flex; align-items: center; gap: 6px; }
      .rhead::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: #22d3ee; box-shadow: 0 0 8px #22d3ee;
        animation: dotpulse 1.4s ease-in-out infinite; }
      @keyframes dotpulse { 0%,100% { opacity: .5; } 50% { opacity: 1; } }
      .rlog { display: flex; flex-direction: column; gap: 4px; }
      .rlog .rent { font-size: 11.5px; line-height: 1.35; color: #8a99ab; white-space: nowrap; overflow: hidden;
        text-overflow: ellipsis; border-left: 2px solid rgba(${CY_RGB},.55); padding: 2px 0 2px 8px; animation: slidein .25s ease; }
      @keyframes slidein { from { opacity: 0; transform: translateX(-4px); } to { opacity: 1; } }
      .rlog .rent b { color: #e8eef5; font-weight: 600; }
      .rlog .rent .verb { color: #22d3ee; font-family: ui-monospace,monospace; font-size: 10.5px; }
      .rlog:empty::after { content: "waiting for the AI…"; color: #4e5d6f; font-size: 11px; }
    </style>
    <div class="hud" id="hud">
      <div class="box stats">
        <div class="hs"><span class="n" id="h-req">0</span><span class="l">Captures</span></div>
        <div class="hs"><span class="n" id="h-ep">0</span><span class="l">Endpoints</span></div>
        <div class="hs"><span class="n" id="h-js">0</span><span class="l">JS Files</span></div>
        <div class="hs"><span class="n" id="h-pg">0</span><span class="l">Pages</span></div>
      </div>
      <div class="box reason">
        <div class="rhead">AI Reasoning</div>
        <div class="rlog" id="hud-rlog"></div>
      </div>
    </div>
  `
  const hudEl = hudRoot.getElementById("hud")
  const hReq = hudRoot.getElementById("h-req")
  const hEp = hudRoot.getElementById("h-ep")
  const hJs = hudRoot.getElementById("h-js")
  const hPg = hudRoot.getElementById("h-pg")
  const hudRlog = hudRoot.getElementById("hud-rlog")
  function showHud(on) {
    hudHost.style.display = on ? "" : "none"
  }

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
      aibubble.classList.remove("show")
      airing.classList.remove("show")
    }
    showHud(hueOn) // the center HUD rides the same reasoning-overlay toggle
  }
  // Reasoning bubble by the cursor: "AI · reasoning" + the current intent (mockup say()).
  function aiActivity(text) {
    if (!hueOn) return
    aiwho.textContent = "AI · reasoning"
    aibtxt.textContent = text
    aibubble.classList.add("show")
    positionBubble()
  }
  // Thinking cue while the model plans (no target yet): a breathing cursor pulse + "AI · thinking"
  // bubble reading "planning next move…", cleared when the next action arrives.
  function aiThinking() {
    if (!hueOn) return
    aicur.classList.add("on", "thinking")
    aiwho.textContent = "AI · thinking"
    aibtxt.textContent = "planning next move…"
    aibubble.classList.add("show")
    positionBubble()
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
    airing.classList.add("show")
    positionBubble()
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
  // Bottom-right, but ~80px off the edges so the left/right satellites + the sub-buttons reveal
  // fully on-screen (they pop out ±66px / 62px below). Draggable at runtime (edge-anchored + clamped).
  host.style.cssText = "position:fixed;right:80px;bottom:84px;z-index:2147483647;"
  const root = host.attachShadow({ mode: "closed" })

  const GEAR = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>`

  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .dock {
        --panel:#121a26; --line:#1f2b3a; --line-soft:#17222f; --text:#e8eef5; --dim:#8a99ab; --faint:#4e5d6f;
        --ai:#22d3ee; --ai-rgb:34,211,238; --human:#f5a524; --human-rgb:245,165,36; --danger:#e0343f; --blue:#3b82f6;
        --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
        --disp:"Space Grotesk",system-ui,-apple-system,sans-serif;
        --ui:system-ui,-apple-system,"Segoe UI",sans-serif;
        --hue:${IDLE_RGB};
        position: relative; font-family: var(--ui); color: var(--text);
      }

      /* ---- FAB (logo) with driver-hue aura (idle=navy, AI=red, Human=blue) ---- */
      .fab {
        position: relative; z-index: 3; width: 56px; height: 56px; border-radius: 50%; border: 0; padding: 0;
        background: radial-gradient(circle at 50% 38%, #1b2635, #0a0f16);
        display: grid; place-items: center; cursor: pointer; user-select: none;
        box-shadow: 0 6px 20px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.08),
                    0 0 0 2px rgba(var(--hue),.6), 0 0 24px 6px rgba(var(--hue),.5);
        animation: hueBreathe 3s ease-in-out infinite;
        transition: transform .16s ease, box-shadow .3s ease;
      }
      .fab:hover { transform: translateY(-1px); }
      .fab .logo { width: 40px; height: 40px; object-fit: contain; pointer-events: none; display: block; }
      @keyframes hueBreathe { 0%,100% { filter: brightness(.92); } 50% { filter: brightness(1.16); } }
      @media (prefers-reduced-motion: reduce) { .fab { animation: none; } }

      /* ---- satellites: navy "+" (add credential) left, red record (capture) right ---- */
      .wing {
        position: absolute; top: 50%; width: 48px; height: 48px; border-radius: 50%; border: 0; z-index: 2;
        transform: translateY(-50%) scale(.3); opacity: 0; pointer-events: none; cursor: pointer;
        display: grid; place-items: center; color: #fff;
        box-shadow: 0 4px 14px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.2);
        transition: opacity .16s ease, transform .16s ease, right .16s ease, left .16s ease, filter .14s ease;
      }
      .wing.r { right: -10px; background: radial-gradient(circle at 50% 36%, #9e141c, #560a0d); }
      .wing.l { left: -10px; background: radial-gradient(circle at 50% 36%, #1f3570, #0b1230); font-size: 26px; font-weight: 700; line-height: 1; }
      .wing .rec { width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 0 9px rgba(255,255,255,.6); transition: border-radius .16s ease, width .16s ease, height .16s ease; }
      .dock.cap-on .wing.r .rec { border-radius: 4px; width: 16px; height: 16px; }
      .wing:hover { filter: brightness(1.16); }
      .wing:disabled { opacity: .4 !important; cursor: default; }
      .dock.wings .wing { opacity: 1; pointer-events: auto; transform: translateY(-50%) scale(1); }
      .dock.wings .wing.r { right: -66px; }
      .dock.wings .wing.l { left: -66px; }
      .wtip {
        position: absolute; bottom: 56px; left: 50%; transform: translateX(-50%) translateY(3px);
        white-space: nowrap; font-size: 10.5px; letter-spacing: .02em; color: var(--text);
        background: #0c131c; border: 1px solid var(--line); padding: 4px 9px; border-radius: 7px;
        box-shadow: 0 6px 18px rgba(0,0,0,.5); opacity: 0; pointer-events: none; transition: opacity .15s ease, transform .15s ease;
      }
      .dock.wings .wing:hover .wtip { opacity: 1; transform: translateX(-50%) translateY(0); }

      /* ---- sub-buttons below the logo: eye (reasoning overlay) + gear (settings) ---- */
      .sub {
        position: absolute; top: 50%; left: 50%; width: 30px; height: 30px; border-radius: 50%; border: 0; z-index: 1;
        transform: translate(-50%, -50%) scale(.4); opacity: 0; pointer-events: none; cursor: pointer;
        background: #0c131d; color: var(--dim); display: grid; place-items: center;
        box-shadow: 0 4px 12px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.08);
        transition: opacity .16s ease, transform .16s ease, color .14s ease, background .14s ease;
      }
      .sub:hover { color: var(--text); background: #17222f; }
      .sub.off { color: var(--faint); }
      .dock.wings .sub { opacity: 1; pointer-events: auto; }
      .dock.wings .sub.eye  { transform: translate(calc(-50% - 21px), calc(-50% + 62px)) scale(1); }
      .dock.wings .sub.gear { transform: translate(calc(-50% + 21px), calc(-50% + 62px)) scale(1); }
      .sub svg { width: 15px; height: 15px; display: block; }

      /* ---- settings panel ---- */
      .panel {
        position: absolute; right: 0; bottom: 68px; width: 268px;
        background: var(--panel); border: 1px solid var(--line); border-radius: 15px; overflow: hidden;
        box-shadow: 0 20px 60px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.03);
        opacity: 0; transform: translateY(8px) scale(.98); pointer-events: none; transform-origin: bottom right;
        transition: opacity .18s ease, transform .18s ease;
      }
      .dock.open .panel { opacity: 1; transform: none; pointer-events: auto; }
      .phead {
        display: flex; align-items: center; gap: 9px; padding: 13px 15px; border-bottom: 1px solid var(--line-soft);
        background: linear-gradient(180deg, rgba(var(--ai-rgb),.05), transparent);
      }
      .phead .mark { width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; }
      .phead .mark img { width: 20px; height: 20px; object-fit: contain; }
      .phead .name { font-family: var(--disp); font-weight: 700; letter-spacing: .12em; font-size: 11.5px; }
      .status { margin-left: auto; font-size: 9.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .07em; padding: 3px 9px; border-radius: 999px; background: #182430; color: var(--dim); }
      .dock.capturing.ai .status { background: rgba(var(--ai-rgb),.15); color: var(--ai); }
      .dock.capturing.human .status { background: rgba(var(--human-rgb),.15); color: var(--human); }
      .pbody { padding: 13px 15px 15px; }
      .lbl { font-size: 9.5px; color: var(--faint); text-transform: uppercase; letter-spacing: .08em; margin: 12px 0 5px; }
      .lbl:first-child { margin-top: 0; }
      .fld {
        width: 100%; height: 32px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px;
        background: #0b121b; color: var(--text); font-family: var(--mono); font-size: 12px; outline: none; transition: border-color .14s ease;
      }
      .fld:focus { border-color: rgba(var(--ai-rgb),.55); }
      .fld::placeholder { color: var(--faint); font-family: var(--ui); }
      .rowg { display: flex; gap: 7px; }
      .rowg .fld { flex: 1; }
      .mini { padding: 0 13px; height: 32px; border: 1px solid var(--line); border-radius: 8px; background: #17222f; color: var(--text); font-family: var(--ui); font-weight: 600; font-size: 11.5px; cursor: pointer; white-space: nowrap; transition: all .14s ease; }
      .mini:hover { background: #1e2b3a; }
      .mini.go { background: var(--ai); color: #06121a; border-color: var(--ai); }
      .cta {
        width: 100%; height: 40px; margin-top: 14px; border: 0; border-radius: 10px; cursor: pointer;
        font-family: var(--disp); font-weight: 700; font-size: 13px; letter-spacing: .02em; color: #06121a;
        background: linear-gradient(180deg, #3ee0f2, var(--ai)); box-shadow: 0 6px 18px rgba(var(--ai-rgb),.25); transition: filter .14s ease;
      }
      .cta:hover { filter: brightness(1.06); }
      .cta.stop { background: linear-gradient(180deg, #f04a54, var(--danger)); color: #fff; box-shadow: 0 6px 18px rgba(224,52,63,.25); }
      .brk { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line-soft); }
      .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .stat { background: #0c131d; border: 1px solid var(--line-soft); border-radius: 9px; padding: 8px 10px; }
      .stat .k { font-size: 9.5px; color: var(--faint); text-transform: uppercase; letter-spacing: .05em; }
      .stat .v { font-family: var(--mono); font-size: 17px; font-weight: 600; color: var(--text); margin-top: 2px; }
      .stat.hl .v { color: var(--ai); }
      .rlog { margin-top: 8px; max-height: 132px; overflow-y: auto; display: flex; flex-direction: column; gap: 5px; padding-right: 2px; }
      .rlog::-webkit-scrollbar { width: 5px; } .rlog::-webkit-scrollbar-thumb { background: #223142; border-radius: 3px; }
      .rlog:empty::after { content: "waiting for the AI…"; color: var(--faint); font-size: 11px; }
      .rent { font-size: 11.5px; line-height: 1.35; color: var(--dim); border-left: 2px solid rgba(var(--ai-rgb),.55); padding: 2px 0 2px 8px; animation: slidein .25s ease; }
      .rent b { color: var(--text); font-weight: 600; }
      .rent .verb { color: var(--ai); font-family: var(--mono); font-size: 10.5px; }
      @keyframes slidein { from { opacity: 0; transform: translateX(-4px); } to { opacity: 1; } }
      /* AI link — the co-driving connection state + model, shown while AI drives (troubleshooting). */
      .ailink { display: none; align-items: center; gap: 7px; margin-top: 9px; font-size: 10.5px; color: var(--dim); }
      .ailink.show { display: flex; }
      .ailink .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); flex: none; }
      .ailink.ok .dot { background: #22c55e; box-shadow: 0 0 8px #22c55e; }
      .ailink.wait .dot { background: var(--human); box-shadow: 0 0 7px var(--human); animation: linkpulse 1.2s ease-in-out infinite; }
      .ailink.err .dot { background: var(--danger); box-shadow: 0 0 8px var(--danger); }
      .ailink .mono { font-family: var(--mono); color: var(--text); }
      @keyframes linkpulse { 0%,100% { opacity: .4; } 50% { opacity: 1; } }
      .hint { font-size: 10.5px; color: var(--faint); margin-top: 8px; min-height: 12px; }
    </style>

    <div class="dock" id="dock">
      <div class="panel" id="panel">
        <div class="phead">
          <span class="mark"><img src="${LOGO_SRC}" alt="" /></span>
          <span class="name">CYBERSTRIKE</span>
          <span class="status" id="state">detached</span>
        </div>
        <div class="pbody">
          <div class="lbl">CyberStrike server</div>
          <div class="rowg">
            <input class="fld" id="srvUrl" type="text" placeholder="http://127.0.0.1:4096" spellcheck="false" />
            <button class="mini go" id="srvConnect">Connect</button>
          </div>
          <input class="fld" id="srvPw" type="password" placeholder="password (remote / tunnel only)" style="margin-top:7px" />
          <button class="cta" id="attachBtn">Start capture</button>
          <div class="ailink" id="ailink"><span class="dot"></span><span class="txt" id="ailinkTxt"></span></div>
          <div class="lbl">CyberStrike session</div>
          <div class="rowg">
            <select class="fld" id="sess"><option value="">-- New session --</option></select>
            <button class="mini" id="refreshSess" title="Reload sessions from CyberStrike">&#8635;</button>
          </div>
          <div class="lbl">This profile's role (empty = anonymous)</div>
          <div class="rowg">
            <input class="fld" id="cred" type="text" placeholder="Anonymous" />
            <button class="mini" id="setCred">Set</button>
          </div>
          <div class="lbl">Add credential (opens a new browser)</div>
          <div class="rowg">
            <input class="fld" id="newRole" type="text" placeholder="e.g. user" />
            <button class="mini" id="addRole">Add</button>
          </div>
          <div class="hint" id="roleHint"></div>
          <div class="brk">
            <div class="stats">
              <div class="stat hl"><div class="k">Captured</div><div class="v" id="s-total">0</div></div>
              <div class="stat"><div class="k">Endpoints</div><div class="v" id="s-api">0</div></div>
              <div class="stat"><div class="k">JS files</div><div class="v" id="s-js">0</div></div>
              <div class="stat"><div class="k">Pages</div><div class="v" id="s-page">0</div></div>
            </div>
            <div class="rlog" id="rlog"></div>
          </div>
        </div>
      </div>
      <button class="wing l" id="wLeft" title="Add Credential/Role">+<span class="wtip">Add Credential/Role</span></button>
      <button class="wing r" id="wRight" title="Start Unauthenticated Recording"><span class="rec"></span><span class="wtip">Start Unauthenticated Recording</span></button>
      <button class="sub eye" id="hueBtn" title="AI reasoning overlay">${EYE_ON}</button>
      <button class="sub gear" id="gear" title="Settings">${GEAR}</button>
      <button class="fab" id="fab" title="Toggle driver"><img class="logo" src="${LOGO_SRC}" alt="CyberStrike" draggable="false" /></button>
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
    hueBtn.classList.toggle("off", !hueOn)
  }
  reflectHue()
  hueBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    setHue(!hueOn)
    reflectHue()
  })
  // Append one reasoning entry. Built with DOM nodes (never innerHTML) — label/intent come from
  // the page/model, so string-interpolating them into HTML would be an injection into our root.
  function rentNode(verb, label, intent) {
    const row = document.createElement("div")
    row.className = "rent"
    const v = document.createElement("span")
    v.className = "verb"
    v.textContent = verb
    row.append(v, " ")
    if (label) {
      const b = document.createElement("b")
      b.textContent = String(label)
      row.append(b)
    }
    const why = intent && String(intent).trim()
    if (why) row.append(" — " + why)
    return row
  }
  // Append one reasoning entry to BOTH the panel log (last 40) and the center HUD (last 3). Built
  // with DOM nodes (never innerHTML) — label/intent come from the page/model, so interpolating them
  // into HTML would inject into our root.
  function addReason(act, label, intent) {
    const verb = act === "click" ? "click" : act === "type" ? "type into" : act === "navigate" ? "go to" : act === "form" ? "submit" : String(act || "act")
    if (rlog) {
      rlog.appendChild(rentNode(verb, label, intent))
      while (rlog.childElementCount > 40) rlog.removeChild(rlog.firstChild)
      rlog.scrollTop = rlog.scrollHeight
    }
    if (hudRlog) {
      hudRlog.appendChild(rentNode(verb, label, intent))
      while (hudRlog.childElementCount > 3) hudRlog.removeChild(hudRlog.firstChild)
      hudRlog.scrollTop = hudRlog.scrollHeight
    }
  }
  const panel = root.getElementById("panel")
  const stateEl = root.getElementById("state")
  const ailink = root.getElementById("ailink")
  const ailinkTxt = root.getElementById("ailinkTxt")
  const sTotal = root.getElementById("s-total")
  const sApi = root.getElementById("s-api")
  const sJs = root.getElementById("s-js")
  const sStatic = root.getElementById("s-static") // may be absent (not shown in the compact panel)
  const sPage = root.getElementById("s-page")

  let driver = "idle" // AI | Human | Idle (3-way logo cycle); detached defaults to Idle (calm navy)
  let settingsOpen = false
  let pageCount = 0
  let mountedAt = 0 // when the dock was appended — see panel-visibility (popup toggle)
  let isSpawned = false // true in a browser CyberStrike spawned (opened with a role hash)

  // Hovering anywhere on the dock cluster (logo, satellites, sub-buttons, panel) reveals the
  // satellites + subs AND pauses the AI (set-hold), so a full-page navigation doesn't wipe the
  // panel out from under the user mid-interaction. A short close delay bridges the gaps between the
  // detached pieces; the hold is released only once the cluster is left AND settings is closed.
  let hoverTimer = null
  let holdOn = false
  function setHold(want) {
    if (want === holdOn) return
    holdOn = want
    send({ type: "set-hold", held: want })
  }
  function clusterOn() {
    if (hoverTimer) clearTimeout(hoverTimer)
    dock.classList.add("wings")
    setHold(true)
  }
  function clusterOff() {
    hoverTimer = setTimeout(() => {
      if (settingsOpen) return
      dock.classList.remove("wings")
      setHold(false)
    }, 260)
  }

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
    if (status && status.attached) {
      // Capturing → the red wing is a STOP button now (record ■). Detach.
      await send({ type: "toggle-attach-self" })
      flashTransition("Recording stopped", "", "", 1100)
      poll()
      return
    }
    wRight.disabled = true
    const res = await send({ type: "start-capture", role: "Anonymous", url: location.href })
    wRight.disabled = false
    if (res && res.ok) flashTransition("Unauthenticated recording started", "", "#9e141c", 1300)
    else roleHint.textContent = (res && res.error) || "failed (need local CyberStrike + reachable server)"
    poll()
  })
  wLeft.addEventListener("click", (e) => {
    e.stopPropagation()
    // Add credential needs a role NAME → open the panel focused on the role input.
    settingsOpen = true
    dock.classList.add("open", "wings")
    try {
      newRole.focus()
    } catch {}
  })

  // Cluster hover: reveal the satellites + subs (and pause the AI) while the pointer is over any
  // piece of the dock. Attached here, once every piece exists.
  ;[fab, wLeft, wRight, hueBtn, gear, panel].forEach((el) => {
    el.addEventListener("mouseenter", clusterOn)
    el.addEventListener("mouseleave", clusterOff)
  })

  // Driver hue on the dock: idle = navy, AI drives = deep red, Human drives = blue.
  function applyDriverHue(d) {
    dock.style.setProperty("--hue", d === "ai" ? AI_RGB : d === "human" ? HUMAN_RGB : IDLE_RGB)
    dock.classList.toggle("ai", d === "ai")
    dock.classList.toggle("human", d === "human")
    dock.classList.toggle("idle", d === "idle")
  }

  // AI link indicator: while AI drives, show whether the control channel to CyberStrike is up and
  // which MAIN model it planned with — so the user can confirm the AI actually connected (and, if
  // not, tell a backend/comms problem apart from a working run). Flashes "Connected · <model>" once.
  let aiWaitSince = 0
  let linkState = "" // "" | capture | unreach | connecting | connected | error
  let csReachable = null // last ping-cs result (null = not yet probed) — set on switching to AI
  function setLink(cls, text, model) {
    ailink.className = "ailink show " + cls
    ailinkTxt.textContent = text
    if (model) {
      ailinkTxt.append(" · ")
      const m = document.createElement("span")
      m.className = "mono"
      m.textContent = model
      ailinkTxt.append(m)
    }
  }
  // Flash a center banner ONCE per state change, so the connection result is visible without opening
  // the settings panel (the panel indicator is buried until the user opens it).
  function flashLink(state, model) {
    if (state === linkState) return
    linkState = state
    if (state === "connecting") flashTransition("Connecting to CyberStrike…", "ai", "", 1400)
    else if (state === "connected") flashTransition(model ? "Connected · " + model : "Connected", "ai", "", 1600)
    else if (state === "capture") flashTransition("Start capture to connect the AI", "ai", "", 1600)
    else if (state === "unreach" || state === "error") flashTransition("CyberStrike unreachable", "", "#e0343f", 1800)
  }
  function updateLink(status, attached) {
    if (driver !== "ai") {
      ailink.className = "ailink"
      aiWaitSince = 0
      linkState = ""
      return
    }
    const control = !!(status && status.control)
    const model = (status && status.model) || ""
    if (attached && control) {
      aiWaitSince = 0
      setLink("ok", "connected", model)
      flashLink("connected", model)
      return
    }
    if (attached && !control) {
      // Capturing but the control channel isn't open — connecting, or (after a grace) a real failure.
      if (!aiWaitSince) aiWaitSince = Date.now()
      if (Date.now() - aiWaitSince > 5000) {
        setLink("err", "no connection — is CyberStrike running?")
        flashLink("error")
      } else {
        setLink("wait", "connecting to the model…")
        flashLink("connecting")
      }
      return
    }
    // Not capturing yet: the AI needs a capture session to drive. Use the reachability probe to tell
    // an unreachable backend apart from just-needs-capture, so a down CyberStrike is obvious here too.
    aiWaitSince = 0
    if (csReachable === false) {
      setLink("err", "CyberStrike unreachable")
      flashLink("unreach")
    } else if (csReachable === true) {
      setLink("wait", "start capture to connect the AI")
      flashLink("capture")
    } else {
      setLink("wait", "checking CyberStrike…") // probe still in flight
    }
  }

  function updateSide() {
    const cx = host.getBoundingClientRect().left + host.offsetWidth / 2
    const onRight = cx > window.innerWidth / 2
    dock.classList.toggle("right", onRight)
    dock.classList.toggle("left", !onRight)
  }

  function render(status) {
    const attached = !!(status && status.attached)
    // Reconcile the backend driver (ai|human) with the local 3-state (ai|human|idle). Idle is
    // client-only — cycling to it posts "human", so a status "human" must not clobber "idle". While
    // detached the display is left as-is (defaults to the calm navy Idle).
    if (attached && status && status.driver) {
      if (!(status.driver === "human" && driver === "idle")) driver = status.driver
    }
    dock.classList.toggle("capturing", attached)
    dock.classList.toggle("cap-on", attached) // red satellite: record ● → stop ■
    applyDriverHue(driver)
    attachBtn.textContent = attached ? "Stop capture" : "Start capture"
    attachBtn.classList.toggle("stop", attached)
    wRight.title = attached ? "Stop Recording" : "Start Unauthenticated Recording"
    const wt = wRight.querySelector(".wtip")
    if (wt) wt.textContent = wRight.title

    if (status && status.stats) {
      const st = status.stats
      sTotal.textContent = st.total || 0
      sApi.textContent = st.api || 0
      sJs.textContent = st.js || 0
      if (sStatic) sStatic.textContent = st.static || 0
      hReq.textContent = st.total || 0
      hEp.textContent = st.api || 0
      hJs.textContent = st.js || 0
    }
    sPage.textContent = pageCount
    hPg.textContent = pageCount
    stateEl.textContent = !attached ? "detached" : driver === "human" ? "you drive" : driver === "idle" ? "idle" : "AI driving"
    updateLink(status, attached)

    // Tab-edge glow reflects a REAL link, not just the toggle: AI red only when the control channel
    // to CyberStrike is actually open, Human blue while capturing, and NOTHING in Idle (or when
    // nothing is connected) — so a page you're only browsing, or a down backend, stays calm.
    const control = !!(status && status.control)
    const aiLive = driver === "ai" && control
    const humanLive = driver === "human" && attached
    glow.classList.toggle("on", aiLive || humanLive)
    glow.classList.toggle("ai", aiLive)
    glow.classList.toggle("human", humanLive)
  }

  // --- Drag (edge-anchored + clamped, like a chat-head widget) ----------------
  // Both the dock host and the HUD host are draggable: dropped near a corner they anchor to that
  // corner (staying put on resize) and never land off-screen. A press that barely moves is a click
  // (→ the handle's onClick). Same behaviour the design mockup landed on.
  const draggedHosts = []
  function anchorHost(el, left, top) {
    const w = el.offsetWidth,
      h = el.offsetHeight,
      m = 6
    left = Math.max(m, Math.min(left, window.innerWidth - w - m))
    top = Math.max(m, Math.min(top, window.innerHeight - h - m))
    if (left + w / 2 > window.innerWidth / 2) {
      el.style.right = window.innerWidth - left - w + "px"
      el.style.left = "auto"
    } else {
      el.style.left = left + "px"
      el.style.right = "auto"
    }
    if (top + h / 2 > window.innerHeight / 2) {
      el.style.bottom = window.innerHeight - top - h + "px"
      el.style.top = "auto"
    } else {
      el.style.top = top + "px"
      el.style.bottom = "auto"
    }
    el.style.transform = "none"
  }
  function reclampHost(el) {
    const r = el.getBoundingClientRect()
    anchorHost(el, r.left, r.top)
  }
  window.addEventListener("resize", () => draggedHosts.forEach(reclampHost))
  function makeHostDraggable(el, handle, onClick) {
    let sx, sy, ox, oy, mv, active
    function down(e) {
      const p = e.touches ? e.touches[0] : e
      active = true
      mv = false
      sx = p.clientX
      sy = p.clientY
      const r = el.getBoundingClientRect()
      ox = r.left
      oy = r.top
      e.preventDefault()
    }
    function move(e) {
      if (!active) return
      const p = e.touches ? e.touches[0] : e
      const dx = p.clientX - sx,
        dy = p.clientY - sy
      if (!mv && Math.abs(dx) + Math.abs(dy) < 5) return
      mv = true
      el.style.left = ox + dx + "px"
      el.style.top = oy + dy + "px"
      el.style.right = "auto"
      el.style.bottom = "auto"
      el.style.transform = "none"
      if (el === host) updateSide()
    }
    function up(e) {
      if (!active) return
      active = false
      if (mv) {
        const r = el.getBoundingClientRect()
        anchorHost(el, r.left, r.top)
        if (!draggedHosts.includes(el)) draggedHosts.push(el)
      } else if (onClick) {
        onClick(e)
      }
    }
    handle.addEventListener("mousedown", down)
    handle.addEventListener("touchstart", down, { passive: false })
    document.addEventListener("mousemove", move)
    document.addEventListener("touchmove", move, { passive: false })
    document.addEventListener("mouseup", up)
    document.addEventListener("touchend", up)
  }

  // Logo tap → cycle the driver (AI → Human → Idle) + flash + report to the server.
  const DRV_CYCLE = ["ai", "human", "idle"]
  function cycleDriver() {
    driver = DRV_CYCLE[(DRV_CYCLE.indexOf(driver) + 1) % DRV_CYCLE.length]
    applyDriverHue(driver)
    if (driver === "ai") {
      // Don't claim "AI drives" until we've actually reached CyberStrike. Probe first; the link
      // state (connecting -> connected · model / unreachable) then drives the banner + the red hue.
      csReachable = null
      flashTransition("Connecting to CyberStrike…", "ai", "", 1400)
      linkState = "connecting"
      send({ type: "ping-cs" }).then((r) => {
        csReachable = !!(r && r.reachable)
        poll() // refresh the link indicator + banner with the probe result
      })
    } else {
      flashTransition(driver === "human" ? "Human Drives the Browser" : "CyberStrike Idle", driver)
    }
    // Backend accepts only ai|human: AI drives = "ai" (CoDrive.start); Human AND Idle both pause the
    // AI via the human interlock — Idle is that same pause, presented without the hue.
    chrome.runtime.sendMessage({ type: "set-driver", driver: driver === "ai" ? "ai" : "human" }, (res) => render(res))
  }
  makeHostDraggable(host, fab, cycleDriver)
  makeHostDraggable(hudHost, hudEl)

  gear.addEventListener("click", (e) => {
    e.stopPropagation()
    settingsOpen = !settingsOpen
    dock.classList.toggle("open", settingsOpen)
    if (settingsOpen) dock.classList.add("wings")
  })

  // Dismiss the settings panel: pointer leaves the dock (but NOT while a field has focus — don't
  // yank it mid-typing), a click outside the dock host, or Escape.
  let settingsTimer = null
  function cancelCloseSettings() {
    if (settingsTimer) {
      clearTimeout(settingsTimer)
      settingsTimer = null
    }
  }
  function dismissPanel() {
    settingsOpen = false
    dock.classList.remove("open", "wings")
  }
  function closeSettings() {
    const a = root.activeElement
    if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) {
      settingsTimer = setTimeout(closeSettings, 400) // still editing — retry later
      return
    }
    dismissPanel()
  }
  dock.addEventListener("mouseenter", cancelCloseSettings)
  dock.addEventListener("mouseleave", () => {
    if (!settingsOpen) return
    cancelCloseSettings()
    settingsTimer = setTimeout(closeSettings, 320)
  })
  document.addEventListener("click", (e) => {
    if (!settingsOpen) return
    // A click routed through the dock host (closed shadow root) keeps the panel open; anything
    // else on the page dismisses it.
    if (e.composedPath && e.composedPath().includes(host)) return
    dismissPanel()
  })
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && settingsOpen) dismissPanel()
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
  let mo = null // MutationObserver — hoisted so teardown() (extension disable) can disconnect it
  let ro = null // ResizeObserver — same
  let pollTimer = null // the status poll interval — cleared on disable
  let disabled = false // true once the user disables the extension from the popup
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
      mo = new MutationObserver((muts) => {
        mutationBursts += muts.length
        scheduleReobserve()
      })
      mo.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ["class", "style", "hidden", "disabled", "aria-hidden", "aria-expanded", "role", "tabindex", "onclick", "href"],
      })
    } catch {}
    try {
      ro = new ResizeObserver(() => scheduleReobserve())
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
      setPanelVisible(show)
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
    // A launch hash ⇒ this is a CyberStrike-SPAWNED profile (throwaway CfT). Marks it so the
    // watchdog only ever self-closes spawned browsers, never a user's self-installed one.
    chrome.storage.local.set({ spawned: true })
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
    if (disabled) return // extension disabled from the popup → stay dormant
    if (!document.body) return
    if (document.getElementById("cyberstrike-panel-host")) return
    document.body.appendChild(glowHost)
    document.body.appendChild(transHost)
    document.body.appendChild(cursorHost)
    document.body.appendChild(hudHost)
    document.body.appendChild(roleHost)
    document.body.appendChild(confirmHost)
    document.body.appendChild(host)
    showHud(hueOn) // center HUD visible iff the reasoning overlay is on
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
    pollTimer = setInterval(poll, 1500)
  }

  // Fully disable the extension for this tab (popup toggle): stop the poll + all observers, release
  // any hold, DETACH (so the background stops capturing and drops the control channel once the last
  // tab detaches), and remove every injected host so nothing is left running or on screen.
  function teardown() {
    disabled = true
    try {
      if (pollTimer) clearInterval(pollTimer)
    } catch {}
    pollTimer = null
    try {
      if (io) io.disconnect()
    } catch {}
    try {
      if (mo) mo.disconnect()
    } catch {}
    try {
      if (ro) ro.disconnect()
    } catch {}
    io = mo = ro = null
    setHold(false)
    send({ type: "detach" })
    for (const h of [glowHost, transHost, cursorHost, hudHost, roleHost, confirmHost, host]) {
      try {
        h.remove()
      } catch {}
    }
  }
  // Re-enable: mount from scratch (idempotent).
  function enable() {
    if (!disabled) return
    disabled = false
    if (document.body) mount()
    else document.addEventListener("DOMContentLoaded", mount, { once: true })
  }

  // Show/hide the WHOLE on-page presence together (popup "show / hide panel"). The dock, the center
  // HUD, the edge glow, the AI cursor overlay, the role banner and the transition line each live in
  // their own host — hiding only the dock would leave the HUD (and glow) floating, so toggle them as
  // one. On show, the HUD returns to its hue-driven visibility rather than being forced on.
  function setPanelVisible(show) {
    const d = show ? "" : "none"
    host.style.display = d
    glowHost.style.display = d
    cursorHost.style.display = d
    roleHost.style.display = d
    transHost.style.display = d
    hudHost.style.display = show ? (hueOn ? "" : "none") : "none"
  }

  // Credential is set asynchronously (hash → background register → storage), and can change (switch
  // role) or clear. The `enabled` flag is the popup's master on/off — every open tab reacts to it.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return
    if (changes.enabled) {
      if (changes.enabled.newValue === false) {
        if (!disabled) teardown()
      } else if (disabled) {
        enable()
      }
    }
    if (changes.credential) {
      const c = changes.credential.newValue
      renderRole(c && c.label ? c.label : null)
    }
  })

  // Initial mount respects the master enable flag (default ON) so a disabled extension stays dormant.
  chrome.storage.local.get("enabled", (o) => {
    if (o && o.enabled === false) {
      disabled = true
      return
    }
    if (document.body) mount()
    else document.addEventListener("DOMContentLoaded", mount, { once: true })
  })
})()
