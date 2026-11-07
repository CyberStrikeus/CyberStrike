# Discovery + Fast-Testing Plan (Web Workflow 2.0)

Status: proposed. Branch: `web-workflow`.

## Problem

Two measured failures on a real SPA target (single session):

1. **Shallow discovery.** The endpoint that carried the critical SQLi (a POST API endpoint that runs a query template)
   was only reached by a human clicking into a list→detail page. The LLM co-drive navigator
   observed the parent page but never drilled in. Endpoint coverage depends on the LLM *choosing*
   to click the right things — silent holes on real-but-unglamorous routes.
2. **Slow + explosive testing.** 115 captured endpoints produced ~300–700 child LLM retest
   sessions (now mitigated by the targeted-flag change), each an LLM sub-agent. Even bounded, an
   LLM-per-endpoint confirmation model is far slower than a deterministic-probe-first tool.

Root causes (verified in code):

- **BFS regression.** v1.1.16 had a real breadth-first crawler: FIFO page queue, exhaustive
  `<a href>` enumeration (`collectDOMLinks`), templated-route sampling (`MAX_PER_PATH_PATTERN=5`),
  lazy-content reveal, post-login re-discovery, multi-credential parallel BFS. The current branch
  replaced it with an LLM navigator + a `frontier` set used ONLY for dead-end backtracking — no
  breadth guarantee. **We lost deterministic breadth.**
- **No JS→endpoint pipeline.** `JsMine` does a single non-recursive regex pass over already-known
  bundle URLs; it does not follow chunk / dynamic-import / source-map references, is not fed by a
  reliable credentialed JS fetch, and no agent analyzes JS for tech-stack vs custom-API split.
  (Note: v1.1.16 had NO JS analysis at all — it skipped `.js`. So this is NEW capability, not a
  restore.)
- **LLM-per-endpoint testing.** Confirmation is an LLM sub-agent per endpoint. A competing
  API-first tool is faster because it probes the API surface deterministically and spends a model
  only on a hit.

## Strategy: three complementary discovery sources → one endpoint surface → deterministic-first testing

```
  (A) Deterministic BFS breadth  ─┐
  (B) JS-first recursive mining  ─┼──►  Unified endpoint surface  ──►  (D) API-direct fast lane
  (C) Runtime capture (existing) ─┘         (dedup by key_hash)          (probe → signal → LLM on hit)
                                                     │
                                                     └──►  correlate with network graph
                                                          (web_object / web_role / web_function /
                                                           web_object_value / web_credential)
```

Discovery is incremental: sources emit endpoints as they find them; each new endpoint enqueues its
own probe once (dedup by `key_hash`), so "some arrive now, some later" is handled by the same
flag/queue model already used for retests.

---

## (A) Restore deterministic BFS breadth — the regression fix

Reintroduce a systematic frontier that runs UNDER the LLM navigator, not instead of it. The LLM
still decides what to do on a page (forms, widgets, deep interactions); BFS guarantees every
discovered in-scope page is visited.

- **FIFO frontier** (breadth-first), not the current backtrack-only LIFO. Visit every discovered
  in-scope URL up to a page budget.
- **Exhaustive `<a href>` enumeration** per visited page (the extension already collects links;
  enqueue ALL in-scope ones deterministically, not only LLM-chosen).
- **Templated-route sampling**: collapse `/item/{id}` instances, visit N (≈5) representatives —
  IDOR breadth without letting a list eat the budget. Reuse the existing `key_hash`/template logic.
- **List→detail drill-down**: when a page shows a repeated row/table with item links, enqueue a
  sample of detail pages (this is exactly what was missed for a list→detail view that triggers a query-template API).
- **Lazy-content reveal + disclosure expansion** before scanning (scroll infinite lists, open
  `<details>`/`aria-expanded`) — deterministic, independent of the LLM choosing to scroll.
- **Post-auth re-discovery**: after a login/role change, re-queue visited pages to re-crawl them
  authenticated (pairs with the per-origin credential capture already built).

Integration point: `session/web/crawl.ts` (frontier), `co-drive-session.ts` (loop), and the
extension observation (link list). Keep the LLM navigator as the per-page brain.

## (B) JS-first recursive endpoint pipeline — new capability

The fastest way to map an SPA is its JavaScript. Build the pipeline the old version never had.

1. **Reliable credentialed fetch.** Fetch every discovered JS bundle via the extension's
   `op:"fetch"` (`credentials:"include"`) so auth-gated bundles are not missed (server-side fetch
   currently misses them). Dedup by content hash so a CDN bundle shared across pages is analyzed
   once.
