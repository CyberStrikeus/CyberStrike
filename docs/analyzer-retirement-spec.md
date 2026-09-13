# wstg-analyzer Retirement Spec

> Analyzer (LLM-per-request Haiku call) → deterministic Vortex extraction.
> Every field below replaces a Haiku call with zero-token code.

---

## Why

`wstg-analyzer` runs a Haiku LLM call on every incoming HTTP request to extract objects,
functions, roles, and ID values. Vortex (`subjects.ts` → `inventory.ts`) already does ~60%
of this deterministically. The remaining ~40% (field schema, sensitive fields, HTML form
parsing, credential→role linking) can be covered with ~350 lines of deterministic code.

Removing analyzer eliminates per-request LLM token cost and the blocking Step 2 in the
orchestrator pipeline (analyzer must finish before testers dispatch).

---

## Part A — Vortex: HTML Form Parser (`body.ts`)

Currently `body.ts:130` returns `{ kind: "html", fields: {} }` — a black hole.
The parser must extract everything a security tester needs from an HTML response body,
dependency-free (regex only, no DOM parser — Vortex has zero deps by design).

### A.1 Forms

```html
<form action="/login" method="post" enctype="multipart/form-data" id="loginForm" name="login">
```

Extract per `<form>`:
| Field | Source | Security relevance |
|-------|--------|-------------------|
| `form.N.action` | `action` attr (resolve relative) | Target endpoint; open-redirect if user-controlled |
| `form.N.method` | `method` attr (default: `get`) | GET forms leak data in URL/referer; method mismatch = CSRF surface |
| `form.N.enctype` | `enctype` attr | `multipart/form-data` = file upload surface |
| `form.N.id` | `id` attr | Cross-reference with JS `document.getElementById` |
| `form.N.name` | `name` attr | Cross-reference with `document.forms.name` |

N = 0-based index. Cap at 20 forms per page.

### A.2 Input Fields

```html
<input type="hidden" name="csrf_token" value="abc123">
<input type="text" name="username" maxlength="50" required>
<input type="password" name="password" autocomplete="current-password">
<input type="email" name="email" pattern="[a-z]+@[a-z]+\.[a-z]+">
<input type="file" name="avatar" accept="image/*,.pdf">
<input type="number" name="amount" min="0" max="10000" step="0.01">
```

| Field | Source | Security relevance |
|-------|--------|-------------------|
| `input.NAME.type` | `type` attr (default: `text`) | hidden/file/password are high-value targets |
| `input.NAME.value` | `value` attr | Hidden input values: CSRF tokens, state, internal IDs |
| `input.NAME.name` | `name` attr | Parameter name sent to server |
| `input.NAME.maxlength` | `maxlength` attr | Client-side only? Server must enforce too |
| `input.NAME.pattern` | `pattern` attr | Client-side validation — bypass candidate |
| `input.NAME.required` | `required` presence | Client-side only — server-side enforcement? |
| `input.NAME.accept` | `accept` attr (file inputs) | Allowed file types — bypass candidate |
| `input.NAME.autocomplete` | `autocomplete` attr | `off` on password = deviation |
| `input.NAME.readonly` | `readonly` presence | Pre-filled server values worth tampering |
| `input.NAME.disabled` | `disabled` presence | Not submitted but may leak server values |
| `input.NAME.hidden` | `type="hidden"` flag | CSRF tokens, internal state, session markers |
| `input.NAME.formaction` | `formaction` attr | **Overrides form action** — hidden endpoint |
| `input.NAME.formmethod` | `formmethod` attr | **Overrides form method** — GET↔POST swap |

### A.3 Other Form Controls

**`<select>`** — `select.NAME.options` (comma-separated values), `select.NAME.selected`.
Role/privilege selection → mass-assignment; option values reveal valid enums.

**`<textarea>`** — `textarea.NAME`, maxlength if present. XSS/injection surface.

**`<button>`** — `button.N.formaction`, `button.N.formmethod`. **Overrides form action/method.**
A form with `action="/safe"` can have a button with `formaction="/dangerous"`.

