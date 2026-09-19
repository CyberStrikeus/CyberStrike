# Correlation Hunter Agent (pro/enterprise)

**Status:** design / planning (2026-09-19)
**Tier:** **pro / enterprise** — this is BRAIN, not HANDS.

## Problem

Today's web specialists are **endpoint-scoped**: the dispatcher hands each one a single flagged
endpoint (from a Vortex signal), it tests that endpoint, reports, and stops. They do **not** reason
*across* the session — so they miss everything that only emerges from the global picture:

- **Chains.** Open redirect on the Keycloak `authorize` endpoint + an auth-code flow ⇒ account
  takeover. SSRF on one endpoint + an internal service seen in another. An exposed Swagger spec +
  an IDOR on one of its documented routes.
- **Emergent patterns.** The same parameter reflected across several endpoints; a tech fingerprint
  (e.g. a specific framework/version) whose known CVE applies to a component seen elsewhere; an auth
  bypass on host A combined with a BFLA surface on host B.
- **Cross-identity reasoning at scale.** Which *operations* (not just endpoints) are reachable under
  multiple identities, correlated with which ones return different data — the real BOLA surface.

A per-endpoint specialist structurally cannot see these. The deterministic pipeline (Vortex) surfaces
the *signals*; nothing then reasons over the accumulated signals + traffic to hypothesize and confirm
**new** vulnerabilities.

## The agent

A **cross-cutting hunter** with the whole session's Vortex data in view. It does not replace the
specialists — it runs over what they and the deterministic layer have already gathered, and hunts for
what only the global view reveals.

### Inputs (Vortex-backed tools it is given)

- **`list_findings`** — every confirmed/triaged finding for the session (class, endpoint, evidence).
- **`query_traffic`** — the Vortex DSL/`expr` engine over the full corpus (`analyzeCorpus`): filter
  transactions by method/host/param/header/status/identity, so the agent asks precise questions
  ("every response that reflects param `q`", "every endpoint reached by ≥2 identities returning a
  body diff").
- **`tech_fingerprints`** — the detected stack per host (feeds CVE correlation).
- **`endpoint_inventory`** — all known endpoints/operations (incl. those enumerated from OpenAPI specs).
- **`credentials/roles`** — the captured identities, for authenticated / cross-role hypotheses.
- **`http_replay` + probes** — to *confirm* a hypothesis, not just assert it (verification is
  mandatory; a hunter output is a confirmed finding or a queued inspection target, never a guess).

### What it does

1. **Correlate** the findings + traffic + tech into hypotheses (chains, emergent patterns, CVE hits).
2. **Verify** each hypothesis deterministically via `http_replay` / probes as the right identity.
3. **Emit** a confirmed finding, or queue a new inspection target when a specialist should follow up.

### When it runs

A **hunt pass** after the deterministic pipeline drains (queue empty, specialists done) — so it works
over the *complete* picture — and re-armed when significant new signal arrives. Bounded (one pass per
settle, budgeted) so it never loops.

## Why pro/enterprise (not free)

Per the tier model (`[[pro-tier-is-saas-only]]`): **HANDS (execution) = free/client; BRAIN
(orchestration + deep analysis) = paid/SaaS, never ships.** The hunter *is* the brain — deep
cross-signal reasoning is the product's core value, not the free land-grab surface. So:

- Gated behind `Tier.allows("pro")` (agent `tier: "pro"`), like the mobile/cloud/internal domains.
- The free build keeps the deterministic pipeline + endpoint specialists (still finds plenty — see
  the 50-finding free run); the hunter is the upsell that turns a pile of signals into chained,
  higher-severity findings.
- On enterprise, it also draws on the platform surface (vuln-mgmt history, ASM inventory) for
  cross-assessment correlation.

## Boundaries / non-goals

- Not a replacement for the deterministic layer or the specialists — it consumes their output.
- Never reports an unverified hypothesis; every hunter finding is confirmed by replay/probe.
- Bounded fan-out + budget; a hunt pass is not an open-ended crawl.
- Does not re-discover what deterministic recon already covers (specs, js-mining) — it *reasons over*
  that inventory.

## Open questions (to resolve before build)

- Exact tool surface for `query_traffic` (how much of the Vortex DSL to expose vs. a curated set).
- Verification budget + concurrency vs. the specialist pool.
- Output routing: confirmed finding directly vs. queue a specialist for the heavy confirmation.
- Enterprise cross-assessment correlation: scope + data-retention implications.
