/**
 * Browser-agent live telemetry panel. See PANEL_UI_BRIEF.md.
 *
 * PANEL_INIT_SCRIPT is passed to playwright's context.addInitScript. It runs in
 * the target page context on every new document (navigation = fresh panel).
 * Agent communicates one-way via `window.__csEvent(event)` — see CSEvent union
 * in types.ts and the csEmit helper in panel/emit.ts.
 *
 * Architecture:
 *   - Host div: #__cs-host, covers viewport, data-cyberstrike-ui="panel",
 *     pointer-events: none. Scanner/capture filter on this attribute.
 *   - Shadow DOM (closed) inside host — target page CSS cannot bleed in.
 *   - Two z-ordered regions in the shadow:
 *       .paint  → full-viewport overlay for Target Paint outlines
 *       .card   → bottom-right mini card / expanded panel
 *   - Events before mount queue into window.__csQueue, replayed at mount.
 */

// CSS and HTML are passed as JSON-encoded strings into the IIFE so the outer
// TS template literal does not have to escape their characters. Only the JS
// body below needs `\`` and `\${` escapes.

const PANEL_CSS = `
:host, .root { all: initial; }
.root {
  position: fixed; inset: 0;
  pointer-events: none;
  z-index: 2147483647;
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.45;
  color: #e5e7eb;
  -webkit-font-smoothing: antialiased;
}
.root * { box-sizing: border-box; margin: 0; padding: 0; font: inherit; color: inherit; }
.root svg { display: block; }

/* =========================== Target Paint =========================== */
.paint { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.paint-box {
  position: absolute;
  border: 1.5px dashed #22d3ee;
  box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.2), 0 0 16px rgba(34, 211, 238, 0.35);
  border-radius: 2px;
  transition: opacity 180ms ease-out;
  opacity: 0;
}
.paint-box.on { opacity: 1; }
.paint-box.hit { border-color: #ef4444; box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.25), 0 0 20px rgba(239, 68, 68, 0.55); }
.paint-box.ok  { border-color: #22d3ee; }
.paint-label {
  position: absolute;
  background: #0b0f14;
  border: 1px solid #22d3ee;
  color: #22d3ee;
  padding: 2px 6px;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  transform: translateY(-100%);
  margin-top: -4px;
}
.paint-box.hit .paint-label { border-color: #ef4444; color: #ef4444; }

/* =========================== Card base =========================== */
.card {
  position: absolute;
  bottom: 16px; right: 16px;
  width: 360px;
  background: #0b0f14;
  border: 1px solid #1f2937;
  pointer-events: auto;
  transition: width 200ms ease-out, height 200ms ease-out;
  box-shadow: 0 10px 40px -10px rgba(0,0,0,0.8);
  overflow: hidden;
}
.card.expanded { width: 460px; }

/* corner brackets — tactical HUD accent */
.bracket { position: absolute; width: 10px; height: 10px; pointer-events: none; }
.bracket::before, .bracket::after {
  content: ""; position: absolute; background: #22d3ee;
}
.bracket.tl::before { top: 0; left: 0; width: 10px; height: 1px; }
.bracket.tl::after  { top: 0; left: 0; width: 1px; height: 10px; }
.bracket.tr::before { top: 0; right: 0; width: 10px; height: 1px; }
.bracket.tr::after  { top: 0; right: 0; width: 1px; height: 10px; }
.bracket.bl::before { bottom: 0; left: 0; width: 10px; height: 1px; }
.bracket.bl::after  { bottom: 0; left: 0; width: 1px; height: 10px; }
.bracket.br::before { bottom: 0; right: 0; width: 10px; height: 1px; }
.bracket.br::after  { bottom: 0; right: 0; width: 1px; height: 10px; }
.bracket.tl { top: -1px; left: -1px; }
.bracket.tr { top: -1px; right: -1px; }
.bracket.bl { bottom: -1px; left: -1px; }
.bracket.br { bottom: -1px; right: -1px; }

/* header */
.hdr {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px;
  background: #0b0f14;
  border-bottom: 1px solid #1f2937;
  cursor: pointer;
  user-select: none;
}
.hdr .logo {
  width: 10px; height: 10px; border-radius: 50%;
  background: #ef4444;
  box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.3), 0 0 8px rgba(239, 68, 68, 0.6);
  animation: rec-pulse 1.4s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes rec-pulse {
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 1; }
}
.hdr .rec {
  color: #ef4444;
  letter-spacing: 0.12em;
  font-size: 10px;
}
.hdr .sep { color: #374151; }
.hdr .cs {
  color: #22d3ee;
  font-weight: 600;
  letter-spacing: 0.08em;
  font-size: 12px;
}
.hdr .cred-ring {
  padding: 2px 7px;
  border: 1px solid #22d3ee;
  border-radius: 2px;
  color: #e5e7eb;
  font-size: 11px;
  letter-spacing: 0.04em;
  transition: border-color 250ms ease-out;
}
.hdr .cred-ring.manager { border-color: #f59e0b; }
.hdr .cred-ring.user    { border-color: #6b7280; }
.hdr .cred-ring.multi   { border-color: #a855f7; }
.hdr .page {
  margin-left: auto;
  color: #9ca3af;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.hdr .page .pct { color: #22d3ee; margin-left: 4px; }
.hdr .expand, .hdr .close {
  margin-left: 4px;
  color: #6b7280;
  padding: 0 4px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}
.hdr .close { display: none; }
.card.expanded .hdr .expand { display: none; }
.card.expanded .hdr .close  { display: inline; }

/* progress bar under header */
.progress {
  position: relative;
  height: 2px;
  background: #111827;
  overflow: hidden;
}
.progress .bar {
  position: absolute; top: 0; left: 0; bottom: 0;
  width: 0%;
  background: linear-gradient(90deg, #22d3ee, #a855f7);
  transition: width 300ms ease-out;
  box-shadow: 0 0 8px rgba(34, 211, 238, 0.6);
}

/* action line — 2-row: kind+label (top) + value/context (bottom) */
.act {
  padding: 8px 10px;
  border-bottom: 1px solid #1f2937;
  min-height: 50px;
  display: flex; flex-direction: column; gap: 3px;
  transition: background 200ms ease-out;
  overflow: hidden;
}
.act.flash { background: rgba(34, 211, 238, 0.08); }
.act .top {
  display: flex; align-items: center; gap: 6px;
  white-space: nowrap; overflow: hidden;
}
.act .arrow { color: #22d3ee; font-size: 14px; flex-shrink: 0; }
.act .kind {
  color: #0b0f14; background: #22d3ee;
  padding: 1px 6px; border-radius: 2px;
  text-transform: uppercase; font-size: 10px;
  letter-spacing: 0.08em; font-weight: 700;
  flex-shrink: 0;
}
.act .kind.destructive { background: #ef4444; color: #fff; }
.act .kind.thinking {
  background: #a855f7; color: #fff;
  animation: think-pulse 1.2s ease-in-out infinite;
}
@keyframes think-pulse {
  0%, 100% { opacity: 0.85; }
  50%      { opacity: 1; box-shadow: 0 0 10px rgba(168, 85, 247, 0.55); }
}
.act .dots::after {
  content: "";
  display: inline-block;
  width: 1.2em;
  text-align: left;
  animation: dots 1.4s steps(4, end) infinite;
}
@keyframes dots {
  0%   { content: ""; }
  25%  { content: "."; }
  50%  { content: ".."; }
  75%  { content: "..."; }
  100% { content: ""; }
}
.act .lbl {
  color: #e5e7eb; font-size: 13px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis;
  flex: 1;
}
.act .sub {
  font-size: 11px; color: #6b7280;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  padding-left: 22px;
}
.act .sub .v { color: #22d3ee; }
.act .sub .k { color: #9ca3af; }
.act:empty::before { content: "idle · awaiting first action"; color: #4b5563; font-style: italic; }

/* risk badge */
.risk {
  display: inline-block;
  padding: 1px 6px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  border: 1px solid #ef4444;
  color: #ef4444;
  border-radius: 2px;
  text-transform: uppercase;
  margin-left: 4px;
  animation: risk-pulse 1.4s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes risk-pulse {
  0%, 100% { opacity: 0.7; }
  50%      { opacity: 1; box-shadow: 0 0 10px rgba(239, 68, 68, 0.4); }
}

/* next-up queue — under action */
.next {
  display: flex; gap: 8px; align-items: center;
  padding: 4px 10px;
  border-bottom: 1px solid #1f2937;
  font-size: 11px;
  color: #6b7280;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.next:empty { display: none; }
.next .qk {
  color: #6b7280;
  font-size: 9px; letter-spacing: 0.12em;
  text-transform: uppercase;
  flex-shrink: 0;
}
.next .qitem { color: #9ca3af; }
.next .qitem .glyph { color: #22d3ee; margin-right: 4px; }
.next .qitem.form .glyph { color: #a855f7; }
.next .qsep { color: #374151; }

/* capture feed */
.feed { max-height: 82px; overflow: hidden; }
.card.expanded .feed { max-height: 340px; overflow-y: auto; }
.row {
  display: grid;
  grid-template-columns: 34px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 4px 10px;
  border-left: 2px solid transparent;
  animation: row-in 240ms ease-out;
  white-space: nowrap;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.card.expanded .row { grid-template-columns: 58px 34px 1fr auto; }
.row.mut { border-left-color: #ef4444; background: rgba(239, 68, 68, 0.05); }
.row.mut .path { color: #fca5a5; }
@keyframes row-in {
  from { opacity: 0; transform: translateX(-6px); }
  to   { opacity: 1; transform: translateX(0); }
}
.row .ts { color: #6b7280; font-size: 10px; display: none; }
.card.expanded .row .ts { display: inline; }
.row .m { font-weight: 700; font-size: 11px; letter-spacing: 0.04em; }
.row .m.GET    { color: #6b7280; }
.row .m.POST   { color: #10b981; }
.row .m.PUT    { color: #f59e0b; }
.row .m.DEL    { color: #ef4444; }
.row .m.PAT    { color: #a855f7; }
.row .path { color: #e5e7eb; overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
.row .st { color: #6b7280; font-weight: 600; }
.row .st.ok { color: #10b981; }
.row .st.redirect { color: #f59e0b; }
.row .st.err { color: #ef4444; }
.row.intel { border-left-color: #a855f7; background: rgba(168, 85, 247, 0.05); }
.row.intel .m { color: #a855f7; }

/* footer counters */
.foot {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  border-top: 1px solid #1f2937;
  font-size: 11px;
  color: #6b7280;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
}
.foot .grp { display: inline-flex; gap: 4px; align-items: baseline; }
.foot .n     { color: #e5e7eb; font-weight: 700; font-size: 12px; }
.foot .mut-n { color: #ef4444; font-weight: 700; font-size: 12px; }
.foot .int-n { color: #a855f7; font-weight: 700; font-size: 12px; }
.foot .lbl   { color: #6b7280; }
.foot .sep   { color: #1f2937; }

/* expanded-only sections */
.pane { display: none; }
.card.expanded .pane { display: block; border-top: 1px solid #1f2937; }
.pane h4 {
  font-size: 9px;
  color: #6b7280;
  padding: 6px 10px 2px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.pane ul { list-style: none; padding: 2px 10px 6px; max-height: 120px; overflow-y: auto; }
.pane li { color: #e5e7eb; padding: 1px 0; font-size: 10px; }
.pane li::before { content: "▸ "; color: #22d3ee; }
.pane .kv { display: flex; justify-content: space-between; padding: 1px 10px; font-size: 10px; color: #e5e7eb; }
.pane .kv .k { color: #6b7280; }

/* mutation edge glow */
.card.glow-mut {
  box-shadow: 0 10px 40px -10px rgba(0,0,0,0.8), inset -3px 0 0 #ef4444, 0 0 24px rgba(239, 68, 68, 0.25);
}
.card.glow-intel {
  box-shadow: 0 10px 40px -10px rgba(0,0,0,0.8), inset -3px 0 0 #a855f7, 0 0 24px rgba(168, 85, 247, 0.25);
}
.card.glow-done {
  box-shadow: 0 10px 40px -10px rgba(0,0,0,0.8), inset -3px 0 0 #10b981, 0 0 24px rgba(16, 185, 129, 0.3);
}

/* boot sequence */
.boot {
  position: absolute; inset: 0;
  background: #0b0f14;
  display: flex; flex-direction: column; justify-content: center;
  padding: 10px 12px;
  font-size: 10px;
  color: #22d3ee;
  z-index: 2;
}
.boot .ln { opacity: 0; animation: boot-ln 120ms forwards; }
.boot .ln .ok { color: #10b981; }
.boot .ln .hl { color: #e5e7eb; }
@keyframes boot-ln { to { opacity: 1; } }
.boot.done { opacity: 0; pointer-events: none; transition: opacity 220ms ease-out; }
`

