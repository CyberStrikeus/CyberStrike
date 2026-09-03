# HackBrowser 2.0 — AI-Driven Navigator (Design)

> **Status:** design, pre-build. **Supersedes** §3.3 of `HACKBROWSER-2.0-DESIGN.md`
> ("~70% deterministic crawl"). **Builds on** §4.3 (traffic classification & JS mining),
> §6.2 (browser-driving bricks), §6.4 (framework-adaptive strategies) — those stay canonical;
> this doc only changes *who decides where to click*.

## 0. The pivot (the decision this doc records)

**From** (current code): a deterministic ranker (`rank.ts` scoring) drives navigation, with the
LLM only breaking ties, plus three compensating tiers — U1 (expander detection), U2
(effect-tracking), U3 (LLM second-look) — bolted on to cover what the blind ranker misses.

**To**: **the AI drives navigation.** Each step the LLM reads the *full* rich observation
(every interactive element, forms, structure, tech stack, discovered endpoints, coverage) and
produces an ordered **Plan**. The deterministic layer stops trying to *decide* and instead does
the three things it is actually good at:

1. **Observe** — a rich, framework-aware `PageSnapshot` (no LLM).
2. **Guard & bound** — visited/budget/scope/guard/interlock (safety, not intelligence).
3. **Collect data** — endpoints, JS URLs, request/response, tech-stack fingerprint — and feed
   it back to the AI so it acts on *evidence*, not heuristics.

**Why.** The heuristic ranker + U1/U2/U3 are an ever-growing pile of use-cases compensating for
the ranker's blindness to non-`<a>` navigation (SPA buttons, custom widgets). An AI that sees
*everything* needs none of that scaffolding and makes semantically better moves. This is the
1.x "System Observes, LLM Interprets" model — elevated with a far richer observation than 1.x's
Playwright a11y snapshot and with endpoint/JS/tech evidence 1.x never fed the model.

**Non-goals.** Not "pure AI" — the guardrails stay deterministic and binding (an unbounded LLM
crawl is unsafe and non-terminating). Not one-tool-per-framework (see §6.4: one brick, pluggable
strategy). Not carrying raw JS/HTML bodies into LLM prompts (only extracted evidence).

---

## 1. Responsibility split

| Concern | Owner | LLM? |
|---|---|---|
| Extract every interactive element / form / link from the live DOM | Observer | no |
| Detect the framework + server tech | FrameworkFingerprinter | no |
| Collect endpoints / JS URLs / request-response from captured traffic | DataCollector | no |
| **Decide the next action(s) — the Plan** | **Navigator (the brain)** | **yes** |
| Enforce visited / budget / scope / guard / driver interlock | Guardrails | no |
| Execute an action human-like + framework-adapted, then settle & detect effect | Executor | no |
| Orchestrate the loop + termination + memory | CoDriveSession | no |

The only LLM decision is the Plan. Everything around it is deterministic and testable.

---

## 2. Object model (OO, immutable value objects + service interfaces)

### 2.1 Value objects (immutable; the wire between layers)

```
PageSnapshot {
  url, title, description, location: string[], landmarks: Landmark[],
  tech: TechStack,
  elements: InteractiveElement[],        // ALL interactive nodes, annotated
  forms: FormDescriptor[], frames: Frame[], dynamic: boolean, observedAt: number
}
InteractiveElement { id, tag, role, label, kind, why: string[], aria, section,
                     inViewport, disabled, shadow, frame?, href?, targetUrl? }
FormDescriptor { action, method, fields: FormField[], submitId, submitKind }
TechStack { client: string[], metaFramework?, server: string[], sessionKind?, signals: string[] }
Plan { rationale: string, actions: Action[] }         // ordered, bounded
Action = Click{elementId} | Type{elementId,value} | Submit{formId,values} |
         Navigate{url} | Back | Scroll{dir} | WaitHydrated | Done{reason}
ActionResult { ok, status, effect: "navigated"|"revealed"|"noop"|"blocked", url? }
```

### 2.2 Services (interfaces — swappable impls, DI for tests)

