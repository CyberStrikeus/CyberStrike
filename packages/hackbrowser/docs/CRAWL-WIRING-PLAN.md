# HackBrowser 2.0 — Crawl (AI co-driving) wiring plan

Making the 2.0 "crawl" operational = wiring the AI to drive the real browser:
**observe → decide → act**, guard-enforced, captures flowing as it navigates. The pieces
exist but are disconnected. This plan connects them.

## Grounded current state (traced, not assumed)

| Piece | File | State |
|---|---|---|
| Control server (WS `/control`, `/observe`, `/page-state`, `/action`) | `hackbrowser/src/v2/codriving.ts` | Standalone `Bun.serve` on `:4097`. NOT in CyberStrike. |
| Element classification | `hackbrowser/src/v2/classify.ts` | Pure TS. Used by codriving. |
| Action policy (logout=deny, destructive=confirm) | `hackbrowser/src/v2/guard.ts` | Pure TS. Used by codriving. |
| `perform` (click/type/navigate) | `extension/content.js` (~839) | READY. Triggered by a background `perform` message. |
| `observePage()` / `sendObservation()` | `extension/content.js` (~740) | Sends to background → currently POSTs Faz B `/web/observations`, NOT codriving `/observe`. |
| Background WS client | `extension/background.js` | MISSING — only a comment. The WS→background→content chain is broken. |
| `web_get_page_state` / `web_action` tools | `cyberstrike/src/tool/` | DO NOT EXIST. All web tools are analysis (get/write). |
| CS server WebSocket | `cyberstrike/src/server/server.ts:690` (`websocket` from `hono/bun`), template in `server/routes/pty.ts:152` (`upgradeWebSocket`) | SUPPORTED — proven pattern. |
| Tool registration | `Tool.define(...)` + `tool/registry.ts` + `agent/agent.ts` | Known pattern. |

**Gaps:** (1) codriving is a separate server; (2) no background WS client → control chain
broken; (3) observe feeds Faz B, not the page-state store; (4) no AI tools; (5) no loop.

## Decisions (recommended)

1. **Re-home codriving into the CyberStrike server** (not keep `:4097`). Everything else is
   extension→CyberStrike-direct; a second server + separate WS is inconsistent and the AI
   tools would have to proxy out-of-process. Re-home = one server, in-process tool calls,
   WS via the proven `pty.ts` pattern.
2. **Move `classify.ts` + `guard.ts` into CyberStrike** (`session/web/classify.ts`,
   `session/web/guard.ts`). They are pure server-side logic now (no browser deps); the
   extension does not import them. Keeps the analysis where the AI runs. (Alt: export from
   the hackbrowser package like `/v2-spawn` — rejected: they belong with the server.)
3. **Page-state store separate from Faz B observations, fed by one `observePage()`.** Faz B
   `web_ui_observation` = per-credential element availability (access-control). Page-state =
   the CURRENT page's clickables for the AI to act on now. Different lifetimes; one extension
   message feeds both server-side.
