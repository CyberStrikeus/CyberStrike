# CyberStrike Web Workflow 2.0 — Implementation Plan

> HackBrowser 1.x ingest + proxy-agent pipeline replacement.
> WSTG-aligned sub-agents + per-domain smart tools + deterministic signal/canary correlation.
> **branch:** `web-workflow` · every claim below is code-verified (file:line cited).

---

## 00 — Goal & Non-Negotiables

Replace the HackBrowser 1.x web-testing pipeline — extension ingest, serial queue, orchestrator + 9 proxy testers — with a WSTG-aligned sub-agent set, per-domain smart tools, and a deterministic signal-correlation layer that makes cross-agent, cross-time evidence impossible to lose.

### Design invariants (do not compromise)

1. **Object-Oriented throughout — npm-package-ready from day one.** Every unit (providers, smart tools, detectors, registries, router, stores) is a class or interface with an explicit contract, so the whole web domain lifts cleanly into `@cyberstrike/web` depending on `@cyberstrike/core`. No free-floating functions holding hidden state; no cross-module reach-ins. See §03B for the class/interface hierarchy. This is a hard requirement, not a stylistic preference.
2. **All HTTP goes through the `http_replay` engine.** Smart tools NEVER open their own sockets or shell out to curl/python. They compose an injected replay-transport interface (the verified engine in `replay/`). Payloads travel as request DATA, byte-exact, governed (timeout/retry/budget/circuit-breaker). This is both the OO seam (dependency injection) and the safety guarantee.
3. **Reasoning stays with the AI.** Tools own mechanics (payloads, encoding, comparison, detection). Agents own judgment (what to test, is it real, false-positive gates, chaining). Target ratio per agent ≈ the LLM tester today: ~25% mechanical / ~75% reasoning.
4. **Nothing half-baked.** Every WSTG cell is either mapped to a tool operation or explicitly marked out-of-scope with a reason. No agent ships without its payload library reviewed and its detectors unit-tested.
5. **Coverage is measurable.** The 97 WSTG tests × agent × operation form a matrix; a gap is visible, not silent.
6. **Ordering independence.** A finding must surface regardless of which agent triggered the evidence or when — enforced by deterministic detection, not LLM initiative.

---

## 01 — Verified Breaks in HackBrowser 1.x

These are concrete failures confirmed in code. The plan is built to close each one.

| # | Break | Consequence | Evidence |
|---|-------|-------------|----------|
| **B1** | HTML response bodies are **discarded at ingest** — replaced by the stub `"This is an HTML response"` | The exact place stored XSS/SSTI renders is thrown away. Cross-page reflection is invisible in persisted data. | `response-processor.ts:52-53` |
| **B2** | `http_replay` / `csrf_extract` responses are **never written back** to any shared store | Evidence an agent elicits (error page, reflection) dies in that agent's context when it finishes. | grep: no `Request.add` / `Observation.record` in `http-replay.ts` |
| **B3** | **No canary registry + no cross-response correlation.** Injected markers aren't recorded; later responses aren't scanned for prior markers | Second-order / stored injection (inject at A, render at B) is undetectable. | grep: no canary/marker registry in `session/ tool/ replay/` |
| **B4** | Re-test queue triggers on **architecture only** — `new_role`, `new_object_value`, `new_credential` | Evidence surfaced during testing never re-queues the right specialist. | `web-retest.ts:8`, `checkTriggers` |
| **B5** | Cross-lane handoff is **LLM-initiative only** (`add_intel` + `target_class`); lane discipline says "log one line, move on" | Off-class findings depend on the model choosing to hand off AND the orchestrator choosing to route. Fragile. | `intel.ts:37-47`, `common-prompt.txt:11-18` |
| **B6** | Prompt bloat: each tester runs on **245-line common + 112-547 line specialist + embedded WSTG skills** (~800+ lines) | ~50-70% is payload lists / procedures a tool should own; wastes tokens the weekly limit can't spare. | `common-prompt.txt` (245), `vuln/*/prompt.txt`, `agent.ts:88-122` |
| **B7** | **WSTG blind spots**: CONF, CRYP, SESS, CLNT, ERR barely or not covered | Whole categories (backup files, admin interfaces, HSTS, cookie flags, CORS, clickjacking, stack traces) are missed. | `agent.ts:579-627` (only 9 vuln classes) |

---

## 02 — What 1.x Got Right — Preserve Exactly

- **key_hash endpoint dedup** — only a NEW endpoint shape triggers LLM analysis; repeat shapes record an observation only. Core cost control. (`session.ts:1810-1959`, atomic upsert `:1877`)
- **Serial ingest + atomic key_hash upsert** — no double-analysis under concurrent captures. Keep the serialization guarantee; add governed parallelism only in tester dispatch.
- **Analyzer-first (blocking)** — testers depend on the objects/roles/values the analyzer extracts. Keep the barrier.
- **Shared DB stores + `web_get_session_context`** — the read path by which any agent sees prior findings, roles, credentials, observations, coverage. Extend, don't replace.
- **Coverage notes (wide/local)** — app-wide mechanisms tested once per origin. Keep; the signal layer feeds it.
- **Cross-credential Observation store** — the IDOR/BOLA substrate. Keep; access-control tooling reads it.
- **Re-test queue** — keep the machinery, extend its trigger set (B4).

---

## 03A — Target Architecture — Four Layers