```
interface Observer            { observe(sessionID): Promise<PageSnapshot> }
interface Navigator           { plan(snapshot, memory): Promise<Plan> }     // THE BRAIN
interface Executor            { run(sessionID, action): Promise<ActionResult> }
interface FrameworkFingerprinter { detect(client, serverHeaders): TechStack }
interface DataCollector       { latest(sessionID): CollectedData }           // endpoints/js/tech
class     Guardrails          { allow(sessionID, action): "allow"|"deny"|"confirm" }
class     CrawlMemory         { update(snapshot, collected); record(action,result); view(): MemoryView }
class     CoDriveSession      { run(sessionID): Promise<StopReason> }         // orchestrator
```

- **Impls:** `ExtensionObserver` (reads the extension's observation + tech signals),
  `LlmNavigator` (default) + `DeterministicNavigator` (fallback / tests),
  `WebActExecutor` (wraps the shared `WebAct` gated executor + settle + effect detection).
- **DI everywhere** so `CoDriveSession` takes its collaborators in its constructor — every LLM
  or browser touch is behind an interface a test can stub. No singletons reached into.

### 2.3 The loop (CoDriveSession.run — pseudocode)

```
memory = new CrawlMemory(target, scope)
until stop:
  if guardrails.terminal(): stop(budget|human|no-extension); break
  snapshot = await observer.observe(sid)                 // rich + tech-aware
  if !snapshot: idle-wait; break after N
  memory.update(snapshot, dataCollector.latest(sid))     // endpoints/js/tech in
  if memory.pageExhausted(snapshot) && memory.frontierEmpty(): stop(coverage); break
  plan = await navigator.plan(snapshot, memory.view())   // ← the ONLY LLM call
  if plan.empty: memory.markDeadEnd(); navigate(frontier.next() ?? stop(coverage)); continue
  for action in plan.actions:
     d = guardrails.allow(sid, action)
     if d != allow: memory.recordBlocked(action, d); continue
     result = await executor.run(sid, action)            // human-like + framework-adapted + settle
     memory.record(action, result)
     if result.effect in {navigated, revealed}: break    // material change → re-observe + re-plan
     if result.status in stopSet: stop(...); break
```

Re-plan on **material change only** (navigation or new content) — *not* every action. That is
the efficiency win over 1.x, which re-planned every page from scratch.

---

## 3. The Navigator (the brain) — detail

### 3.1 Input context (what makes it smart + framework-sufficient)
The LlmNavigator prompt is assembled from the snapshot + memory:
- **Where am I:** url, title, description, location trail, landmark structure.
- **What tech is this** (the key for "every framework"): TechStack line, e.g.
  *"React SPA — client-side routing; navigations are buttons/role=link/onclick, watch XHR for
  endpoints"* vs *"JSP MPA — full-page navigation; forms POST"* vs *"Next.js — hydration; SSR
  HTML may be inert; nav via RSC/`__data.json`"*. This tells the model **how navigation works
  here** so it clicks the right kind of thing.
- **What can I do:** ALL interactive elements (nav/query/**other**/form) annotated with
  kind/why/aria/section/inViewport — the model sees the custom widgets the old ranker ignored.
- **What's already known:** app purpose (accumulated), **discovered endpoints** (dynamic +
  JS-mined API routes → "these exist, explore them"), visited pages, dead-ends, budget left.

### 3.2 Output
A structured, bounded **Plan**: `{ rationale, actions[] }` (ordered, ≤N). Each action references
an element id or url. `rationale` is logged to HBLog so the operator can *watch the AI reason*.

### 3.3 Model tiering (cost)
- **App-level strategy** (purpose, priorities, what matters in this app): the **main** model,
  run rarely (first page, host change, every K pages) — reuse `WebStrategy`.
- **Per-page planning**: a **mid/small** model, run on material change.
- **DeterministicNavigator** fallback: pick the top unvisited nav/query — used when no model
  resolves, when the model errors, and in every test. Guarantees the crawl never stalls.

### 3.4 Re-plan triggers (the "elevate above 1.x")
Re-plan when: url changed, DOM materially changed (new interactive elements / `dynamic`), the
current plan is exhausted, or a max-actions-per-plan cap is hit. Otherwise keep executing the
current plan. 1.x re-planned every page unconditionally; this is bounded and cheaper.

---

## 4. Framework data sufficiency — "feed the AI enough for every framework" (integrates §6.4)

