# HackBrowser 2.0 — Design

Status: **draft / planning**. Branch: `hackbrowser-2.0` (based on `azure-workflow`).
This document is the contract we agree on before writing code. No target/client
names appear here by policy — everything is generic.

---

## 1. Why 2.0 exists

HackBrowser 1.x drives a Playwright/CDP-controlled Chromium and, on every captured
HTTP request, sends one prompt into the **main session's** ingest queue. Two
consequences:

1. **Capture is coupled to a synthetic browser.** Playwright/CDP breaks on some
   real-world sites (anti-bot, WAF, fingerprint, PNA, execution-context loss) and
   cookie isolation across credentials is a synthetic `browserContext`, not a real
   profile.
2. **Analysis is request-by-request, O(n).** Each captured request is one LLM turn
   with tunnel vision on that single request. 400 raw captures → 400 prompts on one
   serialized queue. This does not scale, blocks the user (head-of-line), and gives
   the model no whole-graph view to actually *correlate* (IDOR/BFLA/etc. are
   cross-request by nature).

The cloud (Azure) side already solved the analogous problem: a **deterministic
assess pass** builds the inventory + finding skeletons with **no LLM**, and the LLM
only runs afterwards, in the interpret/decide layer, over agents spawned into
**child sessions** (parallel, isolated). HackBrowser 2.0 brings that discipline to
web.

---

## 2. Core architectural decision: three phases, decoupled by a contract

```
  ┌──────────────┐        ┌───────────────┐        ┌────────────────┐
  │ 1. CAPTURE   │  HAR+  │ 2. ANALYZE    │ hints  │ 3. VERIFY      │
  │ (live)       ├───────►│ (semi-offline)├───────►│ (live, select) │
  │ crawl+record │  graph │ agent cluster │        │ replay/confirm │
  └──────────────┘        └───────────────┘        └────────────────┘
        ▲                                                   │
        └───────────── UI: open browser on demand ──────────┘
```

- **Phase 1 — Capture (live).** User + AI walk the app (overlay-assisted). Everything
  is recorded to an enriched HAR-shaped stream. Goal: maximize *coverage of unique,
  meaningful endpoints*, not raw request count.
- **Phase 2 — Analyze (semi-offline).** Load the recorded traffic + the
  correlation graph, hand it as a whole to an agent cluster. Agents form hypotheses
  and spawn each other (cloud pattern), under a **budget governor**. No request-by-
  request tunnel.
- **Phase 3 — Verify (live, selective).** For hypotheses that need live proof
  (IDOR/BFLA replay, XSS trigger, etc.), open a browser from the UI and replay just
  those scenarios.

### 2.1 The contract that decouples them: enriched HAR

**HAR is the `CaptureSource` provider interface.** This is the single most important
decision. If we fix the recording schema, Phase 1 and Phase 2 become independent:
capture source can be Playwright, a Chrome extension, manual browsing, or a Burp
export — Phase 2 never knows which.

Schema = standard HAR entry **plus** our enrichment fields (already present in 1.x
ingest — carry them forward):

| Field | Source | Purpose |
|-------|--------|---------|
| `credential_id` | which profile/identity made the request | per-identity access diff (IDOR/BFLA) |
| `trigger_element` | UI element that fired it (`role:label`) | tie request to UI action |
| `element_roles` | which identities can see that element | access-control diff |
| `page_url` / `page_visited_by` | page context + which identities visited | coverage per identity |
| `scheme`/`host`/`port`/`origin` | normalized | dedup + scope |
| `key_hash` / `op_key_hash` | normalized identity of the endpoint | dedup unit (see §4) |

> **Gotcha (must design for):** DevTools HAR export drops large/binary/streaming
> response bodies ("content not available"). We do **not** rely on DevTools HAR — we
> produce our own HAR from our own capture (as 1.x already captures response bodies),
> so bodies are always present.

---

## 3. Capture layer: Chrome extension model (Phase 1 target)

Playwright stays as the **first** `CaptureSource` implementation (it works today).
The extension is a **second** implementation behind the same HAR contract, added
without touching Phase 2.

### 3.1 Multi-identity isolation — verified constraints