- **Layer 1 — Capture & Ingest (extension + serial queue).** Unchanged in shape, with ONE addition: a body-scan hook runs BEFORE the HTML stub replaces the body (fixes B1).
- **Layer 2 — Deterministic Signal Fabric (NEW, code not LLM).** Passive detectors + canary registry + cross-response correlation + signal router. Runs on every response (captured OR replay-elicited). Ordering-independent. The load-bearing new layer.
- **Layer 3 — Reasoning Agents (WSTG-aligned).** Orchestrator + analyzer + wide-scope specialists (recon, misconfig) + per-endpoint specialists (injection, access-control, auth-session, server-side-request, business-logic, llm) + Phase-2 client-side. Thin prompts, rich per-domain smart tools.
- **Layer 4 — Findings & Coverage (shared stores).** Vulnerability, CoverageNote, Signals, Canary registry — all readable via `web_get_session_context`. The measurable-coverage backbone.

---

## 03B — Object-Oriented Structure (the package contract)

Everything below is designed so the web domain becomes `@cyberstrike/web`, a package depending on `@cyberstrike/core`, registered through the existing `AssessmentProvider` contract (`cloud/provider.ts`) — the same OO seam Azure already uses. **The OO design is not deferred to a later phase; it is how P0 is built.**

### Core interfaces / classes

```ts
// ── Domain provider (mirrors cloud/provider.ts AssessmentProvider) ──
// The package's single registration entry point. Replaces the hardcoded
// `new AzureProvider()` pattern with a registry the app populates.
interface WebProvider extends AssessmentProvider {
  key: "web"
  agentSpecs(): AgentSpec[]           // orchestrator, analyzer, all specialists
  detectors(): Detector[]             // the passive signal fabric (§06)
  smartTools(): SmartToolSpec[]       // inject_test, access_test, ... (§05)
  signalRouter(): SignalRouter        // signal_type → specialist map (§07)
}

// ── Smart tool base — composes the replay transport by injection ──
// No tool owns a socket; all sends go through the injected engine (invariant 2).
abstract class SmartTool<P, R> {
  constructor(protected readonly replay: ReplayTransport,
              protected readonly canary: CanaryRegistry,
              protected readonly signals: SignalSink) {}
  abstract readonly name: string                 // e.g. "inject_test"
  abstract readonly operations: ReadonlyArray<Operation<P, R>>
  abstract execute(op: string, params: P, ctx: ToolContext): Promise<R>
}

// ReplayTransport is the ONLY way to emit HTTP — a thin interface over the
// existing engine (replay/send, backend-fetch, backend-socket, governor).
interface ReplayTransport {
  send(msg: HttpRequest, opts: SendOpts): Promise<ReplayResult>
  compare(baseline: HttpRequest, exploit: HttpRequest, opts: SendOpts): Promise<Diff>
  sweep(base: HttpRequest, mutation: Mutation, values: string[], opts: SendOpts): Promise<ReplayResult[]>
}

// ── Detector — one class per signal family (§06) ──
interface Detector {
  readonly signalType: SignalType
  readonly owner: SpecialistClass          // deterministic routing target
  detect(res: ObservedResponse, ctx: DetectContext): Signal[]   // pure, no I/O
}

// ── Canary registry + stores (repository pattern over the DB) ──
class CanaryRegistry {
  register(c: CanaryInput): Canary                 // on every injection
  scan(body: string, res: ObservedResponse): CanaryHit[]   // vs ALL registered
}
class SignalRouter {
  route(signal: Signal): { specialist: SpecialistClass; retest: RetestEnqueue }
}
```

### Rules that keep it package-clean

- **Dependency injection, not import-time singletons.** `ReplayTransport`, `CanaryRegistry`, `SignalSink` are constructor args — swappable in tests, no hidden global state.
- **Detectors are pure.** `detect()` does no I/O; it takes a response, returns signals. Trivially unit-testable (validation gate §11).
- **Stores are repositories.** `CanaryStore` / `SignalStore` wrap the DB (Drizzle, snake_case columns per AGENTS.md); domain classes never touch SQL directly.
- **The provider is the only registration surface.** App wiring calls `registry.add(new WebProvider(deps))` — the same shape as `new AzureProvider()`. This is the load-bearing extension point for the open-core / enterprise split.
- **`@cyberstrike/core` boundary:** session, DB, Bus, normalize, methodology, agent-loader, plugin-loader, and the `replay/` engine live in core. `@cyberstrike/web` = provider + agents + smart tools + detectors + payload libraries.

---

## 04 — Sub-Agent Roster + Tools

**Phase 1 = 10 agents** (2 support + 2 wide-scope + 6 per-endpoint). Phase 2 adds client-side (11). The deterministic signal fabric is code, not an agent.

### Support (unchanged in role)

| Agent | Role | Model / Steps | Tools |
|-------|------|---------------|-------|
| **web-proxy-agent** | Orchestrator — routing, triage, cross-endpoint chaining. Now trusts the signal router for cross-lane handoff. | full · 40 | web_get_session_context, task, get_coverage_notes, triage_vulnerability, methodology_status |
| **proxy-analyzer** | Architecture extraction (objects/roles/functions/values). Blocking first step. | small · 20 | http_replay, web_write_role/object/object_value/function, web_update_credential_claims, web_get_* |

### Wide-scope specialists — run once per origin (the two you asked for)

| Agent | WSTG | Smart tool | Also uses |
|-------|------|-----------|-----------|
| **recon** *(NEW)* | INFO (10) + ERR (2) | `recon_test` | http_replay, webfetch, skill, report_vulnerability, record_coverage_note |
| **misconfiguration** *(NEW)* | CONF (11) + CRYP (4) + header-checkable CLNT (CORS, clickjacking, cookie flags) | `misconfig_test` | http_replay, http_replay_raw, skill, report_vulnerability, record_coverage_note |

### Per-endpoint specialists