`FrameworkFingerprinter.detect(...)` runs **deterministically** every snapshot from:
- **Client signals** (extension, in-page): `window.React`/`__reactContainer`, `window.ng`/
  `getAllAngularRootElements`, `window.Vue`/`__vue__`, `window.jQuery`, Zone.js, `__NEXT_DATA__`
  +`/_next/`, `__NUXT__`, `data-sveltekit-*`, `__remixContext`, `data-reactroot`, `ng-version`,
  `<meta name=generator>`.
- **Server signals** (response headers/cookies, from the ingest pipeline): `Server`,
  `X-Powered-By`, `X-AspNet-Version`, `__VIEWSTATE`/`__EVENTVALIDATION` (WebForms),
  `javax.faces.ViewState` (JSF), session cookie (`JSESSIONID`→Java, `PHPSESSID`→PHP,
  `ASP.NET_SessionId`→.NET, `laravel_session`→Laravel).

Two consumers of the TechStack:
1. **The Navigator** gets a plain-language hint (§3.1) so it reasons correctly about navigation.
2. **The Executor** picks the framework strategy (§6.4 matrix) *underneath a fixed brick
   signature* — the AI never needs the framework details:
   - React/Vue/Angular controlled inputs → `type` bypasses the native value setter + dispatches
     `input`/`change` inside the zone (§6.3).
   - Meta-frameworks → `WaitHydrated` waits for *hydration*, not DOM-ready; don't touch
     pre-hydration nodes; mine endpoints from RSC payload/`__data.json`/`/_next/` chunks.
   - ASP.NET WebForms/JSF → `Submit` preserves & resends `__VIEWSTATE`/`ViewState`.
   - Classic SSR → `Navigate` = goto + network-idle; carry hidden CSRF token.

This is exactly the user's "deterministik veri + tech-stack ile AI'yı besle": the fingerprint and
the discovered endpoints are the evidence the AI plans on, and the executor absorbs the
framework-specific mechanics so a click/type/submit "just works" on any stack.

---

## 5. Data collection (deterministic) — integrates §4.3

`DataCollector` reads the ingest pipeline (already routes by `resource_type`) and maintains
`CollectedData` per session, fed into `CrawlMemory`:
- **Endpoints** (xhr/fetch/json/document) → `endpoint_template` + observations (exists today).
- **JS** (script) → **URL + hash only** (never the body) → a JS store for out-of-band mining:
  uncalled/SPA-only API routes, source maps, hardcoded secrets. JS-mined endpoints flow back
  into the Navigator's context as "known but unvisited routes".
- **HTML** (document) → form/link extraction + framework fingerprint.
- **Static** (img/css/font/media) → coverage counters only, never analyzed.
- **Realtime** (ws/eventsource) → separate protocol notes.

Mining stays deterministic (raw JS never enters an LLM prompt; only the extracted endpoint/secret
list does). Reuses 1.x `discovery-core`.

---

## 6. Guardrails (deterministic, binding — safety not intelligence)