2. **Recursive JS→JS following.** Follow webpack chunk manifests, dynamic `import()` targets, and
   `//# sourceMappingURL` → source maps, enqueuing referenced bundles. Bounded (per-session fetch
   cap, size cap, no retry). This is the "recursive" step currently missing.
3. **Triage each bundle: library vs custom.**
   - **Third-party / CDN / library** (cdnjs, unpkg, jsdelivr, googleapis, or a different
     registrable domain; library banners / webpack vendor chunks) → extract library name+version →
     emit `technology` signals → **TechPlaybook** (already built) drives stack-specific test cases.
     This is the security-misconfig angle.
   - **First-party / custom** (target's own domain, `app.[hash].js`) → extract API endpoints.
4. **Endpoint extraction (deterministic first, small-LLM refine).**
   - Deterministic: expand `JsMine` regexes (`fetch`/`axios`/XHR call sites, `/api/` prefixes,
     route tables, GraphQL operations); template params to shapes.
   - Small-LLM refine (bounded, cheap): pass the EXTRACTED candidate strings (never raw JS) to a
     small model to separate real endpoints from noise and infer params. Keeps tokens bounded and
     honors "raw JS never reaches an LLM".
5. **Feed the endpoint surface** with method+path templates → the unified surface below.

## (C) Runtime capture — keep as-is

The extension already captures real traffic (authenticated, real-session). This remains the third
source and the ground truth for request shape/auth. Per-origin credential capture (built) feeds it.

## Unify + correlate with the network graph

- **Unified endpoint surface**: BFS-discovered pages + JS-mined endpoints + captured requests +
  OpenAPI/metafile URLs, deduped by `key_hash`. One list the test lane consumes.
- **Correlate with the network graph** the analyzer already produces (`web_object`,
  `web_object_value`, `web_role`, `web_function`, `web_credential`): a JS-mined endpoint that
  matches a captured function inherits its objects/roles/values; an endpoint seen only in JS (never
  fired at runtime) is flagged "known-unvisited" so the API-direct lane tests it consciously.

## (D) API-direct fast test lane — the speed fix

For every endpoint on the unified surface, run ONE deterministic probe via `http_replay` (which
already supports a constructed `target` with no captured request), BEFORE spending any LLM:

- **auth-strip** — send without credentials → unauthenticated access = broken access control.
- **cross-identity** — replay under each captured credential (per-origin auth, built) → same object
  under a different identity = IDOR/BFLA. (This replaces the blanket `flagAll` cross-cred fan-out
  with a deterministic per-endpoint probe.)
- **error-canary** — inject `'` / `%27` → SQL/engine error signature (feeds the signal fabric).
- **method matrix** — PUT/DELETE/TRACE where a GET/POST was seen.

Results go into the signal fabric (existing). An **LLM specialist is dispatched ONLY when a probe
raises a signal** — the deterministic-first, model-on-hit model that makes an API-first tool fast.
This is a new fast lane that runs alongside (and largely replaces) the heavy retest fan-out.

## Advanced discovery when JS is thin (BFS-poor / obfuscated)

When JS yields few endpoints (heavy obfuscation, server-rendered, tiny bundles):

- **Parameter / path brute** from wordlists scoped to the detected stack (TechPlaybook paths).
- **OpenAPI/GraphQL introspection** (recon already parses OpenAPI; add GraphQL introspection).
- **Source-map recovery** of original module/route names when maps are present.
- **Response-body link mining** (HTML `href`/`action`, JSON `_links`/HATEOAS, `Location` headers).

## Sequencing (proposed)

1. **Phase 1 — API-direct fast lane (D) + targeted-flag (done).** Highest leverage: deterministic
   probe surface, LLM on hit. Kills the slowness, deepens testing of already-known endpoints.
2. **Phase 2 — JS-first pipeline (B).** Credentialed fetch → recursive follow → triage → extract →
   feed surface. This is the real depth unlock (map the API without browser depth). Library→tech
   half plugs into the already-built `technology`/TechPlaybook path.
3. **Phase 3 — Restore BFS breadth (A).** Deterministic frontier + exhaustive links + list→detail
   drill-down + templated sampling + post-auth re-discovery, under the LLM navigator.
4. **Phase 4 — Unify + correlate + advanced discovery (C-glue).**

Rationale: (D) and (B) give the biggest speed+depth wins and are mostly browser-independent; (A)
restores the lost breadth for what only the UI reveals. Each phase is independently shippable and
testable.

## Explicitly NOT claiming

- JS bundle / source-map / chunk mining is **new** — the old version never had it (it skipped JS).
- robots/sitemap seeding and static `<form action>` harvesting were **not** in the old version
  either; they are additive.
- What we regressed on is **deterministic breadth (BFS + exhaustive anchors + templated sampling +
  lazy reveal + post-login re-discovery)** — Phase 3 restores exactly that.