### A.4 Hidden Inputs — Dedicated Extraction

Hidden inputs are the #1 security target in HTML forms. Dedicated field prefix `hidden.*`:

```
hidden.csrf_token = abc123
hidden._method = DELETE           # Rails/Laravel method override
hidden.user_id = 42               # IDOR candidate
hidden.role = admin               # privilege escalation candidate
hidden.redirect_url = /dashboard  # open redirect candidate
hidden.state = eyJhbGc...         # JWT/encoded state — decode candidate
hidden.__VIEWSTATE = /wEPDw...    # ASP.NET viewstate — deserialization target
hidden.__EVENTVALIDATION = ...    # ASP.NET event validation
hidden.__RequestVerificationToken # ASP.NET anti-CSRF
hidden.authenticity_token         # Rails anti-CSRF
hidden.csrfmiddlewaretoken        # Django anti-CSRF
hidden._token                     # Laravel anti-CSRF
```

Why dedicated extraction:
1. Server-side state the user isn't supposed to modify
2. CSRF tokens live here
3. Internal IDs live here (IDOR)
4. Method overrides (`_method`)
5. Redirect targets
6. Serialized objects (ViewState deserialization)

### A.5 Meta Tags (Security-Relevant)

| Field | Security relevance |
|-------|-------------------|
| `meta.csrf-token` | Rails/SPA anti-CSRF token in meta |
| `meta.csrf-param` | CSRF parameter name |
| `meta.content-security-policy` | CSP in meta — often weaker than header CSP |
| `meta.refresh` | Client-side redirect — open redirect if user-controlled |
| `meta.robots` | `noindex` on sensitive pages = signal |
| `meta.referrer` | `no-referrer` = developer aware of referrer leakage |
| `meta.generator` | **Tech fingerprint** — exact CMS version |

### A.6 Base Tag

`<base href="...">` — all relative URLs resolve against this. If injectable → controls
form targets, script sources, link destinations. Rare but critical.

### A.7 Links with Parameters

| Field | Security relevance |
|-------|-------------------|
| `link.N.href` (with query params) | Endpoint + parameter discovery; id values for IDOR |
| `link.javascript:` count | DOM XSS surface |
| `link.data:` presence | Data URI XSS vector |

Cap at 50 unique links with query params.

### A.8 Script References

| Field | Security relevance |
|-------|-------------------|
| `script.N.src` | External JS — version pinning, SRI, CDN dependency |
| `script.inline.N` (first 200 chars) | Inline secrets, API keys, config, endpoints |

### A.9 iframes

`iframe.N.src`, `iframe.N.srcdoc` presence, `iframe.N.sandbox` attr.
Cross-origin framing, clickjacking surface, sandbox bypass.

### A.10 HTML Comments

```html
<!-- TODO: remove debug endpoint before production -->
<!-- admin panel: /internal/admin -->
<!-- DB: mysql://user:pass@10.0.0.5:3306/prod -->
```

`comment.N` = first 200 chars. Cap 30, skip conditional (`[if IE]`) and empty.
This is WSTG-INFO-05 (Review Webpage Content for Information Leakage).

### A.11 Data Attributes (Security-Relevant)

```html
<div data-api-url="https://api.internal.com/v2" data-token="eyJhbG...">
```

Extract `data-*` matching: `api|url|endpoint|token|key|secret|user|id|config|auth`.
SPAs store API endpoints, tokens, user IDs in data attributes. Cap 50.

---

## Part B — Vortex: Inventory Enrichment (`inventory.ts`)

### B.1 ObjectRecord — add field schema

Current: `ref, resource, value, shapes, roles, endpoints, sites, transactions`.

Add:
```ts
fields: string[]           // ALL field names from request + response body
sensitiveFields: string[]  // subset matching SENSITIVE_RE
idFields: string[]         // subset matching ID_RE
```

Source: `params(tx).body` + `responseFields(tx)` — both return `Record<string, string>`.

### B.2 Sensitive Field Heuristic