| Agent | WSTG / classes | Smart tool | Also uses |
|-------|----------------|-----------|-----------|
| **injection** | INPV core: XSS, SQLi, NoSQLi, LDAP, XML, SSI, XPath, code, command, SSTI, format-string, HPP, verb-tampering | `inject_test` | http_replay(_raw), csrf_extract, skill, report/triage/coverage |
| **access-control** *(MERGED)* | ATHZ (4: IDOR, authz-bypass, priv-esc, dir-traversal) + APIT GraphQL BOLA + mass-assignment | `access_test` | http_replay(_raw), skill, report/triage/coverage |
| **auth-session** *(MERGED)* | IDNT (5) + ATHN (10) + SESS (9) | `authn_test` | http_replay(_raw), csrf_extract, skill, report/triage/coverage |
| **server-side-request** | INPV-19 SSRF + INPV-15 smuggling/splitting + INPV-17 host-header | `ssrf_test` | http_replay_raw, skill, report/triage/coverage |
| **business-logic** | BUSL (9) incl. file upload (BUSL-08/09) + race/timing | `business_test` | http_replay, skill, report/triage/coverage |
| **llm** | OWASP LLM Top-10 (beyond WSTG; the ratio template) | `llmhook` *(exists)* | http_replay, report_vulnerability, add_intel |

### Phase 2

| Agent | WSTG | Smart tool | Dependency |
|-------|------|-----------|------------|
| **client-side** *(P2)* | CLNT (13): DOM XSS, JS execution, postMessage, WebSocket, storage, CSRF render | `client_test` | Browser co-drive (hackbrowser) — pure HTTP replay cannot test DOM sinks. Header-checkable CLNT items covered by misconfig in P1. |

---

## 05 — Smart Tool Catalog

Each tool is a `SmartTool` subclass with an operation enum dispatching to handlers (the azurehook model), sharing a `tool/webhook/` module for payload libraries and response analysis. **All send through the injected `ReplayTransport`** (invariant 2).

| Tool | Operations | Built-in (tool-owned) |
|------|-----------|-----------------------|
| `inject_test` | `probe`, `confirm`, `sweep`, `fingerprint` | ~200 payloads across ~29 libraries (sqli by DBMS, xss by context, ssti by engine, cmdi, nosqli, xxe, ldap, waf-bypass); tech-aware filtering; error-signature + reflection + timing + WAF detection; canary generation + registration |
| `access_test` | `cross_credential`, `unauth`, `id_probe`, `param_swap`, `role_matrix`, `privilege_escalation`, `field_inject`, `dir_traversal` | reads Observation cross-credential values; ID strategies (sequential/boundary/uuid/admin); mass-assignment field dictionaries; traversal encoding table; auth-header catalog |
| `authn_test` | `jwt_analyze`, `session_test`, `brute_detect`, `password_policy`, `account_enum`, `reset_flow` | native JWT (alg:none, RS256→HS256, kid/jku injection, weak-secret list) replacing Python jwt_tamper; cookie-flag checks; fixation/timeout procedures |
| `ssrf_test` | `probe`, `protocol`, `bypass`, `smuggle`, `host_header` | internal-target set (localhost variants, decimal/hex/octal IP, cloud metadata per provider), protocol handlers, OOB callback canary, smuggling/CL-TE templates |
| `business_test` | `race`, `boundary`, `workflow_skip`, `price_tamper`, `function_limit`, `file_upload` | concurrent race engine (Batch.run, not sequential); boundary-value set; financial-field detection; webshell/polyglot/extension-bypass generation (folds file-attacks upload) |
| `misconfig_test` | `http_methods`, `headers`, `tls`, `backup_files`, `admin_interfaces`, `cloud_storage`, `subdomain_takeover`, `cors` | security-header ruleset, backup/temp filename wordlist, admin-path wordlist, cloud-bucket probes, TLS/cipher checks, CORS reflection tests |
| `recon_test` | `fingerprint_server`, `fingerprint_framework`, `entry_points`, `metafiles`, `content_leakage` | server/framework signature DB, robots/sitemap/.well-known parsing, comment/metadata leakage patterns, entry-point extraction |
| `client_test` *(P2)* | `dom_xss`, `postmessage`, `websocket`, `storage`, `redirect` | co-drive-driven DOM sink instrumentation; postMessage/WS harnesses |

**Shared spine (exists, all agents):** `http_replay`, `http_replay_raw`, `csrf_extract`, `web_get_session_context`, `web_get_request_detail`, `web_get_detail`, `report_vulnerability`, `triage_vulnerability`, `record_coverage_note`, `skill`.

---

## 06 — Cross-Cutting Signal + Canary Catalog

The deterministic detectors (Layer 2). Each is a `Detector` class; `detect()` is pure and runs on every response — captured or elicited — independent of which agent is active. A firing signal is routed to its owning specialist as a confirm-and-report task.

### Passive signals (detector → owning specialist)

