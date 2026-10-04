# Correlation & Escalation Hunter Agent (pro/enterprise)

**Status:** design / planning (updated 2026-10-04)
**Tier:** **pro / enterprise** — this is BRAIN, not HANDS.
**Relates to:** #44, the deterministic pipeline (#77/#78), inline navigable dispatch entries (post-#78),
the shared-prompt HTTPQL guidance (#82).

## Problem

Today's web specialists are **endpoint-scoped**: the dispatcher hands each one a single flagged endpoint
(from a Vortex signal), it tests that endpoint, reports, and stops. Two whole classes of value are
structurally out of their reach:

1. **Cross-cutting vulnerabilities** that only emerge from the global picture:
   - **Chains.** Open redirect on the Keycloak `authorize` endpoint + an auth-code flow ⇒ account
     takeover. SSRF on one endpoint + an internal service seen in another. An exposed Swagger spec +
     an IDOR on one of its documented routes.
   - **Emergent patterns.** The same parameter reflected across several endpoints; a tech fingerprint
     (framework/version) whose known CVE applies to a component seen elsewhere; an auth bypass on host A
     combined with a BFLA surface on host B.
   - **Cross-identity reasoning at scale.** Which *operations* (not just endpoints) are reachable under
     multiple identities, correlated with which return different data — the real BOLA surface.

2. **Impact escalation.** A specialist confirms a finding at the severity it can prove *on its own
   endpoint* and stops. Nobody then asks the adversary's question: **"so what — how far can I take
   this?"** Three P4s that chain into a P1. A "low" info-disclosure that leaks the internal host that
   makes the "medium" SSRF an RCE. A reflected value that, combined with a permissive CORS policy, is
   an authenticated-token exfiltration. The *maximum realistic impact* is almost always higher than any
   single specialist reports.

A per-endpoint specialist cannot see either. The deterministic pipeline (Vortex) surfaces the *signals*;
nothing then reasons over the accumulated signals + traffic + findings to **construct new, higher-impact
attacks and prove them.**

## The agent

A **cross-cutting hunter that chains, escalates impact, and constructs exploits** — with the whole
session's Vortex data in view. It does not replace the specialists; it runs over what they and the
deterministic layer already gathered and hunts for what only the global, adversarial view reveals. Three
defining properties:

- **Generative / adversarial.** It doesn't just correlate pre-labelled leads — it *hypothesizes* attacks:
  "with this leaked host + this SSRF I could reach the metadata endpoint"; "this IDOR plus this role
  confusion is a full tenant takeover." It proposes the exploit, then tries to build it.
- **Impact-maximizing.** For every confirmed finding its first question is *"what is the maximum I can
  escalate this to, and what can I chain it with?"* — severity is an output it pushes up, not a given.
- **Relentless but bounded.** It does not stop at the first dead end. It runs a hypothesis → test →
  learn loop that tries new angles until a budget is spent — the core design below.

### Inputs (Vortex-backed tools)

Everything it needs already exists as agent tools (the same PULL surface the specialists use, keyed by
the ROOT session so it sees the whole corpus):

- **`list_findings`** / `web_get_vulnerabilities` — every confirmed/triaged finding (class, endpoint,
  evidence, severity) — the escalation substrate.
- **`vortex_query` {httpql}** — HTTPQL SELECT over the full corpus (identity, endpoint, req.path,
  req.method, resp.status, body/header greps): "every response reflecting param `q`", "every endpoint
  reached by ≥2 identities returning a body diff".
- **`vortex_where_value` {value}** — trace a token / internal host / object id EVERYWHERE it flows — the
  pivot that turns one finding's leaked artifact into another's key.
- **`vortex_cross_role`** — objects/functions reached under >1 role (the BOLA/BFLA surface).
- **`tech_fingerprints`** — the detected stack per host (`technology` + `vulnerable-component` signals) —
  feeds CVE/known-misconfig correlation.
- **`endpoint_inventory`** — all known endpoints/operations (incl. OpenAPI-enumerated).
- **`credentials` / `roles`** — captured identities, for authenticated / cross-role hypotheses.
- **`http_replay` / `http_replay_raw` / probes** — to **confirm** a constructed attack as the right
  identity. Verification is mandatory (see gate below).

## Impact escalation — the reasoning

For each confirmed finding (and promising signal), the agent runs an escalation pass asking, in order:

1. **Lift severity in place.** Is the proven impact the real ceiling? (A "reflected input" that is
   actually stored → stored XSS; a verbose error that actually leaks creds; an IDOR that reaches an
   admin object, not just a peer's.)
2. **Chain outward.** What does this finding *produce* (a leaked host, a token, an object id, a
   predictable identifier, a trust boundary) that another part of the corpus *consumes*? `vortex_where_value`
   the produced artifact; `vortex_query` for sinks of that shape.
3. **Escalate privilege / tenancy.** Does the chain cross an identity, role, or tenant boundary
   (horizontal → vertical → cross-org)?
4. **Reach the crown jewels.** Does the chain terminate at ATO, RCE, full data exfiltration, or
   authz-wide bypass — the outcomes that set the report's top-line severity?

### Escalation pattern catalog (seed set, extensible as data)

A starter library of "finding(s) → escalated impact" templates the agent reasons with (not hardcoded
rules — hypotheses to test):

| Primitive(s) present | Escalated attack to attempt |
|---|---|
| info-disclosure (internal host) + SSRF | internal pivot → cloud metadata / internal service RCE |
| IDOR (object) + weak/predictable ids | bulk enumeration → mass data exfiltration |
| open redirect + OAuth/OIDC auth-code flow | token/code theft → account takeover |
| reflected value + permissive CORS (credentialed) | authenticated response/token exfiltration |
| BFLA (admin function reachable) + IDOR | privilege escalation → tenant/admin takeover |
| `vulnerable-component` (versioned CVE) + reachable sink | known-CVE exploitation on the live stack |
| verbose error / stack trace + injection point | error-guided injection → DB/command access |
| JWT weakness (alg/kid) + any authz check | identity forgery → authz-wide bypass |

The catalog is **data** (a pack), not code — it grows without a release, and enterprise can add
customer-specific chains.

## The relentless loop (hypothesis → test → learn) — the heart

This is what makes the agent "not give up" without looping forever. A single **hunt pass** is a bounded
worker over a hypothesis frontier:

```
seed hypotheses  ← findings × escalation catalog × corpus pivots
budget           ← steps / tokens / wall-clock / verification calls (configurable)
tried            ← set of (hypothesis fingerprint) already attempted  (never re-hit the same wall)

while budget remains and frontier not empty:
    h = pick highest-expected-impact untried hypothesis
    gather context (vortex_query / where_value / cross_role for h's primitives)
    construct the concrete attack (request(s), identity, sequence)
    VERIFY by replay as the right identity            ← the gate; no guesses
    if confirmed:
        emit escalation finding (with the full chain + impact delta)
        spawn NEW hypotheses from what it revealed     ← success breeds new angles
    else:
        record WHY it failed (missing primitive, boundary held, needs a value we don't have)
        derive adjacent hypotheses (different identity / param / encoding / sibling object)
    mark h tried
```

Key properties that make it relentless **and** safe:

- **Failure is fuel, not a stop.** A dead end produces *adjacent* hypotheses (try another identity, a
  sibling object, a different encoding) — it changes the angle instead of quitting.
- **Never re-hits the same wall.** The `tried` set (hypothesis fingerprint, like the specialists'
  repeat-guard) stops it burning budget on a proven-closed path.
- **Budget-bounded.** steps / tokens / wall-clock / verification-call ceilings — a hunt pass terminates
  deterministically. Relentless *within* the budget, not infinite.
- **Expected-impact ordering.** It spends budget on the hypotheses most likely to reach a crown-jewel
  outcome first, so a cut-short pass still surfaces the highest-value chains.

## Verification gate (mandatory — no hallucinated impact)

Same discipline as the specialists' verification gate: **a hunter output is a confirmed finding or a
queued inspection target, never a claim.** "I escalated this to ATO" must be *shown* by a replay
sequence (the exact requests, under the exact identities, with the proving responses), not narrated. An
unconfirmed-but-promising chain becomes a **queued inspection target** (a specialist follows up with the
heavy confirmation) rather than a reported finding.

## When / where it runs (integration with the current pipeline)

- **Trigger:** a **hunt pass** after the deterministic pipeline drains (inspection queue empty,
  specialists done — the `onDrain` seam already exists), so it reasons over the *complete* picture;
  re-armed when significant new signal arrives.
- **Dispatch:** it runs as a child session off the root, exactly like a specialist — so it already
  appears **inline + navigable** in the root transcript (the post-#78 transcript entries) and the root
  agent is aware of it. Its sub-attempts (verification replays, spawned specialist follow-ups) nest
  under it.
- **Output:** escalation findings routed like any finding (on the root session, severity-bumped with
  the chain as evidence); queued follow-ups go through the normal dispatcher. The chain is first-class
  in the final report ("3× P4 → P1 via …").
- **Concurrency:** one hunt pass at a time per session, budget-bounded; its verification replays share
  (and are capped against) the specialist pool so it never starves live testing.

## Why pro/enterprise (not free)

Per the tier model (`[[pro-tier-is-saas-only]]`): **HANDS (execution) = free/client; BRAIN (orchestration
+ deep analysis) = paid/SaaS, never ships.** The hunter *is* the brain — deep cross-signal reasoning +
impact escalation is the product's core value, not the free land-grab surface.

- Gated behind `Tier.allows("pro")` (agent `tier: "pro"`), like the mobile/cloud/internal domains.
- Free build keeps the deterministic pipeline + endpoint specialists (still finds plenty); the hunter is
  the upsell that turns a pile of signals into **chained, higher-severity** findings.
- Enterprise additionally draws on the platform surface (vuln-mgmt history, ASM inventory) for
  cross-assessment correlation and customer-specific escalation packs.

## Boundaries / non-goals

- Not a replacement for the deterministic layer or the specialists — it consumes their output.
- **Never reports an unverified hypothesis** — confirmed by replay, or queued for a specialist.
- Bounded fan-out + budget; a hunt pass is not an open-ended crawl, and the `tried` set prevents loops.
- Does not re-discover what deterministic recon already covers (specs, js-mining) — it *reasons over* it.
- Not destructive by default: escalation attempts obey the replay-safety layer (no session-minting /
  destructive replays); genuinely destructive proofs are described, not executed, unless explicitly
  authorized.

## P1 — the code-enforced relentless engine (the secret sauce)

In P0/P0.5 the hunter's relentlessness is **prompt-trust**: the prompt asks for a frontier + tried-set +
budget, but the model decides whether to actually run it — a weak or easily-satisfied model gives up.
P1 moves the loop into CODE, turning the hunter from "an LLM that might chain findings" into **a
deterministic search engine with the LLM as its creative hypothesis oracle + verifier.** The model can
want to stop early; the code keeps handing it the next frontier item until the frontier is empty or the
budget is spent.

**The split (over-constraining makes the model dumber — so draw the line deliberately):**

- **Code enforces:** persistence (the loop doesn't end until frontier-empty / budget), coverage (every
  hypothesis flows through the frontier), no-repeat (a closed path cannot be re-attempted), budget
  (hard step/verification/token ceiling), no-hallucination (nothing is reported unverified).
- **The model owns:** the CONTENT of a hypothesis (the creative "chain X with Y to reach Z"), how to
  construct the attack, which angle to try next.

**Approach A — a tool-shaped frontier inside the existing agentic session** (preferred: reuses the
agentic loop, doesn't smother the model's creativity, but the engine lives in code):

- `propose_escalation {from_finding_ids, hypothesis, target_impact}` — the model EMITS a hypothesis;
  code fingerprints it, rejects a duplicate/closed one (the tried-set, code-enforced), and enqueues it
  on the frontier ordered by expected impact. Returns the next item the model must work, not a free
  choice — so the model cannot skip the backlog or quit while it is non-empty.
- `verify_escalation {request_sequence, identities}` — the ONLY path to confirm a chain; code runs the
  replay sequence (replay-safe) and returns the proof or the failure reason. A `report_vulnerability`
  for an escalation REQUIRES a verify token from this (same gate as triage) — no hallucinated impact.
- On a CONFIRMED escalation, code auto-derives follow-up hypotheses from the artifact it produced (the
  leaked host/token/id → new sinks via `vortex_where_value`) and enqueues them — success breeds angles
  without the model having to remember.
- The budget (steps / verifications / wall-clock) is metered in code; when it is spent the engine stops
  and emits what it has, highest-impact first.

Approach B (the EscalationRunner drives multiple model turns, holding the frontier between them) is the
purer code-driven form but heavier; A is the elegant He-Man — the engine is code, the agentic session
is where the model reasons.

## Phased plan

- **P0 — escalation-only MVP (no new infra).** A pro `escalation-hunter` agent whose prompt encodes the
  escalation questions + catalog; tools = the existing PULL surface + `http_replay`. Triggered manually
  or on drain. Proves the loop + verification on real findings. Small, shippable.
- **P1 — the code-enforced relentless engine.** See the dedicated section above: a tool-shaped frontier (`propose_escalation` / `verify_escalation`) with code-held tried-set, budget, ordering + verification gate. The secret sauce — "doesn't give up" becomes structural.
- **P2 — escalation catalog as a data pack.** Move the pattern catalog out of the prompt into a loadable
  pack (`selectRules`-style), enterprise-extensible.
- **P3 — cross-assessment (enterprise).** Correlate across assessments via the platform (ASM inventory,
  vuln history) — the same chain found once becomes a template hunted everywhere.

## Open questions (to resolve before build)

- Exact `vortex_query` surface for the hunter vs. the specialists (same curated set, or a wider DSL?).
- Verification budget + how the hunter's replays share the specialist concurrency pool.
- Output routing: direct confirmed finding vs. always queue a specialist for the heavy confirmation.
- Expected-impact scoring: heuristic seed vs. learned ranking.
- Enterprise cross-assessment correlation: scope + data-retention implications.