```ts
const SENSITIVE_RE = /^(password|passwd|pwd|secret|token|api_?key|private_?key|access_?key|ssn|social_?security|credit_?card|card_?number|cvv|cvc|pin|auth|authorization|session|cookie|bearer)/i
```

### B.3 ID Field Heuristic

```ts
const ID_RE = /(_id|Id|_uuid|_ref|_key)$|^id$/i
```

Extends `idishKey()` in `subjects.ts` to catch compound names.

### B.4 FunctionRecord — add field inventory

```ts
requestFields: string[]    // all request body/query param names
responseFields: string[]   // all response body field names
hiddenInputs: string[]     // hidden input names from HTML response
```

### B.5 Human-readable function naming

```ts
// "GET /api/users/{id}" → "Get_User"
// "POST /api/orders" → "Create_Order"
function humanName(method: string, endpoint: string): string
```

Heuristic: CRUD verb from method + singular noun from last non-parameterized path segment.

---

## Part C — Bridge: Credential → Role (`session.ts` ingest)

Current: `captureAuthFromRaw()` → Vortex `subjects(tx)` extracts JWT role → **stops**.

Target: after `captureAuthFromRaw()`, if Vortex extracted role + credential_id known:
```
WebRole.ensure(role)
WebCredential.link(credential_id, role_id)
WebCredential.updateClaims(credential_id, { user_id, email, permissions })
```

Hook point: `session.ts` ingest route, after `captureAuthFromRaw()`.
Helper exists: `WebCredential.extractJWTClaims()` (line 382-398).

---

## Part D — Bridge: Vortex → WebObject/WebFunction (`session.ts` ingest)

After Vortex processes a transaction (`feedVortex` at ~line 2110), bridge to SQLite:

```
subjects(tx).function → WebFunction.add({ name, endpoint, method, action_type, related_objects })
subjects(tx).objects  → WebObject.add({ name, fields, sensitive_fields, id_fields })
                      → WebObjectValue.add({ object_name, field, value, credential_id })
subjects(tx).role     → WebRole.ensure({ name })
```

All downstream consumers (TUI sidebar, `web_get_session_context`, `ingest-summary.ts`)
read from WebObject/WebFunction/WebRole — so they work without change.

---

## Part E — Orchestrator Prompt Update

File: `packages/web/src/prompts/orchestrator/wstg-agent/prompt.txt`

| Line(s) | Change |
|---------|--------|
| 7 | Remove "2. Analyze it by delegating to the `wstg-analyzer` subagent" |
| 62 | Remove "Writing ... is delegated to the wstg-analyzer subagent" |
| 67 | Remove `wstg-analyzer` from agent name examples |
| 119-137 | **Delete entire Step 2 "BLOCKING FIRST STEP"** — analyzer dispatch gone |
| 139-148 | Step 3 becomes Step 2 — context is already populated by Vortex bridge |
| 212 | Remove "analyzer-registered object" reference |
| 260 | Remove "wstg-analyzer - Always run first" from agent list |
| 345-348 | Remove "ONLY AFTER the analyzer finished" — testers can launch immediately |
| 389 | Remove "enqueued when the analyzer discovers" reference |
| 408 | Remove "wstg-analyzer (extract User object)" example |

New flow: Step 1 (credential context) → Step 2 (read `web_get_session_context` — Vortex
bridge already filled it) → Step 3 (dispatch testers). No blocking first step.

---

## Part F — Tool Description Updates

| File | Line | Change |
|------|------|--------|
| `cyberstrike/src/tool/web-get-session-context.ts` | 17 | "the analyzer just extracted" → "Vortex extracted" |
| `cyberstrike/src/tool/hackbrowser.ts` | 16 | "web-analyzer ingest pipeline" → "Vortex ingest pipeline" |
| `cyberstrike/src/tool/hackbrowser.ts` | 74 | "web-analyzer dispatches" → "ingest dispatches" |

---

## Part G — Provider & Agent Spec Removal