const PANEL_HTML = `
<div class="root">
  <div class="paint"></div>
  <div class="card" data-mode="mini">
    <span class="bracket tl"></span>
    <span class="bracket tr"></span>
    <span class="bracket bl"></span>
    <span class="bracket br"></span>

    <div class="boot">
      <div class="ln" style="animation-delay:0ms">&gt; cyberstrike.agent.connect()</div>
      <div class="ln" style="animation-delay:140ms">&gt; shadow-dom mount <span class="ok">[OK]</span></div>
      <div class="ln" style="animation-delay:300ms">&gt; event bridge <span class="ok">[OK]</span></div>
      <div class="ln" style="animation-delay:460ms">&gt; standby for capture stream...</div>
      <div class="ln" style="animation-delay:640ms"><span class="hl">● LIVE</span></div>
    </div>

    <div class="hdr" data-role="toggle">
      <span class="logo" title="recording"></span>
      <span class="rec">REC</span>
      <span class="sep">·</span>
      <span class="cs">CS</span>
      <span class="sep">·</span>
      <span class="cred-ring" data-role="cred">—</span>
      <span class="page" data-role="page"></span>
      <span class="expand" data-role="expand" title="expand">⤢</span>
      <span class="close"  data-role="close"  title="collapse">✕</span>
    </div>

    <div class="progress"><div class="bar" data-role="bar"></div></div>

    <div class="act" data-role="act"></div>

    <div class="next" data-role="next"></div>

    <div class="feed" data-role="feed"></div>

    <div class="pane" data-role="plan-pane">
      <h4>Current Plan</h4>
      <ul data-role="plan"></ul>
    </div>
    <div class="pane" data-role="summary-pane">
      <h4>Summary</h4>
      <div class="kv"><span class="k">target</span><span data-role="sum-target">—</span></div>
      <div class="kv"><span class="k">pages</span><span data-role="sum-pages">0 / 0</span></div>
      <div class="kv"><span class="k">captured</span><span data-role="sum-cap">0</span></div>
      <div class="kv"><span class="k">mutations</span><span data-role="sum-mut">0</span></div>
      <div class="kv"><span class="k">credentials</span><span data-role="sum-cred">—</span></div>
    </div>

    <div class="foot">
      <span class="grp"><span class="n" data-role="c-cap">0</span><span class="lbl">captures</span></span>
      <span class="sep">·</span>
      <span class="grp"><span class="mut-n" data-role="c-mut">0</span><span class="lbl">mutations</span></span>
      <span class="sep">·</span>
      <span class="grp"><span class="int-n" data-role="c-int">0</span><span class="lbl">intel</span></span>
    </div>
  </div>
</div>
`