- Chrome has **no** `contextualIdentities` (Firefox-only). Cookie isolation across
  identities = **separate Chrome profiles** (`--user-data-dir` / `--profile-directory`),
  i.e. separate processes/windows.
- A Chrome extension's **code is shared** across profiles, but each profile runs an
  **isolated instance**: its own service worker, its own `chrome.storage`, and access
  to **only its own profile's cookies**. This gives us the isolation we want *for free*.
- Model: **N profiles → one extension instance per profile → each instance reports
  its profile-local traffic to the CyberStrike backend → backend merges.** Central
  intelligence lives in the backend; extensions are profile-local informers. Do NOT
  design "one extension manages all profiles" — impossible in Chrome.

### 3.2 CDP does not fully go away

- `chrome.webRequest` (MV3) sees headers but **cannot read response bodies**.
- Reading response bodies requires `chrome.debugger` — which **is CDP**. So the
  extension still uses CDP under the hood for bodies, plus the yellow "DevTools is
  debugging this browser" bar on a real user's Chrome.
- **What the extension actually buys us:** real fingerprint, real profile, real
  logged-in session → defeats anti-bot/WAF/stealth. That is the win, not capture
  ergonomics (capture is ~parity with Playwright).

### 3.3 Crawl strategy: ~70% deterministic + AI hybrid

Today Phase-1 walking is ~100% AI clicking buttons: slow, costly, non-deterministic.
Target:

- **Deterministic extraction** of every link / form / clickable element from the DOM
  (`collectNavLinks`/`collectElements` already exist). This is the web equivalent of
  the cloud's deterministic `assess` pass.
- **AI only at genuine ambiguity:** "what's next in this multi-step flow", "which
  value makes this form meaningful", "is this a state-changing action worth doing".
- **Hybrid form fill:** deterministic where the field is obvious, AI where it needs
  semantics.
- **Gotcha:** in SPAs a deterministic click can mutate the DOM and invalidate later
  selectors. Manage click order + re-snapshot state between actions.

---

## 4. Analysis layer: OO agent cluster (Phase 2 target)

Mirror the cloud OO architecture (already built on the Azure side):

- **A `WebAssessmentProvider`** analogous to `AssessmentProvider` — defines the web
  agent roster, per-role permissions, skills, prompts. Reuse `AgentSpec` +
  `specsToAgents` bridge unchanged.
- **Child-session spawn** (`Session.create({ parentID })`, like `spawnCloudAgent`) so
  heavy analysis runs parallel + isolated + non-blocking. Kill the single ingest
  queue for analysis.