| File | What |
|------|------|
| `web/src/provider-web.ts:25-26` | Delete `PROMPT_WSTG_ANALYZER` + `DESC_WSTG_ANALYZER` imports |
| `web/src/provider-web.ts:276-290` | Delete `wstg-analyzer` agent spec block |
| `web/src/provider-web.ts:164,168` | Remove `analyzers` filter + loop in `renderRoster()` |
| `web/src/provider-web.ts:193` | Remove "analyzer ... always kept" comment |
| `web/src/provider-web.ts:471` | Remove `role === "analyzer"` from focus filter |
| `web/src/prompts/analyzer/` | Delete entire directory |

---

## Part H — Agent Framework Cleanup

| File | Line | What |
|------|------|------|
| `cyberstrike/src/agent/agent.ts` | 43 | Remove `analyzer: 20` from STEP_CAPS |
| `cyberstrike/src/agent/agent.ts` | 87 | `useSmallModel` field — keep (orchestrator uses it too) |
| `cyberstrike/src/session/session.sql.ts` | 273 | Update "the analyzer never sees these" comment |

---

## Part I — Coverage Table Update

File: `cyberstrike/src/session/web/wstg-coverage.ts`

| WSTG ID | Current agent | New agent | New mechanism |
|---------|--------------|-----------|--------------|
| WSTG-INFO-01 | `wstg-analyzer` | `wstg-info-gathering` | Vortex inventory + recon_test |
| WSTG-INFO-04 | `wstg-analyzer` | `wstg-info-gathering` | Vortex inventory enumeration |
| WSTG-INFO-06 | `wstg-analyzer` | `wstg-info-gathering` | Vortex inject-point inventory |
| WSTG-INFO-07 | `wstg-analyzer` | `wstg-info-gathering` | Vortex function/workflow mapping |
| WSTG-INFO-09 | `wstg-analyzer` | `wstg-info-gathering` | Vortex object/function/role extraction |

Also remove `wstg-info-gathering` from the excluded set in the "every specialist owns
at least one test" assertion in `wstg-coverage.test.ts`.

---

## Part J — Test Updates

| File | What |
|------|------|
| `web/test/provider-web.test.ts:24` | Remove `wstg-analyzer` from agent name list |
| `web/test/provider-web.test.ts:47-51` | Delete "analyzer uses small model" test |
| `web/test/provider-web.test.ts:211-217` | Update renderRoster test (no analyzer section) |
| `web/test/provider-web.test.ts:249-260` | Update focus test (no analyzer in filtered set) |
| `cyberstrike/test/cloud/provider-health.test.ts:39` | Remove `byRole.analyzer` assertion |
| `cyberstrike/test/tool/web-write-function.test.ts:12` | Change `agent: "wstg-analyzer"` to orchestrator or remove |
| `cyberstrike/test/session/web/wstg-coverage.test.ts` | Update analyzer→info-gathering ownership |

---

## Migration Order

1. **A** — HTML form parser in `body.ts`
2. **B** — Inventory enrichment (fields, sensitive, id, function naming)
3. **C** — Credential→Role bridge at ingest
4. **D** — Vortex→WebObject/WebFunction bridge at ingest
5. **Verify** — TUI sidebar + `web_get_session_context` return equivalent data
6. **E+F** — Orchestrator prompt + tool descriptions
7. **G+H** — Provider spec + framework cleanup
8. **I** — Coverage table reassignment
9. **J** — Test updates
10. **Verify** — All tests pass, typecheck clean

## Effort

| Part | Lines | Complexity |
|------|-------|------------|
| A — HTML parser | ~120 | Medium (regex) |
| B — Inventory enrichment | ~55 | Easy |
| C — Credential bridge | ~15 | Easy |
| D — WebObject bridge | ~60 | Medium |
| E — Orchestrator prompt | ~rewrite | Medium |
| F — Tool descriptions | ~5 | Easy |
| G — Provider removal | ~30 delete | Easy |
| H — Framework cleanup | ~5 | Easy |
| I — Coverage table | ~10 | Easy |
| J — Tests | ~40 | Easy |
| **Total** | **~340 new + ~200 delete** | |