4. **AI drives ONE browser at a time** (the active/orchestrator tab). Multi-browser AI
   driving (drive each role's browser) is a later extension — flagged.

## Phase A — Server substrate (CyberStrike)

1. `session/web/classify.ts` + `session/web/guard.ts` — move from `hackbrowser/src/v2/`
   (verbatim; they're standalone). Delete the v2 copies once codriving.ts is gone.
2. `session/web/page-state.ts` — per-session, per-URL page observation store (mirror
   `ui-observation.ts` / `role-queue.ts` in-memory shape). `set(sessionID, obs)`,
   `get(sessionID, url)`, `annotate` via classify, `policy` via guard. This is the
   `get_page_state` substrate.
3. Routes in `server/routes/session.ts` (extend the existing Hono chain):
   - `POST /session/:id/web/observe` — extension posts a page observation → page-state store
     (and, unchanged, the Faz B `/web/observations` still runs). Consider one merged
     `observe` payload carrying both.
   - `GET /session/:id/web/page-state?url=&view=` — the AI tool reads (clickables annotated
     with kind + policy).
   - `POST /session/:id/web/action {op, elementId?, text?, url?}` — guard-enforced HERE:
     deny→403, confirm→409, allow→relay to the extension over the control WS, return the ack.
   - `WS /session/:id/web/control` — the extension connects to receive click/navigate
     commands. Use `upgradeWebSocket` (template: `server/routes/pty.ts:152`). Track the
     socket per session; `sendCommand` + pending-ack map (port codriving's `sendCommand`).
4. Delete `v2/codriving.ts` after its logic lands (no dead standalone server).

**Edge cases:** no extension connected → `/action` returns 503 (as codriving already does);
socket drops → pending commands reject with timeout; two tabs of one session → last-connected
wins (single control socket per session — flagged; multi-tab is Phase-later).

## Phase B — Extension: connect control + feed page-state

1. `background.js` — a WS client to `ws://<cs>/session/:id/web/control`. On a command message
   → `chrome.tabs.sendMessage(activeTabId, {type:"perform", cmd})` → content.js `perform`
   executes → send the ack back over the WS. Reconnect on drop (backoff); connect when a
   session is active.
2. `content.js` — `sendObservation()` already posts to background; background forwards to the
   merged `/web/observe` so the page-state store is fed. The `perform` handler is unchanged
   (already handles click/type/navigate via `elMap`).

**Edge cases:** WS not yet connected when `/action` fires → 503, AI retries; element id stale
(DOM changed since observe) → `perform` returns "element not found" → AI re-observes; SPA nav
→ observe already re-fires on URL change (poll).

## Phase C — AI tools

1. `tool/web-get-page-state.ts` — `Tool.define("web_get_page_state", …)` → GET
   `/web/page-state`; returns the current page's clickables (id, role, label, kind, policy) +
   forms + url. The AI's "eyes." (Mirror `web-get-request-detail.ts` structure.)
2. `tool/web-action.ts` — `Tool.define("web_action", …)` → POST `/web/action`; params
   `{op: "click"|"type"|"navigate", element_id?, text?, url?}`. Returns allowed/blocked
   (guard) + ack. The AI's "hands." A `confirm`-policy action returns "needs human approval"
   (409) — surfaced to the user, not auto-run.
3. Register both in `tool/registry.ts` and grant them to the web/proxy agent in
   `agent/agent.ts`.

**Edge cases:** guard denies (logout) → tool returns "blocked: logout", AI skips; guard
confirm (destructive) → "needs approval" — the human confirms via the driver/handover UI.

## Phase D — The crawl loop (agent behavior)

No new engine — it's the **web/proxy agent's prompt + the two tools**:

1. Loop: `web_get_page_state` → choose an UNVISITED `nav`/`query` clickable (skip
   destructive/logout/auth by `kind`) → `web_action(click | navigate)` → repeat.
2. Track visited (URL + element `role:label`) in the agent's working set (or a small
   `session/web/visited` store) to avoid cycles.
3. Termination: max actions (budget), no unvisited nav elements left (coverage), or human
   stop. Captures flow automatically the whole time (the extension is attached).

**Edge cases:** cycle (same page re-observed) → visited-set prevents re-clicking; dead end →
back-navigate or pick another branch; auth wall / CAPTCHA → AI cannot pass → hand to human.

## Phase E — Human handover + safety

1. Driver toggle (ai/human) already in the panel. Human drives → the AI loop pauses (still
   reads `web_get_page_state`, defers `web_action` to the human). Hand back → resume.
2. Guard (already built): logout=deny, destructive=confirm (human approves). One source
   (`guard.ts`) enforced server-side in `/action`.
3. Budget governor: max actions/pages so a run can't loop forever.

## Sequencing (each phase verifiable on its own)

- **A** is testable in isolation (page-state store unit tests; routes via Hono `app.request`;
  guard/classify already have tests — move them too). The WS `/control` needs an integration
  test (a fake WS client) — the `pty.ts` route shows the pattern.
- **B** needs a live browser (WS connect + perform) → user's test, like the other extension work.
- **C** tools are unit-testable (mock the routes) + the guard/deny paths.
- **D** is prompt + light state; validate with a scripted page.
- **E** reuses the existing driver toggle + guard.

## Reuse / DRY

- classify/guard/`sendCommand`/pending-ack: **ported from codriving.ts**, not rewritten.
- page-state store mirrors the `ui-observation.ts` / `role-queue.ts` in-memory pattern.
- WS route mirrors `pty.ts`. Tools mirror `web-get-request-detail.ts`.
- `perform`, `observePage`, driver toggle in the extension are already built — reused as-is.

## Deliberately out (flagged)

- Multi-browser AI driving (drive each role's browser) — start single-browser.
- Persisting page-state / visited across CS restart (in-memory, like the other stores).
- Fully autonomous unattended crawl — the human-handover + budget keep it bounded.