| Signal | Detection (deterministic) | Owner | WSTG |
|--------|---------------------------|-------|------|
| `full_path_disclosure` | filesystem path patterns in body (`/var/www`, `C:\`, `__FILE__`) | misconfig / recon | ERR, INFO-05 |
| `stack_trace` | language stack-trace signatures (`Traceback`, `at java.`, `#0 in`) | misconfig | ERR-02 |
| `sql_error` | DBMS error strings (`Observe.errorSignatures`) | injection | INPV-05 |
| `server_banner` | `Server` / `X-Powered-By` / `X-AspNet-Version` headers | recon | INFO-02/08 |
| `directory_listing` | `Index of /` + autoindex markup | misconfig | CONF-04 |
| `missing_security_headers` | absence of CSP / HSTS / X-Frame-Options / X-Content-Type-Options | misconfig | CONF-07, CLNT-09 |
| `cors_misconfig` | `ACAO: *` or reflected Origin + `ACA-Credentials: true` | misconfig | CLNT-07 |
| `weak_cookie_flags` | Set-Cookie missing HttpOnly / Secure / SameSite | auth-session | SESS-02 |
| `sensitive_data_exposure` | PII / API-key / private-key / token regexes in body | recon / misconfig | INFO-05, CRYP-03 |
| `open_redirect` | Location header reflects attacker-controlled URL param | access-control / client-side | CLNT-04 |
| `graphql_introspection` | `__schema` response to introspection query | access-control | APIT-01 |
| `exposed_artifact` | `.git`/`.env`/`.bak`/backup path returns 200 | misconfig | CONF-04 |
| `jwt_leak` | JWT structure appears in a response body | auth-session | SESS-04 |
| `rate_limit_absent` | N repeat sends, no 429 / lockout | business-logic / auth-session | ATHN-03, BUSL-05 |
| `reflected_input` | request marker echoed raw vs encoded (`Observe.reflection`) | injection | INPV-01 |
| `stored_reflection` | **canary from inject-site A appears in render-site B** | injection / client-side | INPV-02 |

### Canary types (registered on injection, scanned in all later responses)

| Canary | Form | Detects | Confirms |
|--------|------|---------|----------|
| `reflect` | unique token `cs<hex>` | HTML/attribute/JS-context reflection, incl. cross-page | reflected + stored XSS |
| `template` | arithmetic marker `${cs*}`, `{{cs*}}` | engine evaluation (7*7→49 near token) | SSTI |
| `callback` | OOB host/token (ssrf_listener) | outbound connection from server | blind SSRF / XXE-OOB |
| `file` | unique filename + content sentinel | uploaded file later served / included | upload→LFI chain |
| `log` | token in UA/Referer | token rendered by a log viewer/include | log poisoning → LFI |

**The registry closes B3.** Every injection — from a smart tool, `http_replay`, OR a captured form submit — writes `{token, origin_request_id, endpoint, field, agent, class, ts}` to a durable canary store. Every response body, scanned at ingest *before* the HTML stub replaces it (closes B1), is checked against ALL registered canaries. A hit where `render_site ≠ inject_site` emits `stored_reflection` → routed to injection/client-side for context confirmation. The scan is bounded: keep the canary-hit index and signature hits, not necessarily the full HTML.

---

## 07 — Coordination Mechanism

1. **Ingest body-scan hook** — at `session.ts:~1791` (where `DataCollector.record` already runs), add: run passive detectors + canary scan on the RAW body before `processResponse` stubs it. Persist signal + canary hits. **[fixes B1]**
2. **Write-back for elicited traffic** — `http_replay` and every smart tool feed their responses through the same detector+canary scan and register any canaries they injected. **[fixes B2/B3]**
3. **Signal store** — durable `{signal_type, request_id, evidence_snippet, owner_class, status}`; surfaced in `web_get_session_context`.
4. **Deterministic router** — a static `signal_type → specialist` map (`SignalRouter`). On a new signal outside the eliciting agent's lane, enqueue a scoped confirm task via the re-test queue. **[fixes B5]**
5. **Re-test trigger extension** — add `new_signal` to `WebRetest.TriggerType` alongside the three architecture triggers. **[fixes B4]**
6. **Proactive revisit** — after an injection, the co-drive/crawler revisits candidate render pages so `stored_reflection` fires without waiting for a human to browse there.

---

## 08 — Data Flow — Stored XSS, End to End

The scenario undetectable in 1.x, traced through 2.0:

```
inject_test on page A: POST payload+canary ──> CanaryRegistry.register(token → site A)
        │                                              │
        └─> replay response scanned + written back ────┤
                                                        ▼
Extension / co-drive: browse page B                CanaryRegistry.scan(body)
        │                                               │  token from A found in B
        ▼                                               ▼
POST /session/ingest ─> [ingest body-scan hook]  ─> Signal: stored_reflection {inject=A, render=B}
   (BEFORE HTML stub)  ─> passive Detectors[]     ─> Signals: path_disclosure, headers, ...
                                                        │
                                                        ▼
                                                 SignalRouter.route()  (deterministic)
                                                        │ owner = injection
                                                        ▼
                                          WebRetest.enqueue(new_signal)
                                                        │
                                                        ▼
                                     injection specialist: confirm execution context
                                                        │
                                                        ▼
                                             report_vulnerability
```

---

## 09 — WSTG Coverage Map — 97 tests → agents

| WSTG category | Tests | Owner agent(s) | Phase |
|---------------|-------|----------------|-------|
| INFO — Information Gathering | 10 | recon (+ analyzer) | P1 |
| CONF — Config & Deployment | 11 | misconfiguration | P1 |
| IDNT — Identity Management | 5 | auth-session | P1 |
| ATHN — Authentication | 10 | auth-session | P1 |
| ATHZ — Authorization | 4 | access-control | P1 |
| SESS — Session Management | 9 | auth-session (+ `weak_cookie_flags` passive) | P1 |
| INPV — Input Validation | 19 | injection (16) + server-side-request (SSRF/smuggling/host-header, 3) | P1 |
| ERR — Error Handling | 2 | misconfig/recon (passive `stack_trace`, `path_disclosure`) | P1 |
| CRYP — Weak Cryptography | 4 | misconfiguration | P1 |
| BUSL — Business Logic | 9 | business-logic | P1 |
| CLNT — Client-side | 13 | misconfig (CORS/clickjacking/cookie, 3) + client-side (DOM/PM/WS/storage, 10) | P1 / P2 |
| APIT — API Testing (GraphQL) | 1 | access-control + injection | P1 |

**Every one of the 97 tests has an owner.** The 10 DOM-dependent CLNT tests are the only Phase-2 deferral, gated on co-drive — flagged, not silently dropped.

---

## 10 — Implementation Phases + Files

### P0 — Signal Fabric — the load-bearing base (build & verify FIRST)

- `session/web/canary.ts` — `CanaryRegistry` + `CanaryStore` (durable, + SQL table in `session.sql.ts`)
- `session/web/signals.ts` — `SignalStore` + types + `web_get_session_context` surfacing
- `session/web/detectors/*.ts` — one `Detector` class per signal family; reuse `replay/observe.ts`
- `session/web/signal-router.ts` — `SignalRouter` static map → `WebRetest.enqueue`
- Edit `session/response-processor.ts:52` — scan-before-stub (**fixes B1**)
- Edit `server/routes/session.ts:~1791` — invoke detectors + canary scan at ingest
- Edit `session/web/web-retest.ts:8` — add `new_signal` trigger
- Edit `tool/http-replay.ts` — write-back + canary registration hook (**fixes B2/B3**); refactor its send path behind the `ReplayTransport` interface

### P1 — Smart tools + WSTG agents

- `tool/webhook/` — shared: `payloads/*.ts`, `analyze.ts`, `SmartTool` base, `canary` glue
- `tool/webhook/{inject,access,authn,ssrf,business,misconfig,recon}.ts` — 7 `SmartTool` subclasses
- `agent/prompt/vuln/{...}` — slim prompts to reasoning core (drop payload procedures; target ~120 lines)
- New prompts: `recon/`, `misconfiguration/`; merge idor+authz+mass-assignment → `access-control/`; merge idnt+athn+sess → `auth-session/`
- `agent/agent.ts` — register 10 agents, scoped tool permissions per §04
- Update orchestrator prompt — thin routing; trust the signal router for cross-lane

### P2 — Client-side + WebProvider (OO / modular)

- `tool/webhook/client.ts` + client-side agent (co-drive gated)
- ~~`cloud/provider-web.ts` — `WebProvider implements AssessmentProvider`~~ **DONE** — `WebProvider implements DomainProvider` (extracted base interface; `AssessmentProvider extends DomainProvider`). Factory pattern (`WebProvider.create()`) loads skills + composes prompts. 12 agents, 16 tests / 109 assertions.

### P3 — Validation suite (see §11)

---

## 11 — Verification & Validation Gates

No component is "done" until it passes its gate. This is the explicit anti-half-baked contract.

| Component | Gate — must pass before merge |
|-----------|-------------------------------|
| Each passive detector | Unit test: fixture response with the vuln → signal fires; clean fixture → no signal. Both directions asserted. (Pure `detect()` makes this trivial.) |
| Canary correlation | Test: register canary at A, feed a B fixture containing it → `stored_reflection` with correct inject/render sites. Negative: same-site reflection ≠ stored. |
| Signal router | Table test: every signal_type maps to exactly one owner; no orphan signals; `new_signal` enqueues the right specialist. |
| Ingest hook (B1) | Test: HTML body with a canary is scanned and the hit persisted, even though processed_response is stubbed. |
| Write-back (B2/B3) | Test: an `http_replay`-elicited error page fires `full_path_disclosure` and reaches the signal store. |
| Each smart tool | Payload library peer-reviewed; every operation returns the documented structured shape; tech-filter correctness tested; all sends go through injected `ReplayTransport` (no raw sockets). |
| WSTG coverage | Assertion: every one of 97 tests maps to an owner+operation or an explicit out-of-scope marker. CI fails on an unmapped cell. |
| End-to-end benchmark | Run against a known-vulnerable target (Juice Shop / XBEN set already referenced in stuck-detector). Assert: known findings detected, stored-XSS case caught, coverage matrix fills. |
| Regression | No finding class the 9 old testers caught is lost after the refactor. Diff old vs new on the same target. |
| Token budget | Measure per-endpoint token cost old vs new; injection path must drop materially (target ≈ 5-6× reduction) with equal-or-better coverage. |
| OO / package | `@cyberstrike/web` builds as an isolated unit against a mocked `@cyberstrike/core`; no import reach-ins; provider is the only registration surface. |

---

## 12 — Resolved Decisions (with rationale)

| Decision | Resolution | Rationale |
|----------|-----------|-----------|
| OO throughout | **Yes, from P0** — classes/interfaces, DI, repository stores, single provider registration | npm-package-ready tomorrow; matches Azure's `AssessmentProvider` seam; testable in isolation |
| HTTP transport | **All sends via injected `ReplayTransport` (http_replay engine)** | OO seam (DI) + byte-exact/governed safety; no tool opens its own socket |
| client-side agent timing | **Phase 2**, header-checkable CLNT items in P1 via misconfig | DOM XSS/postMessage/WS need real browser co-drive; pure replay can't test them. Defer honestly, cover header parts now. |
| SSRF placement | **Own agent** (server-side-request), not folded into injection | URL-param endpoints common, metadata theft critical, distinct reasoning (internal targets, blind/OOB, smuggling) |
| auth-session breadth (24 tests) | **One merged agent** | Coherent reasoning domain ("who are you / is your session valid"); most ATHN/CRYP items are wide-scope (tested once per origin) |
| idor + authz + mass-assignment | **Merged → access-control** | All three are "touch/change what you shouldn't," share the "ALL-conditions / do-NOT-report" gate; orchestrator already dispatches all three to the same endpoint — merging removes redundant spawns |
| file-attacks split | traversal→access-control, upload→business-logic (per WSTG) | Follow WSTG's principled placement; upload→LFI chain crosses the two, wired by the `file` canary + orchestrator chaining |
| single wide tool vs per-domain tools | **Per-domain** (`SmartTool` subclasses) sharing `tool/webhook/` | Web operations don't share azurehook's uniform shape; per-tool Zod validation + clean permission scoping win |

---

*This document is the review artifact. Each section is code-verified; each break has a fix; each WSTG test has an owner; each component has a validation gate. Nothing here is meant to be accepted un-scrutinized.*

---

## 13 — P0 status + existing-tool audit (correction, 2026-09-05)

### P0 (signal fabric) — BUILT & VERIFIED
Implemented and tested (49 tests / 180 assertions, 0 fail; tsgo 0 errors; full server suite no new regressions — the only 2 fails are the pre-existing `web-driver.test.ts`):
- `src/session/web/signal/` — `types`, `detectors` (13 passive detectors), `canary` (`CanaryRegistry` + cross-response correlation), `router` (`SignalRouter`, total over SignalType + priority), `store` (`DbCanaryStore` + `SignalStore`), `signal.sql` + migration `20260905000000_web-signal-fabric`, `ingest` (`scanCapturedResponse`/`scanElicitedResponse`).
- Wiring: ingest hook in `server/routes/session.ts` (**B1** — scans raw body before the HTML stub); `http-replay.ts` write-back + marker→canary (**B2 + replay half of B3**); `web-retest.ts` `new_signal` trigger + router→`WebRetest.enqueue` (**B4**, enqueue only; orchestrator consumption is P1); `Request.findId`; signals surfaced in `web_get_session_context`.
- **Still P1:** orchestrator consuming `new_signal` retests. ~~smart-tool canary registration~~ **DONE** (inject_probe R3, `e7dd40ed07`; signal write-back R4, `6e062e66c4`). ~~`reflected_input` detector~~ **DONE** — emitted by inject_probe on XSS marker reflection + HPP duplicate-param reflection (not a passive detector by design; recorded to SignalStore with field/context/encoding meta). UNVERIFIED: http_replay live-network path; detector FP/FN vs real traffic (needs the §11 benchmark).

### Existing-tool audit — the smart-tool catalog (§05) is largely REUSE, not new build
A code audit found the web tool layer already embodies the "tool = raw facts/breadth, agent = reasoning" model. **This supersedes the "build 7 new smart tools" framing of §05/§10-P1.**

| §05 planned tool | Reality (code-verified) | Corrected action |
|---|---|---|
| `inject_test` | **`inject_probe`** (`tool/inject-probe/`, 17 modules, refactored from 1859-line monolith) covers xss/ssti/cmd/**sqli**/nosql/ldap/xpath/lfi/**hpp** with per-DBMS batteries, filter-bypass, facts-not-verdicts (`vuln_type` enum, 9 classes) | **REUSE — FULLY INTEGRATED.** R0–R6 refactor complete: governed transport (R1), shared probe runner (R2), canary registration (R3), signal write-back (R4), HPP + adaptive back-off (R5), 268 unit tests (R6). See `docs/inject-probe-refactor-plan.md`. |
| access mechanics (cross-cred, unauth, id sweep) | **`http_replay`** already has `credential`, `unauthenticated`, `compare`, `sweep` modes | **REUSE.** A new `access_test` would duplicate the send mechanics. |
| IDOR candidate substrate | **`Observation.endpointTree`** already gives per-param per-credential values ("RAW FACTS ONLY — owner judgment is the agent's", line 103) | **REUSE.** Auto-generating candidates with idLike heuristics would move reasoning INTO a tool — violates the reasoning-stays-with-AI invariant. |
| misconfig/recon classification | **P0 fabric** already detects banners, headers, cookies, CORS, path disclosure, exposed artifacts, directory listing PASSIVELY on every response (incl. http_replay-elicited via B2) | **REUSE.** Active probing just needs to SEND candidate paths (via http_replay); the fabric classifies for free. |
| `recon_test` | **NEW** — 3-mode tool (metafiles/fingerprint/leakage). Parses content of robots.txt/sitemap.xml/openapi.json (URL extraction), active tech fingerprinting (10 probes), HTML comment/IP/version/debug-flag scanning. `proxy-tester-recon` agent wired with WSTG INFO-02/03/05/08. | **DONE** — `195a29a280`. 26 unit tests pass. |
| `authn_test`, `ssrf_test`, `business_test` | Only Python `attack_script` variants (`jwt_tamper`, `ssrf_listener`, `race_tester`) exist; no native tool | **GENUINE GAPS** — native TS replacements (aligns with the [[next-release-todos]] attack_script conversion). |

### Corrected P1 scope
The real remaining P1 work is NOT a fleet of new payload tools. It is:
1. **Agent restructuring** — WSTG-aligned specialists with THIN prompts that lean on `inject_probe` + `http_replay` + `csrf_extract` + the P0 fabric (the biggest genuine gap; prompt/registration work in `agent/agent.ts` + `agent/prompt/vuln/`).
2. **Orchestrator consumes the fabric** — route `new_signal` retests + the `signals` context block to the owning specialist (prompt logic).
3. **A few genuinely-missing active tools** — misconfig active-probe (wordlists + send-via-http_replay; fabric classifies), and native `authn`/`ssrf`/`business` to replace the Python scripts.
4. **The OO `WebProvider`** registry — **DONE.** `DomainProvider` base interface extracted; `WebProvider implements DomainProvider` in `cloud/provider-web.ts`; `agent.ts` wired via `WebProvider.create()` (factory pattern).

Net: injection + access-control mechanics are already done in the tool layer; P0 added the detection fabric; **P1's leverage is the agent layer + the ~4 genuinely-missing active probes, built to REUSE the send + detection layers rather than duplicate them.**

---

## 14 — P1 progress — smart tools + shared infrastructure (2026-09-05)

### Shared transport layer — BUILT & VERIFIED

All webhook smart tools share a single send path (invariant 2: no tool opens its own socket).

| File | Lines | What it does |
|------|-------|-------------|
| `src/replay/govern.ts` | 34 | `governedSend(msg, origin, opts)` — single governed-send primitive (budget + breaker + Send.governed + BackendFetch). Extracted from http-replay's inline `sendGoverned` to eliminate duplication. |
| `src/tool/webhook/transport.ts` | 77 | `HttpSender` interface + `ReplaySender` class (ProbeRequest → HttpMessage → governedSend → ProbeResponse). Shared DTOs: `ProbeRequest`, `ProbeResponse`. ALL webhook tools inject this — no per-tool sender. |
| `src/tool/webhook/resolve.ts` | 33 | `resolveCapturedRequest(sessionID, requestId)` → ProbeRequest. Shared by authn_test + ssrf_test (and future tools). Scope inherently limited to session's captured hosts. |

### authn_test — BUILT & VERIFIED (32 tests / 86 assertions)

Native JWT attack engine replacing Python `jwt_tamper`. The tool composes: analyse a token → mint forged candidates → send each at the endpoint → report what the server ACCEPTS.

| File | Lines | What it does |
|------|-------|-------------|
| `src/tool/webhook/authn/jwt.ts` | 223 | `Jwt` namespace: decode/tryDecode, encodeNone (4 case variants: none/None/NONE/nOnE), signHS256 (HMAC-SHA256), verifyHS256 (constant-time via timingSafeEqual), crackHS256 (17-entry weak-secret wordlist), forgeAlgNone, rs256ToHS256 (algorithm confusion with public key as HMAC secret), tamper, analyze (structural weakness report), escalationCandidates (alg:none + role/id swaps). Verified against jwt.io reference token. |
| `src/tool/webhook/authn/probe.ts` | 130 | `TokenAcceptanceProbe` — sends forged tokens via injected `HttpSender`. Negative control: no-token request first; if endpoint answers 2xx unauthenticated (public route), no forgery counted as "accepted" (false-positive guard). `isSuccess` = 2xx only (3xx redirect = rejection, not acceptance). |
| `src/tool/webhook/authn/authn-test.ts` | 125 | `AuthnTest.run` orchestrator: analyze → crack → mint candidates (alg:none + role/id + optional RS256→HS256 + optional weak-secret-resign) → probe acceptance. `extractBearer()` for case-insensitive Bearer/bare-JWT extraction. `AuthnTestTool = Tool.define("authn_test")` — registered in `tool/registry.ts`. |

**Tests:** `test/tool/webhook-jwt.test.ts` (20), `test/tool/webhook-token-probe.test.ts` (7), `test/tool/webhook-authn-test.test.ts` (5) — all pass.

**Edge cases handled:** public-endpoint false-positive guard; 3xx login-redirect rejection; bare JWT (no "Bearer " prefix) extraction; alg:none case variants (JWT parsers case-sensitive); transport error propagation; constant-time signature comparison.

**UNVERIFIED:** live-network round-trip (no target endpoint to test against; `ReplaySender` + `Tool.define.execute` verified only with mock `HttpSender`).

### ssrf_test — BUILT & VERIFIED (24 tests / 143 assertions)

Native SSRF testing for query-parameter vectors. Fires internal targets at a URL-bearing parameter, classifies each response with an oracle, and flags targets showing internal-resource evidence the benign baseline did not.

| File | Lines | What it does |
|------|-------|-------------|
| `src/tool/webhook/ssrf/payloads.ts` | 137 | `SsrfPayloads` — 6 categories (~28 targets): localhost (5), cloud_metadata (7: AWS/GCP/Azure/DO/Oracle/Alibaba with required headers), internal_range (4), ip_bypass (6: decimal/hex/octal/IPv6-mapped), protocol (5: file/gopher/dict/ftp), dns_bypass (4: nip.io/@-confusion). `SsrfPayloads.select({categories, providers, limit})` for tech-aware filtering. |
| `src/tool/webhook/ssrf/oracle.ts` | 75 | `SsrfOracle.assess(body)` → `SsrfFinding`. Cloud metadata: per-provider AND-combined markers (AccessKeyId+SecretAccessKey for AWS; access_token+Bearer for GCP; vmId+subscriptionId for Azure). Internal service banners (redis/ssh/memcached/elasticsearch). File read (/etc/passwd, win.ini). False-positive guards: single token in prose NOT flagged. |
| `src/tool/webhook/ssrf/probe.ts` | 108 | `SsrfProbe.run()` — `detectUrlParams` auto-detects sink params (url/redirect/callback/webhook/…). Baseline comparison: only flags targets showing internal evidence the benign baseline did NOT. Per-target error capture (no throw). Informational required-header surfacing for metadata targets. |
| `src/tool/webhook/ssrf/ssrf-test.ts` | 80 | `SsrfTest.run` orchestrator: auto-detect sink param → select targets → probe. `SsrfTestTool = Tool.define("ssrf_test")` — registered in `tool/registry.ts`. |

**Tests:** `test/tool/webhook-ssrf.test.ts` (16), `test/tool/webhook-ssrf-probe.test.ts` (8) — all pass.

**Edge cases handled:** baseline-diff guard (always-noisy server → no false hit); transport error per-target (no throw); metadata required-header informational; no-URL-param error; explicit param + provider filtering; double-encoding note for protocol-smuggling payloads.

**UNVERIFIED:** live-network round-trip (same as authn_test); blind/OOB SSRF (response-content oracle only; needs ssrf_listener callback domain — out of scope); body/header SSRF vectors (query-param focus).

### Dedup refactor (proactive, not deferred)

`resolveCapturedRequest` was extracted from authn_test's inline implementation to `webhook/resolve.ts` BEFORE ssrf_test duplicated it. Both tools import from the shared location. Future tools (business_test, etc.) reuse it.

### business_test — BUILT & VERIFIED (53 tests / 238 assertions)

Native business-logic testing replacing Python `race_tester`. Three modes:

| File | Lines | What it does |
|------|-------|-------------|
| `src/tool/webhook/business/race.ts` | 112 | `RaceEngine` — concurrent sends via `Batch.run` (replay/batch.ts), timing measurement, TOCTOU indicator analysis: mixed-status, multiple-success, varying-body-length, partial-error signals. |
| `src/tool/webhook/business/boundary.ts` | 89 | `BoundaryValues` — 5 field classes (integer/price/quantity/string/id), ~45 values, `forField()` auto-detect by field name regex, `select()` with category+limit filter. |
| `src/tool/webhook/business/workflow.ts` | 96 | `WorkflowSkip.generate()` — 5 strategies (skip_to_end, skip_one, skip_middle, repeat_step, reverse_order) from ordered step sequences. |
| `src/tool/webhook/business/probe.ts` | 94 | `BusinessProbe` — `race()` + `boundary()` orchestrator with `injectFn` pattern and baseline-diff anomaly detection. |
| `src/tool/webhook/business/business-test.ts` | 153 | `BusinessTest.run` 3-mode dispatcher + `BusinessTestTool = Tool.define("business_test")` — registered in `tool/registry.ts`. |

**Tests:** 4 files — race (7), boundary (29), workflow (10), probe (7) — all pass.

**UNVERIFIED:** live-network round-trip (mock HttpSender only); boundary body-length threshold (50 char) may miss subtle response differences.

### misconfig_test — BUILT & VERIFIED (22 tests / 286 assertions)

Active misconfiguration probing that generates the traffic the P0 signal fabric classifies. Three modes:

| File | Lines | What it does |
|------|-------|-------------|
| `src/tool/webhook/misconfig/wordlists.ts` | 106 | Backup suffixes (~15), named backup patterns (~12), admin paths (~26), sensitive files (~34), HTTP methods (~12). `Wordlists.select()` with category+limit filter. |
| `src/tool/webhook/misconfig/probe.ts` | 153 | `MisconfigProbe` — `paths()` (GET wordlist paths, flag 200/403 vs 404 baseline), `methods()` (unusual HTTP methods, flag allowed), `cors()` (Origin reflection + credentials test). Backup suffixes require basePath — skipped if none given. |
| `src/tool/webhook/misconfig/misconfig-test.ts` | 133 | `MisconfigTest.run` 3-mode dispatcher + `MisconfigTestTool = Tool.define("misconfig_test")` — registered in `tool/registry.ts`. |

**Tests:** 2 files — wordlists (11), probe (11) — all pass.

**UNVERIFIED:** live-network round-trip; CORS null-origin handling varies by browser/server.

### What's still NOT done in P1

| Item | Status | Depends on |
|------|--------|-----------|
| Tool registry wiring (`tool/registry.ts`) | **Done** | `AuthnTestTool`, `SsrfTestTool`, `BusinessTestTool`, `MisconfigTestTool` registered in `all()` array |
| Agent permission wiring (`agent/agent.ts`) | **Done (4/4)** | `authnAgentPermission` → proxy-tester-authn, `ssrfAgentPermission` → proxy-tester-ssrf, `businessLogicPermission` → proxy-tester-business-logic, `misconfigAgentPermission` → proxy-tester-misconfig |
| WSTG-aligned specialist agent prompts | **Done (4/4)** | authn, ssrf, business-logic prompts updated with smart tool usage; new proxy-tester-misconfig agent created with prompt + description + agent.ts wiring (WSTG CONF-01..11 + CRYP-01) |
| Orchestrator consuming the fabric | **Done** | Orchestrator prompt reads pending signals + retest_queue from session context; routes new_signal retests via specialist_class → agent-name mapping table; handles architecture-driven retests separately; priority ordering: new_signal > arch > new requests |
| `inject_probe` → canary registration | **Done** (R3, `e7dd40ed07`) | Every nonce registered via `CanaryRegistry` + `DbCanaryStore`; cross-response stored-XSS detection active |
| `inject_probe` → signal write-back | **Done** (R4, `6e062e66c4`) | Every probe response flows through `scanProbeResponse()` → 13 passive detectors; triggered SQL errors, path disclosures, server banners auto-surfaced to orchestrator |
| `inject_probe` → HPP + adaptive back-off | **Done** (R5, `988e1d611f`) | HPP parser-behavior detection (first-wins/last-wins/both); adaptive `BackoffState` (500ms→skip-point→2000ms) preserves send budget on WAF-protected targets |
| `inject_probe` → unit test coverage | **Done** (R6, `3651f4b82f`) | 268 inject-probe tests (7 new + 13 modernized files), mock `HttpSender`; combined 448 tests 0 failures |
| `recon_test` smart tool + `proxy-tester-recon` agent | **Done** (`195a29a280`) | 3-mode tool (metafiles/fingerprint/leakage), agent wired with WSTG INFO-02/03/05/08, 26 unit tests |
| Python `attack_script` retirement | Blocked on live verification | jwt_tamper, ssrf_listener, race_tester — native TS tools built (authn_test, ssrf_test, business_test), but need live-network verification before retiring Python |

### P3-A — WSTG Coverage Map Assertion — DONE (2026-09-05)

Machine-readable coverage map (`src/session/web/wstg-coverage.ts`) mapping all 97 WSTG v4.2 tests to owner agent, coverage status, and mechanism. This is §11 gate 7.

| File | What it does |
|------|-------------|
| `src/session/web/wstg-coverage.ts` | `WSTG_COVERAGE` array (97 entries), `WSTG_CATEGORIES` (12 categories), `TOTAL_WSTG_TESTS` constant. Each entry: `id`, `title`, `agent`, `status` (covered/passive/partial/deferred), `mechanism`. |
| `test/session/web/wstg-coverage.test.ts` | 27 tests / 876 assertions. Completeness (97 entries, no gaps, no duplicates), ordering, agent cross-reference vs WebProvider, coverage statistics, load distribution. |

**Coverage breakdown:** 72 covered, 15 passive, 2 partial, 8 deferred (P2 browser-dependent CLNT tests). `proxy-tester-llm` is a CyberStrike extension — not in WSTG v4.2, correctly excluded from the map.
