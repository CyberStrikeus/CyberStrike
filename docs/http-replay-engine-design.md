# HTTP Replay Engine — Design

Status: **Draft / planning** · Branch: `feature/http-replay-engine` · Tracking issue: #83

A first-class, agent-callable HTTP replay/tamper engine that replaces the
`curl`-in-`bash` confirm/weaponize path used by the proxy vuln-testers. The
payload travels as **data**, never as part of a shell command line.

---

## 1. Motivation

The proxy vuln-testers (`proxy-tester-injection` and siblings) confirm and
weaponize findings by constructing `curl` command strings in `bash`. This is
fragile:

- **Two-layer escaping.** A payload passes through the shell *and* the target
  parser. Quotes, backticks, `$`, newlines routinely break the request — or get
  interpreted locally (a `` `...` `` payload executes on the tester's own host and
  never reaches the target).
- **State handling.** Cookies / CSRF tokens / auth refresh are re-pasted per
  request; a dropped header silently invalidates the test.
- **Concurrency.** Race / single-packet tests are hard to time with one-liners.

Net effect: **false positives** (a broken request read as "safe") and **missed
findings** (the payload never landed intact). `inject_probe` already proves the
correct pattern — it sends via a real HTTP engine (`fetch`), never a shell — but
only for its fixed enumeration batteries; the agent's confirm step still falls
back to `curl`.

---

## 2. Core design principle — the "never struggles" guarantee

> Every request is fundamentally **raw bytes**. A structured convenience layer
> sits on top and round-trips **losslessly** to bytes. If the structured layer
> cannot express something, the agent drops to the **raw-byte backend** and can
> send *any* byte sequence.

There is therefore **no HTTP message the engine cannot represent**. The
structured layer is ~95% ergonomics; the raw-byte layer is the 5% "nothing is
impossible" escape hatch. Every capability below is built on this two-level
model.

Two sending backends realize it:

- **`undici`** (HTTP/1.1 + HTTP/2) — normal requests: auto-encode, connection
  pool, fast. Covers the large majority of targets.
- **Raw TCP/TLS socket** (`net` / `tls`) — byte-exact replay for request
  smuggling / desync and intentionally-malformed requests, which `undici`
  normalizes and thus cannot send.

Mirrors Caido's `RequestSpec` (structured) / `RequestSpecRaw` (bytes) split. We
do **not** embed Caido (its SDK runs inside Caido; it cannot be imported as a
library and would break clean `npm install`); we copy the design with `undici`.

---

## 3. Capability catalog

Tiers: **P0** = core (MVP) · **P1** = power · **P2** = edge-case · **EXT** =
optional external-tool bridge.

### 3.1 Request sourcing & modeling
- From captured request (`request_id`), raw bytes, or from scratch (builder). **P0**
- Clone + override (base + changes). **P0**
- Variable / placeholder templating (`§marker§`, `{{var}}`). **P1**
- Import HAR / Burp XML / Caido export. **P2**
- Lossless byte↔struct round-trip (core guarantee). **P0**

### 3.2 URL / target
- Scheme, host, port. **P0**
- Path: segments, matrix params (`;`), **normalization OFF** (`..`, `%2e`, `//`
  sent verbatim). **P0**
- Query: **ordered multimap** — duplicate keys, empty keys, valueless keys,
  key-without-`=`; per-param encoding. **P0**
- **Connect-to override**: resolve host to arbitrary IP, decouple `Host` header →
  host-header attacks, SSRF, vhost fuzzing, DNS-rebind sim. **P1**
- IDN / punycode, `user:pass@` userinfo. **P2**

### 3.3 Headers
- Ordered list, **duplicates**, arbitrary order. **P0**
- **Case preservation** (`content-length` vs `Content-Length`). **P0**
- Add / remove / replace / rename. **P0**
- Auto-header control (Host, Content-Length, Accept-Encoding, UA, Connection —
  each suppressible / overridable). **P0**
- Whitespace / obs-fold, tab-vs-space, trailing space (smuggling). **P2** (raw)
- CRLF injection in header value (header/response splitting). **P2** (raw)
- Conflicting CL+TE, Expect: 100-continue, Range. **P2** (raw)