- **Variable injection, not embedded prompt values.** Prompts reference injected
  variables (endpoint graph, observed values, credential matrix) resolved at send
  time, instead of string-baking data into the prompt. (This is a stated goal for the
  web side and a cleaner pattern than 1.x's inline prompt building.)

### 4.1 Correlation is per-vuln-class, not per-app

Every web app has a different shape, so a shared "app model" is hard. But the
**correlation signals** are app-agnostic and fixed per vuln class:

- IDOR/BFLA: same `key_hash` endpoint, different `credential_id`, different response.
- SQLi/injection: param mutation → response delta.
- Auth bypass: `element_roles` / `page_visited_by` diff vs. actual access.

So the shared layer is organized **by vuln class → which signals** (the web
equivalent of the cloud's group structure), never by app. The `request_observation`
table already holds this substrate (per-credential values on each `key_hash`).

### 4.2 Budget governor (the constraint cloud didn't need)

Cloud groups are bounded (9). Web hypotheses are **unbounded** → self-spawning agents
can blow up cost/loops exponentially. Required from day one: a governor that
**ranks hypotheses by signal strength, runs the top-N in parallel, queues the rest.**
Scale target is *depth of coverage per budget*, not loop count.

---

## 5. Phasing / build order

Sequence chosen so capture and analysis proceed independently once the HAR contract
is fixed.

- **P0 — Contract.** Freeze the enriched-HAR schema (§2.1) + the Phase-2 input shape
  (traffic + correlation graph). Everything else depends on this. Highest leverage.
- **P1 — Capture provider seam.** Refactor 1.x so Playwright sits behind a
  `CaptureSource` interface emitting the P0 HAR. No behavior change; pure seam.
- **P2 — Analysis OO cluster.** `WebAssessmentProvider` + child-session spawn +
  variable injection + budget governor, consuming P0 input. This is where the real
  value is (kills request-by-request).
- **P3 — Deterministic+AI hybrid crawl.** Raise Phase-1 coverage (§3.3).
- **P4 — Chrome extension capture source.** Second `CaptureSource` behind the P1
  seam; N-profile model (§3.1). Big/risky — kept last, off the critical path.
- **P5 — Verify loop.** Offline-hypothesis → live-replay bridge (Phase 3). Design the
  bridge early even if built here.

### Benchmark (how we prove 2.0 is better)
Measure on three axes, not raw request count:
- **Coverage:** unique endpoints (not raw captures — 437 raw ≈ 40 unique today).
- **Speed:** unique endpoints / minute.
- **Quality:** share that is authenticated/state-changing vs. static-asset noise.

---

## 6. Tool bricks + framework-adaptive strategies

HackBrowser 2.0's AI is not a cursor that clicks around — it is an **operator armed
with deterministic bricks**. Playwright drove Chromium through `page.click`/`page.type`;
we give the AI the same granularity as tools. The AI decides *which* brick to call
(the ambiguity layer); the brick handles *how* deterministically.

### 6.1 Bricks we already have (analysis + HTTP — reuse, don't rewrite)

| Brick | Role |
|-------|------|
| `http_replay` / `http_replay_raw` | Credential-based replay + mutation ops — IDOR/BFLA/param-fuzz core |
| `csrf_extract` | Token extraction (also feeds framework `submit`) |
| `web_get_*` / `web_write_*` | Endpoint/request/session graph query + write |
| `enrich_vulnerability` / `report_vulnerability` | Finding record (shared with cloud) |
| `azurehook`/`winhook`/`linuxhook`/… | Post-exploit hooks |

### 6.2 Bricks we need — browser-driving primitives

In 1.x these live buried in `navigator.ts`/`executor.ts`/`scanner.ts`; the AI never
sees them. 2.0 exposes them as tools.

| Category | Bricks | Determinism |
|----------|--------|-------------|
| **Navigation** | `goto` `back` `forward` `reload` `wait_for(selector\|idle\|settle\|hydrated)` | Fully deterministic |
| **Observation** | `dom_snapshot` `a11y_tree` `collect_elements` `collect_links` `screenshot` `page_diff` `framework_fingerprint` | Fully deterministic (no LLM) |
| **Human-like interaction** | `click` (bezier cursor path+hover) `type` (real keystroke) `scroll` `hover` `select` `check` `upload` `drag` | Deterministic primitive, AI triggers |
| **Identity/session** | `switch_credential` `cookies_get/set` (profile-local) `auth_sync` | Deterministic |
| **Traffic** | `capture` (HAR emit) | Deterministic |

### 6.3 Human-like `type` is not cosmetic

`type` must be **real keystroke, not fill/paste**, or tests break:
1. **Controlled inputs (React/Angular/Vue):** setting `value` directly does not fire
   `onChange`/`input` → framework state never updates → the form looks empty.
2. **Anti-bot/WAF:** keystroke dynamics + mouse trajectory are analyzed; instant paste
   + straight-line cursor = bot flag.
3. **Live validation/autocomplete:** debounced search, `keyup` validators,
   autocomplete dropdowns only fire on real key events.

Implementation: CDP `Input.dispatchKeyEvent` (per key, jittered delay) +
`Input.dispatchMouseEvent` series (bezier). Under the extension model, same CDP via
`chrome.debugger`.

### 6.4 Framework-adaptive strategies (one brick, pluggable strategy — NOT one brick per framework)

**Anti-pattern to avoid:** `react-click` / `angular-click` / `webforms-click` … →
combinatorial explosion. Instead: a brick's signature is fixed (`type`, `click`,
`navigate`, `submit`); a deterministic `framework_fingerprint` selects the strategy
underneath. The AI need not even know the framework.

**Fingerprint signals (deterministic):**
- Client: `window.React`/`__reactContainer`, `window.ng`/`getAllAngularRootElements`,
  `window.Vue`/`__vue__`, `window.jQuery`, Zone.js
- Meta-framework: `__NEXT_DATA__` + `/_next/` (Next.js), `__NUXT__` + `/_nuxt/` (Nuxt),
  `__data.json` + `data-sveltekit-*` (SvelteKit), `__remixContext` (Remix)
- Server: `__VIEWSTATE`/`__EVENTVALIDATION` (ASP.NET WebForms), `javax.faces.ViewState`
  (JSF), headers (`X-AspNet-Version`, `X-Powered-By`, `Server`), session cookie
  (`JSESSIONID`, `ASP.NET_SessionId`)

**Strategy matrix:**

| Family | Edge case | Brick adaptation |
|--------|-----------|------------------|
| **React** | Controlled input; `fill` skips onChange; SyntheticEvent delegation at root | `type`: bypass native value setter + dispatch `input` |
| **Angular** | Zone.js change detection; Reactive Forms touched/dirty; Shadow DOM common | events inside zone; `dom_snapshot` pierces shadow root |
| **Vue** | `v-model` two-way binding | `type`: real keystroke + `input`/`change` |
| **Meta-framework (Next.js/Nuxt/SvelteKit/Remix)** | **Hydration:** SSR HTML present but dead until JS hydrates → early click/type lost. **RSC/App Router:** nav = RSC payload (`?_rsc=`)/`__data.json`, not full load. **Server Actions:** submit uses `Next-Action` header. **`<Link>` prefetch:** auto background requests → "who really visited" blurred. **Middleware:** route rewrite → requested path ≠ landing | `wait_for`: **hydration-complete**, not DOM-ready. `collect_elements`: don't touch pre-hydration nodes. Discovery: mine endpoints from RSC payload/`__data.json`/`/_next/` chunks. `submit`: preserve `Next-Action`. Mark prefetch (no `trigger_element`) distinct from real navigation in `page_visited_by`. |
| **SPA general** | Client routing (history/hash) — no real navigation; virtual DOM stales element refs; lazy chunks reveal endpoints late | `navigate`: watch route mutation + wait **DOM-settle** (not network-idle); **re-snapshot** after each action; mine endpoints from chunks |
| **ASP.NET WebForms (IIS)** | `__VIEWSTATE`/`__EVENTVALIDATION`/`__doPostBack`; postback = full reload | `submit`: **preserve + resend** viewstate/eventvalidation hidden fields; trigger `__doPostBack` |
| **Java JSF** | `ViewState`, component-tree state, partial ajax submit | `submit`: preserve ViewState token; parse partial-response |
| **Classic SSR (.NET MVC/JSP)** | Full-reload nav; hidden CSRF token | `navigate`: `goto`+network-idle is deterministic; `csrf_extract` carries hidden token |
| **IIS/Windows auth** | NTLM/Negotiate integrated auth | session brick carries negotiate header profile-local; care on replay |

**Two concepts with no prior equivalent in the matrix:**
- **Hydration ≠ DOM-settle.** In SPAs "DOM settled" sufficed; in meta-frameworks the
  DOM exists but is *dead* until hydration — actions before it are silently lost.
  `wait_for` needs a separate hydrated signal. Sneakiest source of timing bugs.
- **Prefetch traffic is misleading.** `<Link>` prefetch produces endpoint requests
  with no user click, corrupting the "did this credential actually see it" signal for
  IDOR/BFLA. Enriched-HAR gets a field: no `trigger_element` ⇒ prefetch, marked apart
  from real navigation.

**Not yet covered (extend the matrix before P3):** Blazor/WASM, htmx, mobile
webviews. Placeholder — confirm signals + strategies when we reach them.

---

## 7. Explicitly out of scope / do-not-do

- Do NOT merge correlation dispatch policy with reporting-copy rules (they change for
  different reasons — same warning as cloud's `INVESTIGATE_PATTERNS` vs `TRIAGE_RULES`).
- Do NOT design "one extension controls all profiles" (Chrome-impossible).
- Do NOT keep request-by-request LLM ingest for analysis. It stays only, if at all,
  as a lightweight "capture + normalize + observe" path feeding the graph.
- Do NOT put client/target names in code, tests, docs, or commits.