Composed policies, each independently testable; `Guardrails.allow(action)` is their AND:
- **VisitedPolicy** — never re-do the same action-key (cycle guard) unless it's productive-repeat
  (Load-more). *(keeps U2's one genuinely-useful idea; drops the tier machinery.)*
- **BudgetPolicy** — hard action cap; the run always terminates.
- **ScopePolicy** — stay within the target's registrable domain (+ explicit scope).
- **GuardPolicy** — logout ⇒ deny, destructive ⇒ human-confirm (from `guard.ts`, one source).
- **DriverInterlock** — a human at the wheel blocks every AI action.

Even if the AI *plans* a logout, the guard denies it. The AI is powerful but caged.

---

## 7. Edge cases (must all be handled)

| Case | Handling |
|---|---|
| SPA re-render invalidates element refs | re-observe after every material action; ids are per-snapshot; Executor detects `revealed` and forces re-plan |
| Hydration (Next/Nuxt/SvelteKit) — SSR HTML inert until JS | `WaitHydrated` brick; don't act on pre-hydration nodes (§6.4) |
| `<Link>` prefetch traffic (no user click) | tagged in ingest (no `trigger_element`) → not counted as "visited by" (§6.4) |
| Modal/overlay opens | new elements appear → `revealed` → re-plan; close control is a normal candidate |
| Infinite scroll / "Load more" | productive-repeat (VisitedPolicy) up to a cap; `Scroll` action |
| Auth wall / login / CAPTCHA | AI cannot pass → plan `Done{reason:auth-wall}` → hand to human (driver toggle) |
| Rate-limit / 429 | Executor backs off; DataCollector notes; AI told "throttled" |
| Redirect loop | VisitedPolicy on the resolved url + budget cap |
| File upload / drag | brick exists (§6.2); AI may use a benign fixture or skip |
| Destructive / logout | GuardPolicy (deny/confirm) — never depends on the AI's judgment |
| Same-origin iframe / open shadow DOM | traversed in the snapshot; frame/shadow tagged |
| Cross-origin iframe / closed shadow | opaque — noted, not pierced |
| Dynamically-added onclick | captured by the rich observation (`why: listener/onclick`) + MutationObserver re-observe |
| No model / model error | DeterministicNavigator fallback — crawl continues deterministically |
| Model hang | per-call timeout → fallback |
| No page observed | idle-timeout → stop(no-page) |
| No extension / driver=human / budget | terminate with reason |
| Dead-end (nothing to do) | frontier backtrack, else stop(coverage) |
| CSRF / ViewState forms | Executor preserves hidden tokens per framework (§6.4) |
| Non-GET nav bodies (form POST full-page) | metadata ingested; body via `requestBody` (future) — flagged |

*Deliberately deferred:* Blazor/WASM, htmx, mobile webviews (§6.4 placeholder — add signals when
reached); raw-body capture for POST navigations (MV3 limit — separate).

---

## 8. What we remove, what stays, migration

**Remove** (subsumed by the AI seeing all elements): `rank.ts` scoring, `unexplored.ts` U1
expanders + U3 second-look. **Fold** U2's productive-repeat into `VisitedPolicy`. **Keep:**
rich observation (now "all interactive elements" in the snapshot), `crawl.ts` (visited/budget/
frontier as guardrail state), `scope.ts`, `guard.ts`, `act.ts` (WebAct executor), `driver.ts`
interlock, `strategy.ts` (app-level understanding), `hblog.ts`, the ingest/endpoint pipeline.

**Migration is additive-then-retire** so nothing breaks mid-flight (§9).

---

## 9. Phased build (each phase independently verifiable)

- **P1 — OO scaffold, behavior-parity.** Value objects + `Observer`/`Executor`/`Guardrails`/
  `CoDriveSession` + `DeterministicNavigator`. The loop runs through the new OO layer but decides
  exactly like today (top unvisited nav/query). Retire nothing. *Verify:* full existing loop
  test-suite passes against the OO loop; new unit tests per class.
- **P2 — FrameworkFingerprinter.** Client (extension) + server (headers) signals → `TechStack`
  on every snapshot + a plain hint. *Verify:* signal-set → TechStack unit tests; extension syntax.
- **P3 — LlmNavigator (the brain).** Rich-context Plan output; default navigator, deterministic
  fallback. **Retire `rank.ts` + U1/U3**, fold U2 into VisitedPolicy. *Verify:* context builder +
  Plan parse/validate + fallback tested; loop with a stub navigator; **LLM happy-path UNVERIFIED**
  (needs a live model — flagged).
- **P4 — DataCollector + JS-URL collection + mining → memory.** Endpoints/routes/tech in the AI
  context. *Verify:* traffic → CollectedData → memory-view unit tests.
- **P5 — Framework-adaptive Executor strategies** (§6.4 matrix): React native-setter type,
  WaitHydrated, ViewState preservation, etc. *Verify:* per-strategy unit tests where deterministic;
  live behavior UNVERIFIED (browser).

---

## 10. Testing strategy (what's provable vs not)
- **Deterministic / unit-testable:** every value object, `FrameworkFingerprinter` (signals→stack),
  every Guardrail policy, `Executor` via a fake browser socket, `DataCollector` (traffic→memory),
  `CoDriveSession` end-to-end with `DeterministicNavigator` and a scripted site, context builders.
- **NOT provable here (flag honestly):** the `LlmNavigator`'s real plan quality and the
  framework-adaptive Executor's live behavior — both need a real model + real Chrome. We test
  their pure parts (context, parsing, fallback, strategy selection) and verify end-to-end live is
  the operator's step, read back through HBLog + the DB.

---

## 11. Open decisions (confirm before P3)
1. **Per-page vs material-change re-plan** — recommend material-change (cheaper, still smart).
2. **Model for per-page planning** — small vs mid tier (cost vs quality).
3. **Keep DeterministicNavigator forever** as the no-model fallback — recommend yes (robustness).