const PANEL_JS_BODY = `
// ---------- helpers ----------
var $ = function (role) { return shadow.querySelector('[data-role="' + role + '"]'); };
var $$ = function (role) { return Array.prototype.slice.call(shadow.querySelectorAll('[data-role="' + role + '"]')); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
  return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
}); };
var trunc = function (s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
var now = function () { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); };

// ---------- state ----------
var state = {
  startedAt: now(),
  target: '',
  credentials: [],
  maxPages: 0,
  pageNum: 0,
  currentCred: null,
  counters: { cap: 0, mut: 0, int: 0 },
  expanded: false,
  // Remaining plan tasks for Next-Up widget (excludes the one currently running).
  queue: [],
  // Last N capture rows so the feed survives same-origin navigation (persist target).
  feedRows: [],
  // Whether boot sequence has played in this session — avoids flash on every nav.
  bootShown: false,
};

// ---------- persistence (same-origin nav survives via sessionStorage) ----------
var STORAGE_KEY = '__cs_panel_v1';
var FEED_PERSIST_MAX = 20;

function loadPersisted() {
  try {
    var raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    // Absolute wallclock startedAt so relTs stays consistent across navigations.
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) { return null; }
}

function persist() {
  try {
    var snapshot = {
      target: state.target,
      credentials: state.credentials,
      maxPages: state.maxPages,
      pageNum: state.pageNum,
      currentCred: state.currentCred,
      counters: state.counters,
      startedAt: state.startedAt,
      startedAtWall: state.startedAtWall,
      bootShown: true,
      expanded: state.expanded,
      feed: state.feedRows.slice(0, FEED_PERSIST_MAX),
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (_) {}
}

// ---------- method + status helpers ----------
function shortMethod(m) {
  m = String(m || '').toUpperCase();
  if (m === 'DELETE') return 'DEL';
  if (m === 'PATCH') return 'PAT';
  return m;
}
function statusClass(code) {
  code = Number(code) || 0;
  if (code >= 200 && code < 300) return 'ok';
  if (code >= 300 && code < 400) return 'redirect';
  if (code >= 400) return 'err';
  return '';
}
function isDestructive(kind, label) {
  // Heuristic: submit+any label, or click on destructive verbs.
  if (kind === 'submit') return true;
  var l = String(label || '').toLowerCase();
  return /\b(delete|remove|destroy|drop|cancel|revoke|wipe|erase|terminate)\b/.test(l);
}

// ---------- credential color ----------
function credClass(id) {
  if (!id) return 'multi';
  var s = String(id).toLowerCase();
  if (/admin|super|root/.test(s)) return '';
  if (/manager|editor|mod/.test(s)) return 'manager';
  if (/user|author|viewer|guest/.test(s)) return 'user';
  return 'multi';
}

// ---------- timestamp (relative) ----------
// Uses wallclock (Date.now) so relative ts stays consistent across navigations.
function relTs() {
  var secs = (Date.now() - state.startedAtWall) / 1000;
  if (secs < 0) secs = 0;
  var mm = Math.floor(secs / 60);
  var ss = (secs - mm * 60).toFixed(1);
  return '+' + (mm < 10 ? '0' + mm : mm) + ':' + (parseFloat(ss) < 10 ? '0' + ss : ss);
}

// ---------- hydrate from previous nav (sessionStorage) ----------
var _persisted = loadPersisted();
if (_persisted) {
  state.target       = _persisted.target       || state.target;
  state.credentials  = _persisted.credentials  || state.credentials;
  state.maxPages     = _persisted.maxPages     || state.maxPages;
  state.pageNum      = _persisted.pageNum      || state.pageNum;
  state.currentCred  = _persisted.currentCred  || state.currentCred;
  state.counters     = _persisted.counters     || state.counters;
  state.startedAtWall = _persisted.startedAtWall || Date.now();
  state.bootShown    = !!_persisted.bootShown;
  state.expanded     = !!_persisted.expanded;
  state.feedRows     = Array.isArray(_persisted.feed) ? _persisted.feed.slice(0, FEED_PERSIST_MAX) : [];
} else {
  state.startedAtWall = Date.now();
}

// ---------- boot sequence — skip if already shown this session ----------
(function bootSeq() {
  var boot = shadow.querySelector('.boot');
  if (!boot) return;
  if (state.bootShown) { boot.remove(); return; }
  setTimeout(function () {
    boot.classList.add('done');
    setTimeout(function () { boot.remove(); }, 260);
    state.bootShown = true;
    persist();
  }, 1100);
})();

// ---------- header toggle ----------
var card = shadow.querySelector('.card');
// Restore user's mode preference (survives navigation).
if (state.expanded) card.classList.add('expanded');
shadow.querySelector('[data-role="toggle"]').addEventListener('click', function (ev) {
  // only toggle if click is on header itself or expand/close icon
  var t = ev.target;
  if (t && (t.getAttribute('data-role') === 'expand' || t.getAttribute('data-role') === 'close' || t.getAttribute('data-role') === 'toggle' || t.classList.contains('cs') || t.classList.contains('sep') || t.classList.contains('rec') || t.classList.contains('logo') || t.classList.contains('page'))) {
    state.expanded = !state.expanded;
    card.classList.toggle('expanded', state.expanded);
    persist();
  }
});

// ---------- target paint ----------
var paintRoot = shadow.querySelector('.paint');
var currentPaint = null;

function resolveTarget(selector, label) {
  try {
    // Playwright role= selectors are not valid for document.querySelector.
    if (selector && !/^role=/.test(selector) && !/^xpath=/.test(selector)) {
      var el = document.querySelector(selector);
      if (el) return el;
    }
  } catch (_) {}
  if (label) {
    try {
      var safe = String(label).replace(/"/g, '\\\\"');
      var el2 = document.querySelector('[aria-label="' + safe + '"]') ||
                document.querySelector('[title="' + safe + '"]');
      if (el2) return el2;
    } catch (_) {}
  }
  return null;
}

function paintTarget(selector, label, kind) {
  clearPaint();
  var el = resolveTarget(selector, label);
  if (!el) return;
  var rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  var box = document.createElement('div');
  box.className = 'paint-box ' + (kind === 'fill' || kind === 'select' ? 'ok' : 'ok');
  box.style.left   = Math.max(0, rect.left - 3) + 'px';
  box.style.top    = Math.max(0, rect.top - 3) + 'px';
  box.style.width  = (rect.width + 6) + 'px';
  box.style.height = (rect.height + 6) + 'px';
  var tag = document.createElement('div');
  tag.className = 'paint-label';
  tag.textContent = (kind || 'click').toUpperCase() + ' · ' + trunc(label || '', 30);
  box.appendChild(tag);
  paintRoot.appendChild(box);
  // force reflow so transition kicks
  void box.offsetWidth;
  box.classList.add('on');
  currentPaint = box;
}

function markPaintResult(ok, mutation) {
  if (!currentPaint) return;
  if (mutation) currentPaint.classList.add('hit');
  var el = currentPaint;
  currentPaint = null;
  setTimeout(function () {
    el.classList.remove('on');
    setTimeout(function () { el.remove(); }, 260);
  }, mutation ? 420 : 160);
}

function clearPaint() {
  if (currentPaint) { currentPaint.remove(); currentPaint = null; }
}

// ---------- glow helper ----------
function glow(cls, ms) {
  card.classList.add(cls);
  setTimeout(function () { card.classList.remove(cls); }, ms);
}

// ---------- renderers ----------
function setHeader() {
  var credEl = $('cred');
  var credLabel = state.currentCred && state.currentCred !== '__single__' ? state.currentCred : (state.credentials.length > 1 ? 'multi' : 'single');
  credEl.textContent = credLabel;
  credEl.className = 'cred-ring ' + credClass(state.currentCred);
  var pageEl = $('page');
  if (state.maxPages) {
    var pct = Math.min(100, Math.round((state.pageNum / state.maxPages) * 100));
    pageEl.innerHTML = 'page ' + state.pageNum + '/' + state.maxPages + ' <span class="pct">' + pct + '%</span>';
    var bar = $('bar');
    if (bar) bar.style.width = pct + '%';
  }
}

function setAction(kind, label, value) {
  var act = $('act');
  var k = String(kind || 'click').toLowerCase();
  var kindUp = k.toUpperCase();
  var destructive = isDestructive(k, label);
  var riskHtml = destructive ? '<span class="risk" title="destructive operation">destructive</span>' : '';
  var kindClass = destructive ? 'kind destructive' : 'kind';
  var subHtml = '';
  if (value != null && String(value).length > 0) {
    subHtml = '<div class="sub">↳ <span class="k">value:</span> <span class="v">"' + esc(trunc(String(value), 48)) + '"</span></div>';
  } else if (k === 'submit') {
    subHtml = '<div class="sub">↳ <span class="k">firing form submission — watch for mutation</span></div>';
  } else if (k === 'click') {
    subHtml = '<div class="sub">↳ <span class="k">exploring element · capturing network side-effects</span></div>';
  }
  act.innerHTML =
    '<div class="top">' +
      '<span class="arrow">▶</span>' +
      '<span class="' + kindClass + '">' + esc(kindUp) + '</span>' +
      '<span class="lbl">' + esc(trunc(label || '—', 44)) + '</span>' +
      riskHtml +
    '</div>' + subHtml;
  act.classList.add('flash');
  setTimeout(function () { act.classList.remove('flash'); }, 220);
}

function setThinking(reason, elements) {
  var act = $('act');
  var labels = {
    'page-plan':  'analyzing page',
    'unexplored': 'hunting missed actions',
    'replan':     're-planning after DOM change',
  };
  var subtitles = {
    'page-plan':  'model inspecting the DOM, planning exploration',
    'unexplored': 'model scanning for buttons the initial plan skipped',
    'replan':     'model re-evaluating after element mutation',
  };
  var label = labels[reason] || 'thinking';
  var sub = subtitles[reason] || 'model working';
  var n = Number(elements || 0);
  act.innerHTML =
    '<div class="top">' +
      '<span class="arrow">▶</span>' +
      '<span class="kind thinking">LLM</span>' +
      '<span class="lbl">' + esc(label) + '<span class="dots"></span></span>' +
    '</div>' +
    '<div class="sub">↳ <span class="k">' + esc(sub) + ' · ' + n + ' elements</span></div>';
  glow('glow-intel', 320);
}

function setNextUp() {
  var nxt = $('next');
  if (!nxt) return;
  if (!state.queue || state.queue.length === 0) { nxt.innerHTML = ''; return; }
  var items = state.queue.slice(0, 2).map(function (t) {
    var glyph = t.kind === 'form' ? '⊞' : '→';
    return '<span class="qitem ' + esc(t.kind) + '"><span class="glyph">' + glyph + '</span>' + esc(trunc(t.label || '', 28)) + '</span>';
  }).join('<span class="qsep"> · </span>');
  var more = state.queue.length > 2 ? '<span class="qsep"> · </span><span class="qitem">+' + (state.queue.length - 2) + '</span>' : '';
  nxt.innerHTML = '<span class="qk">queue</span>' + items + more;
}

function rowHtml(r) {
  var method = shortMethod(r.method);
  var st = Number(r.status || 0);
  var cls = r.kind === 'intel'
    ? 'row intel'
    : ('row' + (r.isMutation ? ' mut' : ''));
  if (r.kind === 'intel') {
    return '<span class="ts">' + esc(r.ts || '') + '</span>' +
      '<span class="m">INTEL</span>' +
      '<span class="path">' + esc(trunc(r.path || '', 38)) + '</span>' +
      '<span class="st">' + esc(trunc(r.note || '', 14)) + '</span>';
  }
  return '<span class="ts">' + esc(r.ts || '') + '</span>' +
    '<span class="m ' + esc(method) + '">' + esc(method) + '</span>' +
    '<span class="path" title="' + esc(r.path || '') + '">' + esc(trunc(r.path || '', 38)) + '</span>' +
    '<span class="st ' + esc(statusClass(st)) + '">' + esc(st ? String(st) : '---') + '</span>';
}

function insertRowFromRecord(r) {
  var feed = $('feed');
  var row = document.createElement('div');
  row.className = r.kind === 'intel' ? 'row intel' : ('row' + (r.isMutation ? ' mut' : ''));
  row.innerHTML = rowHtml(r);
  feed.insertBefore(row, feed.firstChild);
  while (feed.children.length > 40) feed.removeChild(feed.lastChild);
}

function appendRow(ev) {
  var record = {
    kind: 'capture',
    ts: relTs(),
    method: ev.method,
    path: ev.path,
    status: ev.status,
    isMutation: !!ev.isMutation,
  };
  insertRowFromRecord(record);
  state.feedRows.unshift(record);
  if (state.feedRows.length > FEED_PERSIST_MAX) state.feedRows.length = FEED_PERSIST_MAX;
  persist();
}

function appendIntelRow(ev) {
  var path = '';
  try { path = new URL(ev.url).pathname + new URL(ev.url).hash; } catch (_) { path = ev.url || ''; }
  var record = {
    kind: 'intel',
    ts: relTs(),
    path: ev.kind + ' · ' + path,
    note: ev.note,
  };
  insertRowFromRecord(record);
  state.feedRows.unshift(record);
  if (state.feedRows.length > FEED_PERSIST_MAX) state.feedRows.length = FEED_PERSIST_MAX;
  persist();
}

function setPlan(tasks, summary) {
  // store for Next-Up widget
  state.queue = (summary || []).map(function (t) { return { kind: t.kind, label: t.label }; });
  setNextUp();
  // expanded-mode plan list
  var ul = $('plan');
  if (ul) {
    ul.innerHTML = '';
    (summary || []).slice(0, 10).forEach(function (t) {
      var li = document.createElement('li');
      li.textContent = (t.kind === 'form' ? 'form · ' : 'click · ') + trunc(t.label || '', 48);
      ul.appendChild(li);
    });
  }
}

function setCounters() {
  $('c-cap').textContent = state.counters.cap;
  $('c-mut').textContent = state.counters.mut;
  $('c-int').textContent = state.counters.int;
  $('sum-cap').textContent = state.counters.cap;
  $('sum-mut').textContent = state.counters.mut;
  $('sum-pages').textContent = state.pageNum + ' / ' + state.maxPages;
}

// ---------- dispatcher ----------
function handle(ev) {
  if (!ev || typeof ev !== 'object') return;
  switch (ev.type) {
    case 'init':
      // On first agent init we reset startedAtWall; on subsequent nav re-inits
      // (same crawl, new document) we keep the persisted baseline so relative
      // timestamps remain stable.
      if (!_persisted) {
        state.target = ev.target || '';
        state.credentials = ev.credentials || [];
        state.startedAtWall = ev.startedAt || Date.now();
      } else {
        // Only fill in fields the persisted state doesn't already know.
        if (!state.target) state.target = ev.target || '';
        if (!state.credentials.length) state.credentials = ev.credentials || [];
      }
      state.maxPages = ev.maxPages || state.maxPages;
      $('sum-target').textContent = trunc(state.target, 40);
      $('sum-cred').textContent = state.credentials.length > 0 ? state.credentials.join(', ') : 'single';
      setHeader();
      setCounters();
      persist();
      return;
    case 'page-change':
      state.pageNum = ev.pageNum || 0;
      state.maxPages = ev.maxPages || state.maxPages;
      state.currentCred = ev.credential || state.currentCred;
      state.queue = [];  // new page → stale plan, wait for plan-received
      setNextUp();
      setHeader();
      setCounters();
      persist();
      return;
    case 'plan-received':
      setPlan(ev.tasks, ev.summary);
      return;
    case 'action-start':
      state.currentCred = ev.credential || state.currentCred;
      setHeader();
      setAction(ev.kind || 'click', ev.targetLabel || '', ev.value);
      // consume the next queue item if it matches this action (form tasks cover many fills)
      if (state.queue && state.queue.length > 0) {
        var head = state.queue[0];
        var lbl = String(ev.targetLabel || '').toLowerCase();
        var hlbl = String(head.label || '').toLowerCase();
        if (ev.kind === 'submit' || hlbl.indexOf(lbl) !== -1 || lbl.indexOf(hlbl) !== -1) {
          state.queue.shift();
          setNextUp();
        }
      }
      paintTarget(ev.targetSelector, ev.targetLabel, ev.kind);
      return;
    case 'action-end':
      markPaintResult(!!ev.ok, !!ev.mutation);
      return;
    case 'capture':
      state.counters.cap++;
      if (ev.isMutation) { state.counters.mut++; glow('glow-mut', 360); }
      appendRow(ev);
      setCounters();
      return;
    case 'intelligence':
      state.counters.int++;
      glow('glow-intel', 420);
      appendIntelRow(ev);
      setCounters();
      return;
    case 'llm-thinking':
      state.currentCred = ev.credential || state.currentCred;
      setHeader();
      setThinking(ev.reason, ev.elements);
      return;
    case 'credential-switch':
      state.currentCred = ev.to || null;
      setHeader();
      persist();
      return;
    case 'crawl-done':
      var s = ev.summary || {};
      state.counters.cap = s.capturedEndpoints != null ? s.capturedEndpoints : state.counters.cap;
      state.counters.mut = s.mutations != null ? s.mutations : state.counters.mut;
      state.pageNum = s.pagesExplored != null ? s.pagesExplored : state.pageNum;
      state.queue = [];
      setNextUp();
      setCounters();
      setHeader();
      var act = $('act');
      act.innerHTML =
        '<div class="top"><span class="arrow">✓</span><span class="kind" style="background:#10b981">done</span>' +
        '<span class="lbl">scan complete</span></div>' +
        '<div class="sub">↳ <span class="k">' + esc(state.counters.cap + ' captures · ' + state.counters.mut + ' mutations · ' + state.pageNum + ' pages') + '</span></div>';
      glow('glow-done', 800);
      try { window.sessionStorage.removeItem(STORAGE_KEY); } catch (_) {}
      return;
  }
}

// ---------- render restored state ----------
setHeader();
setCounters();
// Rebuild feed from oldest→newest so insertBefore stacks them newest-first.
for (var ri = state.feedRows.length - 1; ri >= 0; ri--) insertRowFromRecord(state.feedRows[ri]);

// ---------- replay queued events ----------
var q = (window).__csQueue || [];
try { for (var i = 0; i < q.length; i++) handle(q[i]); } catch (_) {}
try { delete (window).__csQueue; } catch (_) { (window).__csQueue = []; }

// ---------- public entrypoint ----------
Object.defineProperty(window, '__csEvent', {
  configurable: true,
  value: function (e) { try { handle(e); } catch (_) {} }
});
`

