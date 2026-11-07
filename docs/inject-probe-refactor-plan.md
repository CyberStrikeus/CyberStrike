# inject-probe Refactor Plan — ✅ COMPLETE

**Source:** `src/tool/inject-probe.ts` (1859 lines, 89KB) → `src/tool/inject-probe/` (17 modules)
**Goal:** Transform from an isolated monolith into a modular, fabric-integrated, testable injection engine — without losing a single payload or security insight.
**Status:** ALL PHASES COMPLETE (R0–R6). 7 commits on `web-workflow`. 448 tests pass (268 inject-probe + 180 signal+webhook), 0 failures, `tsc --noEmit` clean.

| Phase | Commit | Date |
|-------|--------|------|
| R0 — Extract modules | `d08466671e` | 2026-09-05 |
| R1 — Governed send | `63cee169db` | 2026-09-05 |
| R2 — Shared probe runner | `908e36cb0f` | 2026-09-05 |
| R3 — Canary registration | `e7dd40ed07` | 2026-09-05 |
| R4 — Signal write-back | `6e062e66c4` | 2026-09-05 |
| R5 — HPP + adaptive back-off | `988e1d611f` | 2026-09-05 |
| R6 — Unit tests | `3651f4b82f` | 2026-09-05 |

---

## Current State (pre-refactor, historical)

A single `Tool.define("inject_probe")` containing everything: payload constants, request mutation, 5 probe functions, multipart surgery, WAF detection, context classification, and the Zod tool definition. Uses raw `fetch()` (bypasses governed send), has zero canary integration, zero signal write-back, zero unit tests.