### 3.4 Body / payload
- Raw bytes (verbatim). **P0**
- Form url-encoded (ordered, duplicate, encoding control). **P0**
- **Multipart**: multiple parts, per-part name/filename/content-type/headers,
  **boundary control** (custom/malformed/duplicate), part ordering, oversized
  filename, MIME spoof. **P0**
- **JSON**: JSON-path deep set/delete/**type-change** (string→array), inject
  extra keys (mass-assignment), key ordering, duplicate keys, malformed JSON,
  `__proto__` (prototype pollution). **P0**
- **XML**: element/attr, **XXE** (DTD, external + parameter entity), CDATA,
  billion-laughs (bounded). **P1**
- **GraphQL**: query/mutation, variables, operationName, **batching**,
  introspection, aliases, bounded deep nesting, directives. **P1**
- Compressed body send (gzip/br/zstd), **manual chunked** (chunk-size lies). **P2**
- protobuf / gRPC frames. **P1** (EXT for gRPC transport)

### 3.5 Encoding / transform toolkit (per injection-point, **chainable**)
URL-encode (standard / all-chars / **double** / triple) · Unicode (`\u`, overlong
UTF-8, homoglyph) · HTML entities (named/dec/hex) · Base64 / base64url · Hex ·
case-toggle · null-byte / control · **pipeline** (e.g. base64→url-encode). Lets
the agent compose WAF-bypass encodings deterministically. **P0** base set / **P1**
exotics.

### 3.6 Transport & TLS
- HTTP version pin (1.0 / 1.1 / 2), downgrade tests. **P0**
- TLS: min/max version, ciphers, curves, **ALPN**, **SNI** (override/empty/
  mismatch), resumption on/off. **P1**
- **mTLS** (client cert: pem / pkcs12), verify off, custom CA. **P1**
- Connection: keep-alive vs close, **fresh vs reused**, pipelining, h2 settings,
  0-RTT. **P1**
- Proxy: HTTP CONNECT / SOCKS4/5, per-request, chained. **P1**
- **Separate timeouts**: connect / TLS / TTFB / total / idle. **P0**
- DNS: custom resolver, resolve-to-IP, IPv4/IPv6 preference, direct-IP. **P1**

### 3.7 Redirects & response following
Follow / don't / N / same-origin-only · **capture full redirect chain** (each
hop's request+response) · method-change control on 301/302/303 · cookie
accumulation across hops · **cross-origin auth-leak** test. **P1**

### 3.8 State & session management
- Cookie jar (per-session / per-credential, **isolated**). **P0**
- Auth injection from `WebCredential`. **P0**
- **Token lifecycle**: extract from response (regex / JSON-path / header) → store
  as variable → inject into later requests → **auto-refresh macro** on 401. **P1**
- **CSRF auto-handle**: extract token (HTML form / header / cookie), resubmit. **P1**
- Session isolation: fresh vs shared (contamination control). **P1**
- **Multi-identity**: same request as credential A vs B (IDOR/authz core). **P0**

### 3.9 Multi-request orchestration
- **Intruder modes**: sniper / battering-ram / pitchfork / cluster-bomb. **P1**
- Payload sources: wordlist / generated (numbers/dates/charset) / file / **from
  previous response** (recursive grep). **P1**
- Concurrency + rate-limit (req/s) + jitter/delay. **P0**
- **Race / single-packet**: h2 single-frame, h1 last-byte-sync, N concurrent,
  barrier/gate. **P1**
- **Sequences (macros)**: ordered multi-step + variable passing + conditional
  step + loop-until. **P1**
- **Battery diff/clustering**: cluster responses by (status/length/word/time/
  similarity-hash) to surface anomalies. **P1**
- Per-response grep-match / grep-extract (define what counts as a hit). **P1**

### 3.10 Response capture & analysis
Raw response bytes (undecoded) · decoded body (gunzip/brotli/zstd) · parsed
(status, ordered headers, set-cookie, content-type/charset, **declared vs actual
length**) · **timing** (DNS/connect/TLS/TTFB/total) · redirect chain · TLS info
(cert chain, cipher, JA3S) · **structured observations** (marker reflection +
encoded?, error signatures, baseline diff, boolean/time deltas) · **binary-safe**
· size cap + streaming truncation. **P0** core / **P1** JA3S+clustering.

### 3.11 Reliability, safety, guardrails — **P0**
- **Scope check** before every send (hard deny out-of-scope; reuse existing
  matcher).
- **Destructive-payload guard** at engine level (same philosophy as the existing
  bash deny-list).
- **Idempotency guard**: never auto-retry state-changing methods
  (POST/PUT/PATCH/DELETE) unless explicitly flagged safe.
- **DoS guardrails**: global session budget, per-host concurrency cap, backoff on
  429/503 (honor `Retry-After`), **circuit breaker** on N consecutive failures.
- **Timeout = data**: always return elapsed ms; timeout threshold > max intended
  `SLEEP` so time-based injection is never masked as a failure.
- **Structured error taxonomy**: `dns | conn_refused | tls | timeout | reset |
  http_error | rate_limited`.
- Hard per-request `AbortController`; cooperative battery cancellation.
- Memory bounds (response cap, streaming, battery result cap).
- **Determinism**: same input → same request bytes (reproducibility).
- **Audit log**: every request the engine sent (report + accountability).

### 3.12 Evidence & reporting — **P0**
Per-send reproducible record: exact request bytes + response + timing +
**curl-equivalent & raw-HTTP export** · attach to the vulnerability record (link
a finding to the exact request that proved it) · **replay-a-finding** (re-send a
stored finding's request to re-verify).

### 3.13 Protocol breadth beyond request/response
**WebSocket** (connect, send/recv frames, message fuzz, origin/auth) — **P1**
(Bun native) · **SSE** (stream) — **P1** · **gRPC** (unary + streaming) — **P1** /
**EXT** transport · **HTTP/3** — **EXT** · **JA3 mimicry** — **EXT**.

### 3.14 Tool surface (what the agent is offered)
`http_replay` (structured) · `http_replay_raw` (bytes) · `http_replay_batch`
(battery) · `http_replay_sequence` (macro) · `http_replay_ws` (WebSocket).
Import/export: HAR / Burp / Caido / curl. **P0** first three / **P1** rest.

---

## 4. Single choke-point — all attack HTTP funnels through the engine (§15)

**Goal:** guarantee that every tampering / injection / replay request goes
through the engine — as a **requirement, not a prompt-level initiative.**

### 4.1 Scope of the funnel (honest boundary)
Only **target-directed attack traffic** funnels through the engine. CyberStrike's
own control-plane calls (LLM provider, GitHub, cloud SDKs, websearch) are **out
of scope** — they are infrastructure, not attack traffic.

Current attack-traffic egress surfaces to be routed:
- `bash` → `curl` / `wget` (testers' main path)
- `webfetch` tool
- `inject_probe` (already `fetch`-based)
- `attack_script` (python/shell scripts issuing their own HTTP)
- `llmhook` (LLM scanner)

### 4.2 Enforcement — two structural layers (not prompt)
1. **Permission layer (primary).** For `proxy-tester-*` agents, deny HTTP-egress
   commands inside `bash` (`curl`, `wget`, `httpie`, `nc … http`, `python -c
   …requests…`) via deny-patterns, and deny `webfetch` — leaving only
   `http_replay*`. Same mechanism already used to block destructive SQL in bash.
   `bash` is **not** fully disabled — only HTTP egress; jq / encoding /
   `attack_script` keep working.
2. **Hook layer (secondary net).** A `permission.ask` trigger catches a smuggled
   egress (e.g. a `curl` hidden in a subshell) → reject + "use http_replay" +
   **audit log**. Closes the gap the deny-patterns miss.

Result: every attack request provably passes through the engine; none escapes
unmonitored.

---

## 5. Governed concurrency & backpressure (§16)

Today requests are serial (IngestQueue serial; testers sequential). We want
concurrency **without overwhelming any of three things**: (a) the target server,
(b) the AI model, (c) CyberStrike / the proxy agents themselves. Concurrency is
governed at **two independent layers**:

| Layer | Protects | Mechanism |
|---|---|---|
| **HTTP layer** (in-engine) | Target server | **AIMD adaptive rate-limit** (slow-start; ramp up until 429/503/latency spike, then multiplicative back-off) + **per-host token bucket** + honor `Retry-After` + **circuit breaker** + **global session budget** |
| **Agent/LLM layer** (orchestration) | AI model + CyberStrike | **Bounded concurrency pool** (how many testers / ingest items run at once) + provider rate-limit awareness + **backpressure** (throttle new dispatch when the LLM slows) |

**Key distinction:** a *target* rate-limit (→ throttle HTTP) and a *model*
rate-limit (→ throttle agent spawning) are **different signals with different
responses**; conflating them either hammers the server or stalls the model.

**Failover / gap scenarios:**
- **Overwhelming the server** → AIMD + per-host cap + circuit breaker auto-back
  off; never exceed observed capacity.
- **Overwhelming the model** → agent-pool cap + provider-429 backoff; the LLM
  queue never balloons.
- **Slowing CyberStrike** → backpressure + global budget; concurrency never
  starves the main loop. New work is admitted as the pool drains.
- **Partial failure** → a host's circuit breaker pauses only that host; others
  continue (one failure never stalls the whole run).

Adaptivity is required: a fixed "N concurrent" guess is either too slow or too
aggressive. AIMD **auto-tunes to the target's real capacity** — gentle on small
targets, fast on large ones.

---

## 6. Phased build (design everything, build in layers)

- **Phase 1 (P0):** §3.1–3.5 core mutation + both backends + §3.10 response/diff
  + §3.11 reliability + §3.12 evidence + `http_replay` / `http_replay_raw`.
  → migrates `proxy-tester-injection` off `curl`.
- **Phase 2 (P1):** §3.9 orchestration (race/sequence/battery) + §3.6 TLS/
  transport + §3.8 token/CSRF + §3.13 WebSocket + Intruder modes + §5 governed
  concurrency wired into the ingest pipeline.
- **Phase 3 (P2/EXT):** smuggling details + §3.14 import/export + h3/JA3 bridge.

Every phase is **additive and feature-flagged**. No tester moves off `curl` until
Phase 1 is complete; `curl` stays as fallback throughout. Default behavior is
unchanged while the flag is off.

---

## 7. Progress

### Done — engine core (`src/replay/`, dependency-free, unit-tested)
- [x] `message.ts` — lossless byte↔struct HTTP request model
- [x] `mutate.ts` — field-level mutation (query / headers / body)
- [x] `encode.ts` — composable WAF-bypass encoding toolkit
- [x] `errors.ts` — error taxonomy + retry/idempotency policy (Node + Bun codes)
- [x] `governor.ts` — CircuitBreaker / AimdLimiter / TokenBucket / GlobalBudget
- [x] `response.ts` — response parser + unified Result shape
- [x] `backend-fetch.ts` — backend A (structured send via fetch)
- [x] `backend-socket.ts` — backend B (byte-exact send via raw TCP/TLS)
- [x] `observe.ts` — reflection / error-signature / baseline diff
- [x] `send.ts` — governed send (retry + idempotency + circuit/budget)
- [x] `batch.ts` — bounded-concurrency runner (fixed or AIMD-adaptive)

Each module ships with a `test/replay/*.test.ts` suite; both backends are
verified end-to-end against local servers (backend B proven byte-exact).

### Remaining — CS integration (needs the installed workspace)
- [ ] Tool surface: `http_replay` / `http_replay_raw` (`Tool.define`, wired into
      `Request` / scope matcher / `WebCredential`), modeled on `tool/inject-probe.ts`
- [ ] §4 funnel enforcement: deny curl/wget/webfetch for `proxy-tester-*` +
      `permission.ask` hook net
- [ ] Migrate `proxy-tester-injection` behind a feature flag (curl fallback intact)
- [ ] Optional external-tool bridge for HTTP/3 / JA3 (Phase 3)

## 8. Non-goals
- Non-HTTP protocols (SMTP/FTP/…): out of scope — this is a web-pentest engine.
- Embedding Caido/Burp: rejected (see §2). Optional import/export only.
- HTTP/3 and JA3 mimicry in core: out (native dependency vs clean `npm install`);
  handled by an optional external-tool bridge (detect an installed h3-capable
  `curl` / `curl-impersonate`; clean "install X" message when absent — mirrors
  how hackbrowser optionally uses Chromium).