/**
 * The actual init script injected by playwright. Wrapped in an IIFE, idempotent
 * via window.__csInstalled (reset per document, so each navigation remounts).
 *
 * Events that arrive before the host mounts queue into window.__csQueue and
 * are replayed when the real handler installs.
 */
export const PANEL_INIT_SCRIPT = `
(function () {
  try {
    if (window.__csInstalled) return;
    Object.defineProperty(window, '__csInstalled', { value: true, configurable: true });

    // Pre-mount event buffer so agent emissions arriving before handler install are not lost.
    if (!window.__csQueue) {
      Object.defineProperty(window, '__csQueue', { value: [], writable: true, configurable: true });
      window.__csEvent = function (e) { try { window.__csQueue.push(e); } catch (_) {} };
    }

    function mount() {
      if (!document.documentElement) return;
      if (document.getElementById('__cs-host')) return;
      var host = document.createElement('div');
      host.id = '__cs-host';
      host.setAttribute('data-cyberstrike-ui', 'panel');
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647';
      document.documentElement.appendChild(host);

      var shadow = host.attachShadow({ mode: 'closed' });
      var style = document.createElement('style');
      style.textContent = ${JSON.stringify(PANEL_CSS)};
      shadow.appendChild(style);
      var wrap = document.createElement('div');
      wrap.innerHTML = ${JSON.stringify(PANEL_HTML)};
      while (wrap.firstChild) shadow.appendChild(wrap.firstChild);

      ${PANEL_JS_BODY}
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount, { once: true });
    } else {
      mount();
    }
  } catch (err) {
    // Panel failure must never affect agent — swallow silently.
    try { console && console.debug && console.debug('[cs-panel] init failed', err); } catch (_) {}
  }
})();
`