**What's valuable (KEEP):**
- ~530 lines of payload batteries (XSS tags+weapons, SSTI syntaxes, CMD probes, LFI techniques, error-signature regexes per DBMS)
- XSS context classification + weapon routing (`classifyXssContext`, `xssWeaponFires`)
- WAF/block detection logic
- Baseline jitter measurement for boolean differentials
- Multipart raw-string surgery (6 functions, 170 lines)
- Scope guard (target host must be in session's captured set)
- The tool/agent boundary (evidence engine, not oracle)

**What's broken (FIX):**
- Raw `fetch()` — invariant-2 violation, no circuit breaker, no governed budget, untestable
- Zero canary registration — stored XSS detection blind to inject_probe's markers
- Zero signal write-back — triggered SQL errors invisible to orchestrator
- 5× duplicated probe loop pattern (baseline → fire → check → record)
- 3× near-identical `applyPayload` variants
- No HPP mode (INPV-04 gap)
- Zero test coverage

---

## Phase Structure

Each phase is independently mergeable and testable. Later phases depend on earlier ones.

### R0 — Extract modules (no behavior change) — ✅ DONE (`d08466671e`)

**Goal:** Break the monolith into importable, testable modules. No logic change, no new features.

```
src/tool/inject-probe/
  index.ts            — Tool.define (thin: Zod schema + execute → delegates)
  payloads/
    xss.ts            — XSS_TAGS, XSS_WEAPONS, XSS_WEAPONS_BAREARG, XSS_WEAPONS_ENCODED, XSS_BREAKOUT
    ssti.ts           — SSTI_SYNTAXES, SSTI_EXPR, SSTI_PRODUCT
    cmd.ts            — CMD_PROBES, CMD_SEPARATORS, CMD_SAFE_INDICATORS
    lfi.ts            — LFI_TECHNIQUES, LFI_ABSOLUTE, LFI_TARGETS
    errsig.ts         — ERRSIG (sqli/nosql/ldap/xpath signatures + payloads)
  mutate.ts           — applyPayload, applyLfiTarget, applyOperatorTarget, setJsonField, setJsonValue,
                        setCookie, injectPathSegment (unified: one applyPayload with mode param)
  multipart.ts        — multipartBoundary, mpFieldName, multipartFieldNames, setMultipartField,
                        setMultipartOperator (already self-contained, pure cut-paste)
  resolve.ts          — parseRaw, resolve, resolveFromTarget, ResolvedRequest, InjPoint,
                        enumeratePoints, validatePoints
  detect.ts           — blockSignal, looksBlocked, WAF_BODY, WAF_SERVER, classifyXssContext,
                        xssWeaponFires, excerptOf, excerptAround
  send.ts             — send(), SendResult, SendOk, SendBudget, guardHost, SEND_TIMEOUT_MS
                        (still raw fetch() — replaced in R1)
  probe/
    xss.ts            — probeXssPoint
    ssti.ts           — probeSstiPoint
    cmd.ts            — probeCmdPoint
    lfi.ts            — probeLfiPoint
    errsig.ts         — probeErrorSigPoint
    base.ts           — shared sleep, baseline, budget/abort guard pattern (extracted in R2)
```

**Validation gate:** `bun test` full suite still passes (inject_probe has no tests, so this is a regression check). `tsc --noEmit` clean. Tool's runtime behavior byte-identical (same payloads, same send order, same output shape).

**Effort:** Medium (1-2 sessions). Mechanical cut-paste, but touching 1859 lines means careful import rewiring.

---

### R1 — Replace raw fetch() with injected HttpSender — ✅ DONE (`63cee169db`)

**Goal:** Comply with §05 invariant-2 (all sends via governed transport). Unlock testability.

**Changes:**
1. `send.ts` accepts an `HttpSender` (from `webhook/transport.ts`) instead of calling `fetch()` directly
2. The tool's `execute()` function creates a `ReplaySender` and passes it down to every probe function
3. `guardHost` moves into the sender or stays as a pre-send check (sender doesn't need to know about scope — that's tool-level)
4. `SEND_TIMEOUT_MS`, redirect: "manual", TLS: rejectUnauthorized are configured on the sender

**Interface mapping:**
```typescript
// Current: raw fetch
const resp = await fetch(url, init)
const text = await resp.text()

// After: governed sender
const probe: ProbeRequest = { method, url, headers, body }
const result: ProbeResponse = await sender.send(probe)
// ProbeResponse already has .status, .body, .headers
```

**What changes for callers:** `send()` signature changes from `(r, target, abort, budget)` to `(sender, target, abort, budget)`. Each probe function receives the sender.

**What doesn't change:** Payload content, send order, output shape, tool/agent contract.

**Validation gate:** Same full test suite + manual trace that the governed path fires. Write first unit tests for `send.ts` using a mock `HttpSender`.

**Effort:** Medium. The `send` function is the single choke point — one function to replace, but it threads through all 5 probe functions.

---

### R2 — Extract shared probe runner — ✅ DONE (`908e36cb0f`)

**Goal:** Eliminate the 5× duplication of baseline → fire → check block → match → record.

**Observation:** All 5 probe functions share:
- `const sleep = (ms) => ...` (identical, declared 5 times)
- Baseline send + block check + early return
- For-each payload loop with abort/budget guard
- Block signal accumulation
- WAF/timeout note generation

**Design:**
```typescript
interface ProbeConfig<T> {
  payloads: Iterable<{ value: string; meta?: unknown }>
  applyFn: (r: ResolvedRequest, point: InjPoint, payload: string) => AppliedTarget
  matchFn: (response: SendOk, payload: string, meta: unknown, baseline: SendOk) => T | null
  baselinePayload?: string  // default: nonce()
}

async function runProbe<T>(
  sender: HttpSender,
  r: ResolvedRequest,
  point: InjPoint,
  config: ProbeConfig<T>,
  abort: AbortSignal,
  delayMs: number,
  budget: SendBudget,
): Promise<{ point: string; baseline: BaselineInfo; findings: T[]; blocked: boolean; blockSignal?: string; note?: string }>
```

**XSS is the exception:** It has a 4-phase structure (marker → tags → breakout → weapons) rather than a single payload loop. `probeXssPoint` keeps its own orchestration but uses `runProbe` for each phase internally.

**Effort:** Medium. The abstraction boundary is clear, but XSS's multi-phase structure prevents a naive "one function fits all."

---

### R3 — Canary registration — ✅ DONE (`e7dd40ed07`)

**Goal:** Every marker/nonce inject_probe sends gets registered as a canary. Stored/second-order injection becomes detectable by the signal fabric.

**How it works:**
1. `execute()` receives or creates a `CanaryRegistry` (from `session/web/signal/canary.ts`)
2. After each `send()`, the nonce is registered:
   ```typescript
   registry.register({
     token: nonce,
     kind: cls === "ssti" ? "template" : "reflect",
     originRequestId: params.request_id,
     endpoint: targetInfo.url,
     field: point.name,
     agent: ctx.agentID,
     vulnClass: cls,
   })
   ```
3. For SSTI: register the **evaluated product** (`SSTI_PRODUCT = "5765329"`) with `kind: "template"` — a hit proves execution, not mere reflection
4. For XSS: register each nonce with `kind: "reflect"` — the tag/weapon wrapping is discarded, only the nonce matters for cross-page detection
5. For CMD: register with `kind: "callback"` — command output appearing elsewhere means a stored injection was evaluated

**What this unlocks:**
- The signal fabric's `CanaryRegistry.scan()` runs on every subsequent response (captured or elicited)
- A marker injected via inject_probe at `/comment` that appears in `/admin` triggers `stored_reflection`
- This closes WSTG-INPV-02 (stored XSS) and WSTG-INPV-14 (incubated vulnerability) — both currently "partial"

**Challenge:** inject_probe generates many nonces per invocation (XSS alone: 1 marker + up to 11 tags + 31 weapons = 43 per point). On a 5-point, 3-class invocation, that's potentially hundreds of canaries. The registry must handle this volume without memory bloat.

**Mitigation:** The `MemoryCanaryStore` is a Map keyed by token — O(1) insert, O(n) scan. For a session with ~1000 canaries, scan per response is <1ms. A DB-backed store (`DbCanaryStore`) can index by session_id for cleanup.

**Effort:** Small-Medium. The nonces already exist. Registration is an additional call after each `send`, using data already in scope.

---

### R4 — Signal write-back — ✅ DONE (`6e062e66c4`)

**Goal:** Feed inject_probe's elicited responses through the signal fabric's detectors.

**How it works:**
1. After each `send()` that returns a response, call `scanElicitedResponse()` (from `signal/ingest.ts`)
2. This runs all 13 passive detectors (stack trace, SQL error, server banner, CORS, etc.) on inject_probe's responses
3. Detected signals go to the `SignalStore` and become visible to the orchestrator

**Why this matters:**
- inject_probe's sqli payloads frequently trigger SQL error pages → the `SqlErrorDetector` would catch these
- inject_probe's traversal payloads can trigger `FullPathDisclosureDetector`
- Currently these signals die inside inject_probe's own observation; the orchestrator never sees them

**Sequencing:** This naturally follows R1 (governed send). The `ReplaySender` path already supports write-back in `http_replay.ts` — the same pattern applies.

**Effort:** Small (once R1 is done — the governed send path handles write-back).

---

### R5 — HPP mode + adaptive back-off — ✅ DONE (`988e1d611f`)

**Goal:** Close INPV-04 gap and improve behavior on rate-limited targets.

**HPP (HTTP Parameter Pollution):**
```typescript
// New mode in applyPayload: "append" (vs current "replace")
// query: ?id=1 → ?id=1&id=PAYLOAD  (duplicate param)
// form:  id=1  → id=1&id=PAYLOAD
// Fires existing payloads at the DUPLICATE position
```

Add `"hpp"` to the `vuln_type` enum. The probe sends each injection class's payloads at the duplicate position and reports whether the server processes the first or last occurrence (first-wins vs last-wins → reveals the parser).

**Adaptive back-off:**
- On first `blockSignal`, increase inter-request delay to 500ms
- On 3 consecutive blocks at one point, skip remaining payloads for that point
- On 5 consecutive blocks across any point, increase delay to 2000ms
- Record the back-off decision in the output so the agent knows the tool throttled

**Effort:** Small (HPP is one `applyPayload` mode variant + one new probe function; back-off is a state machine in the probe loop).

---

### R6 — Unit tests — ✅ DONE (`3651f4b82f`)

**Goal:** Regression-proof every module extracted in R0-R5.

**Test plan:**
| Module | Tests | What to assert |
|--------|-------|---------------|
| `payloads/xss.ts` | Each weapon's `sig` regex matches its own `payload` | No false-negative on the weapon's own output |
| `payloads/errsig.ts` | Each signature regex matches a known error string for its DBMS | sqli signatures catch MySQL/Postgres/MSSQL/Oracle/SQLite errors |
| `resolve.ts` | `parseRaw`, `resolve`, `resolveFromTarget` on captured request fixtures | Correct URL, headers, body extraction |
| `mutate.ts` | `applyPayload` for each location (query/form/json/header/cookie/path) | Correct value substitution, encoding |
| `multipart.ts` | `setMultipartField` on fixture multipart bodies | Surgical replacement without corrupting boundaries |
| `detect.ts` | `classifyXssContext` on fixture response bodies | Correct context identification (attribute, JS, html-body, tag-name) |
| `detect.ts` | `blockSignal` on WAF/challenge response fixtures | Correct block detection |
| `probe/xss.ts` | Full probe with mock `HttpSender` | Correct tag survival detection, weapon ordering, context routing |
| `probe/errsig.ts` | Boolean-differential logic with controlled jitter | Correct differential flagging above noise floor |
| `send.ts` | Governed send integration | Budget exhaustion, abort, timeout handling |

**Effort:** Medium-Large (significant test surface, but each module is independently testable after R0).

---

## Dependency Graph

```
R0 (extract modules) ← no dependencies
  ↓
R1 (governed send) ← depends on R0 (send.ts extracted)
  ↓
R2 (probe runner) ← depends on R0 (probe/ extracted), benefits from R1
  ↓
R3 (canary) ← depends on R1 (send hook point), R0 (probe/ separated)
  ↓
R4 (write-back) ← depends on R1 (governed send path)
  ↓
R5 (HPP + back-off) ← depends on R0 (mutate.ts), R2 (probe runner)
  ↓
R6 (tests) ← depends on R0 (testable modules) + R1 (mockable send)
```

R6 should run incrementally alongside each phase, not just at the end.

---

## What Changes for the Agent

**Nothing.** The tool's Zod schema, output shape, and tool/agent contract stay identical through R0-R4. The agent sends the same parameters and reads the same JSON. R5 adds one new `vuln_type` value (`"hpp"`) — backward compatible.

## What Changes for the Orchestrator

After R3+R4:
- Stored/second-order injections become detectable via `stored_reflection` signals
- Triggered errors (SQL, path disclosure) become routable via signal fabric
- The orchestrator's `new_signal` retest queue starts receiving inject_probe-originated signals

## Risk Assessment

| Phase | Risk | Mitigation |
|-------|------|-----------|
| R0 | Import rewiring breaks runtime | No logic change; full test suite before/after |
| R1 | Governed send has different timeout/retry semantics | Match current behavior (15s timeout, no retry, manual redirect) |
| R2 | Abstraction doesn't fit XSS's multi-phase structure | XSS keeps its orchestration; phases use the runner internally |
| R3 | Canary volume overwhelming (hundreds per invocation) | Registry is O(1) insert, O(n) scan; n<1000 per session is negligible |
| R4 | Write-back doubles the detector cost per response | Detectors are pure regex matches, <1ms each; inject_probe typically fires <200 sends |
| R5 | HPP could confuse parsers that don't expect duplicate params | HPP is the test — that's the point. No server-side effect. |

---

## Effort Summary

| Phase | Effort | Sessions | Independently shippable |
|-------|--------|----------|------------------------|
| R0 | Medium | 1-2 | Yes |
| R1 | Medium | 1 | Yes (after R0) |
| R2 | Medium | 1 | Yes (after R0) |
| R3 | Small-Medium | 0.5-1 | Yes (after R1) |
| R4 | Small | 0.5 | Yes (after R1) |
| R5 | Small | 0.5 | Yes (after R0+R2) |
| R6 | Medium-Large | 1-2 (incremental) | Yes (per module) |
| **Total** | | **5-8 sessions** | |

---

## Completion Summary (2026-09-05)

All 7 phases shipped in a single day on `web-workflow`. The monolith is gone.

**Test coverage:** 268 inject-probe tests across 7 new + 13 modernized test files. Combined with 180 signal+webhook tests = 448 total, 0 failures.

**Key outcomes:**
- 1859-line monolith → 17 modules in `src/tool/inject-probe/`
- Raw `fetch()` → governed transport (`ReplaySender` → `governedSend()`)
- 5× duplicated probe loop → shared `fireLoop<P,T>` in `base.ts`
- Zero canary registration → `CanaryRegistry` + `DbCanaryStore` for cross-response correlation
- Zero signal write-back → `scanProbeResponse()` feeds 13 passive detectors on every response
- No HPP → `probeHppPoint()` with parser-behavior classification (first-wins/last-wins/both)
- No backoff → adaptive `BackoffState` machine (500ms→skip-point→2000ms)
- Zero tests → 268 tests with mock `HttpSender`
- vuln_type enum: 8 classes → 9 (added `hpp`)

**Before/after comparison:** See `docs/inject-probe-before-after.md` for a detailed WAF-protected scenario walkthrough.
