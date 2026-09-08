# Vortex — Architecture & Roadmap

Vortex is CyberStrike's **HTTP traffic engine**: one place every request/response the platform
sees or sends is stored, queried, and turned into security signals — deterministically, without
depending on an agent to happen to look. It is the ownable, embeddable equivalent of the
Caido/Burp "repeater + intruder + sitemap + query" core, headless and library-shaped, **not** a GUI
proxy product and **not** an embedding of any third-party engine.

Package: `@cyberstrike-io/vortex` · Runtime: TypeScript / Bun · License: AGPL-3.0-only · Status:
in development on branch `vortex`. Everything is OSS for now.

- [1. Why Vortex exists](#1-why-vortex-exists)
- [2. The hub model](#2-the-hub-model)
- [3. Ingestion adapters](#3-ingestion-adapters)
- [4. How each source uses Vortex (web / cloud / mobile / anything)](#4-how-each-source-uses-vortex)
- [5. The consumer boundary (generic core vs domain plugins)](#5-the-consumer-boundary)
- [6. Core components](#6-core-components)
- [7. Data model — the Transaction](#7-data-model--the-transaction)
- [8. HTTPQL-lite](#8-httpql-lite)
- [9. Rules & signals](#9-rules--signals)
- [10. The active engine (send) and the proxy](#10-the-active-engine-send-and-the-proxy)
- [11. SDK / plugin surface](#11-sdk--plugin-surface)
- [12. Roadmap (areas A–J), status & sequence](#12-roadmap)
- [13. Non-goals / deferred](#13-non-goals--deferred)

---

## 1. Why Vortex exists

The agent-driven pipeline left the **basics** to agent initiative: whole assessments ran without
catching header/cookie misconfigurations because the passive layer couldn't see full headers and
the specialist agent only inspected the one endpoint it happened to replay. The fix is a
**deterministic detection substrate**:

- **Broad, cheap, complete** coverage is done by deterministic rules over the *whole* corpus of
  traffic — missing headers, weak cookies, banners, error signatures, cross-identity access
  surface, injection candidates.
- **Agents** are demoted to *verifiers/exploiters* of pre-surfaced candidates, not discoverers.

Vortex is that substrate: a unified store + a rule/query layer + an active send engine + a proxy,
all fed by many sources through one uniform model.

---

## 2. The hub model

Vortex is a **hub**. Sources never talk to rules or the store directly; they go through an
**ingestion adapter** that produces the one uniform unit — a `Transaction` — which lands in the
store. The rule/query layer runs over the store. Signals flow out to a host consumer.

```
        SOURCES                     INGESTION ADAPTERS                 VORTEX CORE                    OUT
  ────────────────────       ───────────────────────────      ──────────────────────────      ──────────────
  browser              ──▶  browser  (hackbrowser extension) ─┐
  mobile app / any     ──▶  proxy    (MITM / forward)         ─┤
    non-browser client                                         │
  our own code (cloud) ──▶  sdk-ingest (report a fetch)       ─┼──▶  store  +  rules / HTTPQL  ──▶  signals ──▶ host
  a request we make    ──▶  send-through (Vortex sends it)    ─┤            +  send  +  proxy         (retest /
  offline capture      ──▶  har-import (HAR file)             ─┘                                       agents)
```

**One `Transaction` shape, one store, one rule layer.** The only thing that differs between web,
cloud, and mobile is *which adapter* fed the traffic in. Everything downstream is identical.

---

## 3. Ingestion adapters

An adapter's whole job is: take some source of HTTP and emit `Transaction`s into a `TrafficStore`.
Five adapters cover every case:

| Adapter | What it does | Feeds |
|---|---|---|
| **browser** | The hackbrowser extension observes the page + captures fetch/XHR/webRequest and posts them. DOM-aware, richest context. | web apps |
| **proxy** | Vortex runs a listening HTTP(S) forward/MITM proxy. Any client configured to use it (device proxy + CA cert) has all its traffic captured and forwarded. | mobile apps, non-browser clients, thick clients, any HTTP tool |
| **sdk-ingest** | Code that already made an HTTP call reports the request+response: `store.add(toTransaction(req, res))`. No proxy, no interception. | our own code — cloud SDK modules |
| **send-through** | Instead of calling `fetch` and reporting, the caller asks Vortex to make the call: `vortex.send(request)` → Vortex sends, observes, stores, runs rules, returns the response. | replay/repeater, cloud modules that opt in |
| **har-import** | Load an offline HAR (browser export, Burp/Caido export) into the store. | bringing in external/recorded traffic |

Adapters are thin and pluggable. The core does not know or care which one produced a transaction —
`Transaction.source` records the provenance (`browser | proxy | cloud | import`) only so rules and
queries can scope if they want to.

---

## 4. How each source uses Vortex

The recurring confusion — "how will cloud / mobile use this?" — resolves entirely to *which
adapter*:

### Web (browser)
The `browser` adapter. The hackbrowser extension already posts observations + captured requests;
those become `Transaction`s. Richest, because it also carries DOM/observation context. Unchanged
from what exists today; wiring it to the Vortex store is the final integration step.

### Cloud (AWS / Azure / GCP / Oracle)
**Not** the proxy — the traffic is made by *our own code*, so there's nothing to intercept. Two
clean options:
- **sdk-ingest**: the `azure` package already does `fetch("https://management.azure.com/…")`,
  `fetch(IMDS)`, Graph/OAuth calls. It reports each request+response to Vortex →
  `store.add(toTransaction(...))`.
- **send-through**: the module calls `vortex.send(request)` instead of raw `fetch`. Vortex sends,
  captures, runs rules, returns the response — automatic capture in one line.

Either way the cloud API traffic lands in the same store and the same rules run over it. Cloud is a
**consumer** (see §5): it feeds a source in and registers cloud-specific rules; it does not modify
the core.

### Mobile (and any non-browser client)
**The proxy adapter — this is the whole reason the proxy step exists.** You cannot inject a browser
extension into a mobile app. You *can* point the device's proxy setting at Vortex's proxy and
install its CA certificate; then every HTTP(S) request the app makes flows through Vortex, is
captured, and is forwarded to its destination. Same store, same rules. The same path serves any
non-browser HTTP client (a CLI, a thick client, another tool respecting `HTTP_PROXY`).

### Offline / recorded traffic
`har-import` — bring a HAR file (from a browser, Burp, or Caido) into the store and run rules over
it after the fact.

---

## 5. The consumer boundary

**Vortex core is generic.** It understands HTTP and nothing else — no Azure, no web app specifics.
Its public surface is: the store, the rule engine, HTTPQL, the send engine, the proxy, and the
plugin interface.

A **consumer** is a package that (1) feeds a source in via an adapter, and (2) registers its
own domain-specific rules through Vortex's plugin/rule interface. Domain rules live in the
consumer, never in the core.

```
  vortex (core, generic)                consumers (feed a source + register rules)
  ─────────────────────                 ───────────────────────────────────────────
  store / rules / HTTPQL                azure    → sdk-ingest/send-through + cloud rules (IMDS,
  send / proxy / plugin API                        management-API, Graph consent, …)
                                        cyberstrike/web → browser adapter + web rules
                                        (future) mobile → proxy adapter + mobile rules
```

This is the same split Caido uses (a generic engine + a plugin surface others extend), and it keeps
the core small, testable, and reusable while every domain's knowledge stays in its own package.

---

## 6. Core components

| Component | File | Status |
|---|---|---|
| `Transaction` model + header/param helpers | `transaction.ts` | ✅ |
| Endpoint normalization (`normalizePath`, `endpointKey`) | `endpoint.ts` | ✅ |
| Query/body param extraction (`params`) | `params.ts` | ✅ |
| Response-type scope helpers | `scope.ts` | ✅ |
| Corpus grouping (`groupByEndpoint`, `identities`) | `corpus.ts` | ✅ |
| `TrafficStore` interface + `MemoryStore` | `store.ts` | ✅ |
| Durable session-scoped `SqliteStore` | `sqlite-store.ts` | ✅ |
| `Rule` / `CorpusRule` / `Signal` / dedup / `RuleRegistry` | `rule.ts` | ✅ |
| Signal store (persisted "flags" in the store) + `scan()` (rules→stored signals over observed) | `store.ts` / `scan.ts` | ✅ |
| Canary correlation (mint + `{canary}` in send + same-request reflect + stored-reflection scan) | `canary.ts` | ✅ |
| Baseline rules (header hygiene) | `rules/headers.ts` | ✅ |
| Baseline corpus rules (access-control surface) | `rules/access.ts` | ✅ |
| HTTPQL-lite (parser + evaluator + resolver) | `httpql.ts` | ✅ |
| Send engine (mutate + send + observe) | `send/*` | ⏳ (roadmap E) |
| Proxy (MITM/forward) | `proxy/*` | ⏳ (roadmap J) |
| SDK / plugin interface | `plugin.ts` | ⏳ (roadmap F) |

---

## 7. Data model — the Transaction

The single uniform unit. Everything above the adapters works on this shape.

```ts
type Source = "browser" | "proxy" | "cloud" | "replay" | "import"
type Severity = "info" | "low" | "medium" | "high" | "critical"

interface Header { name: string; value: string }               // ordered list; duplicates kept (Set-Cookie)
interface Request  { method: string; url: string; headers: Header[]; body?: string }
interface Response { status: number; headers: Header[]; body?: string; bodyLength?: number }

interface Transaction {
  id: string
  session?: string        // the assessment this belongs to; stores may be scoped to one
  source: Source          // which adapter produced it
  host: string
  identity?: string        // credential/role label — the axis cross-identity analysis compares on
  derivedFrom?: string     // replay lineage: the transaction this was mutated/replayed from
  request: Request
  response?: Response
  timing?: { startedAt: number; ms?: number }
}
```

Derived (computed, not stored), all deterministic functions of the transaction:
- `endpointKey(tx)` → `METHOD host/normalized/path` — folds request *instances* onto one logical
  *endpoint* (id-like path segments become `{uuid}` / `{id}` / `{hex}`). Every corpus operation
  groups by this.
- `params(tx)` → `{ query, body }` flat name→value maps. JSON bodies are flattened to dot-paths
  (`params.staff_name`), form-urlencoded is parsed. This is what lets a rule/query target the exact
  input a vulnerability lives in.

**Header helpers** are case-insensitive (`header`, `headerAll`, `hasHeader`) because header names
are case-insensitive per RFC and servers are inconsistent.

**Planned model enrichment (roadmap A):** body decompression (gzip/br) + binary as base64 + size
caps/streaming; content-type-aware parsing for multipart (file uploads), XML, GraphQL (operation /
query / variables); structured cookie model (Cookie + Set-Cookie); HTTP version, TLS info, timing
breakdown, redirect chains.

---

## 8. HTTPQL-lite

A small query language over the corpus so you can pull "the requests matching this shape" out of
thousands without writing TypeScript. Two consumers: an agent tool ("query the captured corpus")
and declarative rules (roadmap D). A pragmatic subset of Caido's HTTPQL, not a full grammar.

**Grammar**
```
query := or
or    := and ("OR" and)*
and   := term ("AND" term)*
term  := "(" or ")" | atom
atom  := field op value
```

**Fields**: `req.method`, `req.url`, `req.path`, `req.body`, `req.header.<name>`, `req.query.<name>`,
`req.body.<dotpath>`, `req.cookie.<name>`, `req.graphql.op`, `req.graphql.query`, `req.bodyKind`,
`resp.status`, `resp.body`, `resp.body.<dotpath>`, `resp.contentType`, `resp.bodyKind`,
`resp.header.<name>`, `resp.cookie.<name>`, `host`, `identity`, `source`, `endpoint`, `httpVersion`,
`timeMs`, `tls.version`, `tls.cipher`.

Both request and response bodies are handled uniformly by the **body model** (`body.ts`):
content-type (with a content sniff fallback) classifies the `BodyKind`
(`json`/`graphql`/`form`/`multipart`/`xml`/`html`/`text`/`binary`/`empty`) and extracts a flat
field map for the structured kinds — so `req.body.x` and `resp.body.x` both work, across media
types (XML leaf extraction is best-effort, no external parser).

**Operators**: `:` equals (case-insensitive strings / numeric) · `!=` not-equals · `:~` or `~`
case-insensitive regex · `>` `<` `>=` `<=` numeric.

**Values**: `"double quoted"` (may contain spaces) or bareword.

**Examples**
```
resp.status>=500
resp.status>=500 AND req.method:POST
resp.header.server:~uvicorn OR resp.body:~"SQL syntax"
(resp.status:403 OR resp.status:200) AND identity:org1
req.body.params.staff_name:~"'"
```

API: `compile(q)` → reusable `{ test(tx), filter(txs) }`; `query(txs, q)` convenience; `QueryError`
on bad syntax.

**Planned (roadmap C):** more fields (cookies, timing, body-size, tags, ip); more operators
(contains/starts/ends, in-set, exists/absent, NOT, ranges); saved queries; **SQL pushdown** so a
query runs as an indexed SQL `WHERE` instead of a full scan.

---

## 9. Rules & signals

Two rule shapes, both deterministic:

- **`Rule`** — evaluates ONE transaction. Header hygiene, error signatures, reflection, sensitive
  data. Pure: same input ⇒ same signals, no side effects.
- **`CorpusRule`** — evaluates the WHOLE corpus. Cross-transaction / cross-identity — the pentest
  core ("endpoint reached under A and B", auth-strip diffs, IDOR).

**Signal** — a finding *candidate* pointing at a transaction: `{ ruleId, transactionId, severity,
category, title, evidence?, dedupKey? }`. `dedupKey` collapses the same finding on one logical
endpoint to a single signal instead of firing per instance (kills the "100× server banner" noise).

**`RuleRegistry`** — `register` / `registerCorpus`, then `analyze(txs)` runs per-transaction rules
over every transaction AND corpus rules over the whole set, then dedups. `run(tx)` runs per-tx rules
for a single transaction (streaming use).

**Scope helpers** keep rules meaningful: `isContentResponse` / `isStaticAsset` / `isRedirect` so a
header rule skips a `.js` bundle or a 301 instead of flagging every one.

**Baseline rules shipped (all OSS):**
- `missing-security-headers` — HSTS / CSP / X-Content-Type-Options / X-Frame-Options (or CSP
  frame-ancestors), scoped to content responses, deduped per endpoint+missing-set.
- `weak-cookie-flags` — Set-Cookie lacking HttpOnly / Secure / SameSite, per cookie.
- `server-banner` — Server / X-Powered-By disclosure, deduped per host.
- `cross-identity-access` (corpus) — an endpoint reached 2xx under 2+ identities = BFLA/IDOR review
  surface.
- `unauthenticated-reach` (corpus) — an authenticated endpoint also served anonymously.

**Declarative rules (the LLM-friendly DSL)** — a rule is DATA, not code, so an agent reads/writes
one at a glance and emits it as JSON:
```json
{ "id": "sql-error", "category": "injection", "severity": "high",
  "when": "resp.body:~\"SQL syntax\" OR resp.body:~\"SQLSTATE\"",
  "message": "SQL error signature in {endpoint}", "dedupBy": "endpoint" }
```
`when` is HTTPQL (same field vocabulary as queries); `message`/`evidence` interpolate `{field}`.
`compileRule()` turns one into a normal per-transaction Rule; `parseRules()` validates untrusted
JSON. The built-in signature rules (SQL error / stack trace / leaked secret) are themselves written
in this DSL (dogfooded).

**Still planned (roadmap D):**
- More passive rules: SQL/stack/XXE/SSRF error signatures, reflected-input / XSS candidate,
  sensitive-data-in-response (PII / tokens / keys), open redirect, verbose errors, directory
  listing, mixed content.
- More corpus rules: IDOR (an object id in A's response accessed under B), privilege escalation,
  parameter pollution, missing rate limiting, sequential-id enumeration.
- **Active rules** (need the send engine): auth-strip, method-matrix, error-canary, header-audit
  (server-side — bypasses browser-capture limits entirely), active CORS, cache poisoning, redirect.
- **Signal → finding** promotion: confidence, correlation across transactions, evidence chain,
  severity scoring, triage state. Rule packs with enable/disable + config.

---

## 10. The active engine (send) and the proxy

### Send (roadmap E) — the "make a request and observe it" mechanism
Vortex owns its own send path (it is standalone; it does not depend on the host's replay module):
- **mutate**: set/replace header, query param, body, JSON field, path param, strip auth, inject a
  payload.
- **send**: raw HTTP(S) with redirects, timing, retries; server-side, so it sees the true wire
  response (all headers incl. Set-Cookie) that a browser's fetch cannot.
- **observe**: status, full headers, body, reflection, error signatures.
- **governance / scope / safety**: never send out of scope, respect rate limits, guard destructive
  methods.
- **sweep / intruder**: payload lists, injection positions, batched with bounded concurrency.

A `send-through` transaction is automatically stored (with `derivedFrom` set to its origin) and run
through the rules — so replaying and capturing are the same act.

### Proxy (roadmap J) — the missing ingestion adapter for non-browser sources
A listening HTTP(S) forward/MITM proxy:
- CONNECT tunnelling + **TLS MITM** with a generated CA certificate the client trusts.
- Capture request+response on the wire → store + rules → forward to the real destination.
- Scope/allowlist, optional upstream-proxy chaining, WebSocket passthrough.

This is the heaviest single component (TLS interception in Bun/Node is non-trivial) and it is its
own sub-project. It is sequenced *after* the model (A) and send (E) are solid, because the proxy is
just another adapter feeding the same store — the core must be ready first.

---

## 11. SDK / plugin surface

Vortex is a library first. Its public API (roadmap F) is the stable contract consumers build on:
- **Ingest**: `store.add(tx)`, plus adapter helpers to build a `Transaction` from a fetch/HAR/proxy
  event.
- **Query**: `query(txs, q)` / `compile(q)`.
- **Detect**: `RuleRegistry` + `analyze`, plus a **plugin interface** to register custom rules,
  field resolvers, and mutations — how `azure`/web/community extend detection without touching the
  core.
- **Send**: `vortex.send(request)` (roadmap E).
- **Signals out**: `onSignal(cb)` / a signal stream.

Everything is versioned; the plugin interface is the seam that keeps the core generic.

---

## 12. Roadmap

Areas and sequence. Wiring into cyberstrike is **last** — Vortex is finished as a standalone project
first.

| Area | Scope | Status |
|---|---|---|
| **(done)** | Transaction + normalization + params + lineage; Memory/Sqlite stores; Rule/CorpusRule + dedup + scope; baseline rules; HTTPQL-lite | ✅ |
| **Extraction seam** | ✅ Vortex is ready to receive an EXTRACTOR's output: `Extract {endpoints, jsUrls, tech, secrets}` contract, `Transaction.tech`, a discovery inventory in the store (memory + persisted SQLite, session-scoped), and `ingestExtract()` (tech→tx, endpoints/JS→inventory). The extractor itself (`@cyberstrike-io/jsmine`, pure text→Extract) is built in a SEPARATE branch and just feeds this seam. | ✅ (jsmine separate) |
| **A. Model completeness** | ✅ cookie model; ✅ req+resp body across media types (JSON/form/multipart/XML/HTML/text/graphql); ✅ HTTP version/TLS/timing/redirect-chain fields; ✅ request-shape (template/dup). Remaining: body decode (gzip/br) — belongs to the transport (E). | ✅ (decode → E) |
| **E. Active engine (send)** | ✅ engine ported (mutate/send/observe/governed/backends); ✅ agent-agnostic `send()` bridge (captured replay + fresh build); ✅ ActiveRule abstraction + auth-strip (deterministic probe→diff→signal). Deferred: Intruder attack modes (sniper/battering-ram/pitchfork/cluster-bomb) — small, added later; body gzip/br decode. | ✅ (modes deferred) |
| **D. Detection depth** | declarative (HTTPQL) rules; passive rule set (error signatures, reflection, sensitive data, open redirect, …); corpus rules (IDOR, privesc, param pollution, rate-limit, enumeration); active rules (auth-strip, method-matrix, header-audit, CORS, cache-poison); signal→finding promotion; rule packs | ⏳ |
| **C. HTTPQL completeness** | ✅ exists (`field:*`) + `NOT` (absent/negation) operators; rich field set (cookies, body, graphql, tech, timing, tls). Deferred: SQL pushdown (perf — full-scan is fine at session scale), saved queries. | ✅ (pushdown deferred) |
| **B. Store / scale** | ✅ HAR import (`fromHar`/`parseHar`) + export (`toHar`) — the offline adapter; ✅ agent-safety scope (`isObserved`/`observed`). Deferred: pagination/iteration, retention/eviction. | ✅ (paging deferred) |
| **J. Proxy** | HTTP(S) forward/MITM proxy (TLS CA), scope, WS passthrough — the non-browser/mobile adapter | ⏳ |
| **F. SDK / plugin** | stable versioned API; plugin interface (rules / resolvers / mutations); adapter helpers | ⏳ |
| **G. Consumer contract** | the interface a host uses to route Vortex signals into its own retest/agent flow (defined in Vortex; implemented at wiring) | ⏳ |
| **H. Project completeness** | test corpus/fixtures, benchmarks (thousands of tx), README/examples, CI (turbo typecheck+test), changelog | ⏳ (ongoing) |
| **I. Cloud fit** | keep the core generic; cloud-specific rules live in the `azure`/cloud consumer, registered via the plugin interface | ⏳ |
| **Wiring** | browser ingest + send-through/sdk-ingest (cloud) + proxy (mobile) → Vortex; signals → retest/agents | ⏳ (LAST) |

**Sequence:** A → E → D → C → B → J → F → G → wiring. Rationale: the rich model (A) underpins E/D/C;
send (E) is required by active rules and the proxy; the proxy (J) is an adapter that needs the core
ready; wiring is last so the live pipeline is only touched once Vortex is complete.

---

## 12a. Safety — agent probes must not corrupt the corpus or flow

Agents (and active rules) SEND — they inject payloads and canaries. That must never poison the
store or the passive-detection flow:
- Every engine-sent transaction is `source: "replay"` with a fresh `vx_` id, so it is **appended,
  never overwriting** an observed row.
- Passive rules/queries run over **`observed()`** (everything except `replay`). An agent's own
  injected payload or reflected canary is therefore **not re-ingested and mis-flagged** as the
  app's behavior (no self-inflicted false finding / feedback loop).
- **Canaries** are the province of ACTIVE rules: the rule that sent the canary interprets the
  reflection (via `Observe.reflection`). Passive rules ignore replay, so a canary echo is never a
  passive "reflected input" finding.
- Agents interact by READ (query) + APPEND (send → replay) + authoring rules — not by deleting or
  overwriting observed traffic.

## 13. Non-goals / deferred

- **A GUI proxy product** (Caido/Burp desktop). Vortex is a headless library; the browser adapter is
  the interactive capture surface.
- **Embedding a third-party engine** (e.g. Caido core). Licensing + coupling; we build the capability
  natively and own it.
- **Protocols beyond HTTP(S)** — raw TCP, DNS. The real need behind these is **out-of-band
  callbacks** (SSRF/blind); when needed, integrate an interactsh-style collaborator service rather
  than build a general protocol stack.
- **WebSocket message inspection** — noted; deferred until the HTTP core is complete.
