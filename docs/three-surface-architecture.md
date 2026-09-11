# Three-Surface Architecture — HackBrowser · Vortex · Agentic Loop

The web pipeline is being separated into three surfaces with **no overlap of responsibility**.
Today they are entangled: the CyberStrike ingest handler does acquisition glue, deterministic
analysis, AND orchestration, and it keeps a parallel set of CS stores (Request / WebObject /
WebFunction / Observation / SignalStore) that duplicate what the Vortex engine already models.

This document defines the target boundaries and the **sequenced, one-slice-at-a-time** migration to
reach them. Nothing is deleted before its capability is fully mapped onto its target surface and
verified live (the "no feature unmapped" rule).

## The three surfaces

### 1. HackBrowser surface — ACQUISITION ONLY
The browser extension captures network traffic and posts the raw request/response to CyberStrike's
ingest endpoint. That is its whole job. No analysis, no stores, no dedup — it hands raw traffic over
and stops. (The ingest HTTP endpoint itself lives in CyberStrike, but it becomes a thin receiver.)

### 2. Vortex surface — THE ENGINE (single source of truth for everything derived from traffic)
Owns every deterministic thing computed from traffic:
- ingest + **store ALL traffic** (every hit, not one-per-shape), normalize, **dedup for views**;
- **subjects**: functions (operations/CRUD), objects (resource refs — IDOR/BOLA), identity (role/
  roles/scopes from `tx.identity` + JWT);
- **inventory**: inject points (the parameter surface);
- **signals**: passive rules + canary (stored reflection) + active-probe, deduped per endpoint;
- **discovery**: endpoints / JS URLs / secrets / tech (via the `jsmine` extractor);
- **query**: HTTPQL over the whole corpus (what agents call).

Vortex is READ-ONLY to agents (they consult it); only Vortex's own ingest/auto-probe writes it.

### 3. Agentic Loop Architecture — ORCHESTRATION (CyberStrike's own job)
Owns the session + agent machinery, all of which CONSUMES Vortex:
- session lifecycle, scope;
- **orchestrator dispatch** (IngestQueue → hunt-agent: a per-new-endpoint dispatch brief);
- **retest-worker** (Vortex signal → owning WSTG specialist, deterministic);
- **subagents + their tools** — every tool queries Vortex (`vortex_query`, `vortex_leads`, …);
- the **vulnerability store** (`report_vulnerability` — confirmed findings), coverage/methodology;
- the **TUI** (sidebar Captures + Vortex Signals + Vulnerabilities), all sourced from Vortex.

## Responsibility inventory — current → target surface

| Current responsibility (mostly in the ingest handler / CS stores) | Vortex today | Target surface |
|---|---|---|
| HTTP ingest endpoint | — | Agentic (thin receiver) |
| Scope check (`WebScope`) | — | Agentic |
| Credential capture (`WebCredential.captureAuthFromRaw`) | identity modelled (`subjects`), auth-material extraction NOT | Vortex |
| JS detection + mining (`WebJs` / `JsMiner`) | `discovery.ts` + `jsmine` extractor | Vortex |
| Dedup (`Request.exists` by key_hash) | `vortexCaptures` + `endpointKey` (done) | Vortex |
| Observation / cross-cred IDOR (`Observation`) | `accessRules` + `subjects.objects` + `vortex_query` | Vortex (agents query it) |
| **Signal fabric** (`runDetectors`/`scanCapturedResponse` + `SignalStore`) | rules + canary (fully mapped) | Vortex — **retiring now (#15)** |
| Request store (`Request.add`) | transactions = the request store | Vortex |
| Object/function analyzer + per-credential values (`WebObject`/`WebFunction`) | `subjects` (structural) + inventory; per-credential VALUE substrate needs parity | Vortex |
| Retest queue (`WebRetest`) | fed by Vortex via the #14 bridge | Agentic (queue), Vortex-fed |
| Orchestrator dispatch (`IngestQueue` → hunt-agent) | — | Agentic (its core job) |
| API probe (`ApiProbe` autonomous safe-method sweep) | active-probe (`probeSession`); the sweep itself becomes a subagent | Agentic subagent, on Vortex |

## Migration slices (sequential — one at a time, each with a verification gate)

Each slice: (a) build/wire the Vortex (or agentic) side to full parity, (b) repoint consumers,
(c) verify live (the capability produces the same or a superset), (d) only THEN delete the CS side.

- **Slice 0 — Vortex receives ALL traffic.** Ingest handler feeds every hit to Vortex (duplicate
  branches included), each as its own transaction. Vortex already dedups for the Captures view and
  per-endpoint for signals. Unlocks: no duplicate-response gap, agents can query the full corpus.
  *(Prereq for cleanly retiring the signal fabric.)*
- **Slice 1 — Retire the signal fabric (#15). ✅ DONE.** Context section 7 reads Vortex; the 14
  detectors + canary + technology are mapped; routing parity via `ownerForSignal` (per-rule owner
  overrides); DETECTION parity closed by widening the Vortex regexes to a superset of the CS `Observe`
  heuristics (sql-error, stack-trace incl. "Exception in thread", secret incl. Google/Slack/AWS-temp
  keys, server-banner incl. framework headers). The ingest-route tests were rewritten to assert the
  VORTEX path (the parity proof, 6/6 green), then `runFabric`/`scanCapturedResponse` was removed from
  the ingest handler — Vortex is now the sole passive producer. The signal/ detector modules stay for
  the agent-elicited paths (scanProbeResponse / scanElicitedResponse), which are CS-side by design.
- **Slice 2 — Credentials/identity → Vortex.** Capture auth material into Vortex identity; agents
  read identity from Vortex. Remove the CS `WebCredential` dependency from analysis paths.
- **Slice 3 — Objects/functions/values → Vortex.** The biggest parity item: move the analyzer's
  schema + per-credential value substrate onto `subjects` + inventory + leads. Repoint
  `web_get_session_context.recent` + `web_get_detail` + the object/function tools to Vortex.
- **Slice 4 — Observations (IDOR) → Vortex.** Replace the `Observation` shortlist with `accessRules`
  + agent `vortex_query`. Remove the CS `Observation` store.
- **Slice 5 — JS mining → Vortex.** Route JS discovery + mining through Vortex's `jsmine`/discovery.
  Remove the CS `JsMiner` path.
- **Slice 6 — API probe → subagent.** The autonomous safe-method sweep becomes a subagent that uses
  Vortex active-probe. Remove the CS `ApiProbe`.
- **Slice 7 — Request store → Vortex.** Repoint `recent_requests`, the retest queue's endpoint
  resolution, and any remaining `Request` reader to Vortex transactions. Remove the CS `Request`
  store (the last and most-depended-on CS store).
- **Slice 8 — Handler is a thin receiver.** What remains: ingest endpoint + scope + the dispatch
  trigger. Confirm no CS analysis store is read anywhere.

## Non-negotiables
- No CS store/producer is deleted before its capability is fully mapped to Vortex AND verified live.
- Agent-elicited data (what a subagent finds via http_replay/inject_probe) is NOT re-ingested into
  Vortex — it returns to the agent as tool output and, where cross-cutting, is the agent's to report.
- Vortex stays read-only to agents; only Vortex ingest/auto-probe writes it.
