# Domain Plugin Architecture — `npm install @cyberstrike/<domain>`

> Goal: an installed npm package (e.g. `@cyberstrike/aws`) auto-registers a whole
> security domain — its main agent, sub-agents, tools, and deterministic signal
> fabric — into CyberStrike with **zero edits to core**, and is updatable via npm.
> Same ergonomics as adding an MCP server today.

## Where we are (code-verified findings)

| # | Finding | Consequence |
|---|---------|-------------|
| F1 | Plugin SDK is in-repo: `packages/plugin/src/index.ts`, consumed from **source** (`exports: "./src/index.ts"`) | Adding a hook takes effect immediately — no dist build step |
| F2 | The plugin loader already does `BunProc.install(pkg,version)` → `import()` → collect `Hooks` (`plugin/index.ts`) | The npm-install-and-load half **already exists** (the MCP-like mechanism) |
| F3 | Hooks contract has `auth`, `event`, `tool`, `config`, `shell.env` — **no `provider`/agents hook** | A plugin can contribute tools but **not agents / a domain** |
| F4 | `agent.ts:334-338` hardcodes `new AzureProvider()` + `await WebProvider.create()` | No provider registry — adding a domain means editing core |
| F5 | `signal/ingest.ts` imports `DETECTORS` + `new SignalRouter()` **directly**; `provider.detectors()/signalRouter()` are never consumed | Signal fabric is a **facade** hardcoded to web — multi-domain signals need real wiring |
| F6 | `cloud/orchestrate.ts` takes `provider: AssessmentProvider` as a param | The "assessment" workflow is already provider-parametric; web ingest is NOT (hardcoded `hunt-agent`) |
| F7 | `buildClassAgentMap`, `renderRoster`, `renderSignalRoutingTable`, `assertSignalCoverage`, `injectPlaceholder` live in `provider-web.ts` | A new domain would copy-paste them unless they move to a shared kit |

## Target end-state flow

```
npm install @cyberstrike/aws
  → cyberstrike.json  "plugin": ["@cyberstrike/aws"]
  → plugin loader (EXISTS): install + import + collect hooks
  → NEW `provider` hook returns AwsProvider
  → ProviderRegistry: [web, azure, aws]
  → agent.ts: specsToAgents() over the registry → aws-orchestrator + aws-* sub-agents appear
  → signal fabric resolves aws detectors+router for aws sessions
  → aws entry-point triggers aws-orchestrator (agentic loop, parallel sub-agent dispatch)
```

## Phases

### Phase 1 — Provider registration seam (agent-system integration) [FOUNDATION]
- Add `provider?: () => MaybeArray<DomainProviderFactory>` to the SDK `Hooks` type.
- New `cloud/provider-registry.ts`: collects built-in providers (web, azure) + providers
  contributed via `Plugin` hooks. Handles sync (`new AzureProvider()`) and async
  (`WebProvider.create()`) factories. One provider failing must not break the others
  (preserve the current per-provider try/catch).
- Rewire `agent.ts`: replace the two hardcoded provider loads with a loop over the registry.
- Tests: a fake plugin provider's agents appear; web+azure still load; a throwing provider is skipped.
- **Independent of the Phase 4 fork — safe to build first.**

### Phase 2 — Shared domain-provider kit (no copy-paste)
- Extract F7's helpers out of `provider-web.ts` into a shared kit (or `BaseDomainProvider`).
- Refactor `WebProvider` onto it — behavior-preserving (byte-diff the composed orchestrator prompt).
- AWS's provider composes its roster + routing table from the same kit.

### Phase 3 — Signal fabric per-domain (domain-system integration)
- Make `signal/ingest.ts` provider-aware: resolve the session's domain → that domain's
  detectors + router, instead of the global `DETECTORS`/`new SignalRouter()` (F5).
- Sessions/entry-points must carry a domain key; the fabric looks up the provider by key.
- Web behavior must be byte-preserved (web session → web detectors exactly as today).

### Phase 4 — Entry-point / workflow registration [DECISION NEEDED]
Two models, pick per domain:
- **(a) Assessment-style** — reuse `cloud/orchestrate.ts` (provider param), AWS as an
  `AssessmentProvider` (batch scan + verify, like Azure).
- **(b) Own workflow** — the provider declares its own entry (ingest route / CLI / trigger),
  like web's per-request ingest loop.
- **Open question for AWS:** batch assessment (a) or its own live loop (b)?

### Phase 5 — Update / versioning / config UX
- `BunProc.install(pkg, version)` already supports versions (F2).
- Add `cyberstrike plugin add/remove/update @cyberstrike/aws`, version pin/upgrade,
  `list installed domains`; surface a failed provider load (existing Bus error path).

### Phase 6 — Authoring docs + contract test
- "Domain provider authoring" doc: what a package must export.
- Contract test over every registered provider: unique agent names across domains (no
  collisions), signal coverage (`assertSignalCoverage`), valid roles.

## Contact surface — every way a domain package can touch the core

A small example only exercises "add a new agent". Big domains (Azure, GCP, Oracle,
mobile) need more. This is the full map of attachment points, honestly marked, so
we know what the core contract must expose BEFORE a big domain fits — not after.

| # | Contact point | Mechanism | Status |
|---|---------------|-----------|--------|
| C1 | **Add new agents** (main + sub-agents) | `provider` hook → `agentSpecs()` → registry | ✅ DONE, e2e tested (real local plugin) |
| C2 | **Add new callable tools** | `tool` hook → `ToolRegistry` (`registry.ts:113`); agents allow them by name | ✅ EXISTS (host wiring present) |
| C3 | **Permission / rule-sets** for its agents | `specsToAgents` merges defaults + spec + user | ✅ works |
| C4 | **Report / triage integration** — its agents report findings | shared `report_vulnerability` + `vuln-scope` lane taxonomy | ⚠️ PARTIAL — a new domain's vuln classes have NO lane entry, so its agents are unscoped (like llm/misconfig/recon today). Lane taxonomy must accept per-domain classes. |
| C5 | **Modify an EXISTING agent** (change a built-in agent's prompt/perms/model, extend its tools) | `cfg.agent` config loop (`agent.ts:401`) — config only | ⚠️ config-driven, NOT exposed to a plugin. A package cannot extend hunt-injection's tools or the web orchestrator via the hook. |
| C6 | **Add a sub-agent INTO an existing agent's structure** (e.g. a new hunt-* under the web orchestrator) | — | ❌ NO mechanism. Agents are a flat, name-keyed set; a collision fails. The orchestrator roster is rendered from ITS OWN provider's specs, so a foreign sub-agent isn't surfaced to it. |
| C7 | **Change an existing tool's capability** | `tool.definition` hook (edit description/params) exists in SDK | ⚠️ PARTIAL — can reshape a tool's definition, cannot extend its execution logic. |
| C8 | **Cross-agent / cross-domain communication** (which agent may dispatch/talk to which) | `task` tool resolves ANY registered agent by name (mechanically cross-domain) + orchestrator roster + `vuln-scope` dispatch lanes | ⚠️ PARTIAL — mechanically a web orchestrator CAN `task` an aws agent, but its rendered roster lists only its own domain, so it never knows to. Cross-domain dispatch/chaining is unsurfaced. |
| C9 | **Signal fabric** (deterministic detectors + routing) | `provider.detectors()/signalRouter()` | ❌ FACADE — `signal/ingest.ts` imports web `DETECTORS`/`SignalRouter` directly; never consumed through the provider (Phase 3). |
| C10 | **Workflow entry-point** (how its assessment is triggered) | tool-triggered (`azurehook` → `orchestrateLayer2(new AzureProvider())`) or the web ingest route | ❌ NOT pluggable — entry is hardcoded per domain; the `provider` hook carries only `DomainProvider`, not the `AssessmentProvider` orchestrate needs (Phase 4). |

### What a SMALL test package proves vs. what it does NOT
- **Proves:** C1, C2, C3 — an installed package contributes agents + tools + rules and they appear (registry + health).
- **Does NOT prove:** C4–C10. A big domain like Azure needs C4 (report lanes for cloud classes), C9 (its own signal detectors), C10 (its assessment workflow driven through the plugin path), and possibly C5/C6/C8 (touching or chaining with existing domains). Passing a small example is necessary but NOT sufficient for "Azure will fit."

### Readiness verdict for a real package
- **Thin, self-contained domain (agents+tools+rules only):** READY now — this is the (b) test.
- **Azure / GCP / Oracle (full assessment domains):** NOT ready — blocked on C4 (per-domain lanes), C9 (Phase 3 signal fabric), C10 (Phase 4 pluggable workflow), plus extracting each domain's host-internal machinery (Azure alone: 8 internal deps + its `azurehook` workflow entry).

## Package dependency model — SDK is NOT enough; a workflow needs the core runtime

A domain provider calls core RUNTIME services, not just types. Azure's provider uses
`Intel.get()`, `triageGuide()/triageActions()`, and its workflow entry uses
`orchestrateLayer2()` — behavior, which a types-only SDK cannot supply. So:

```
@cyberstrike-io/azure (workflow package)
   ├── peerDep @cyberstrike-io/plugin       (SDK = CONTRACT: types + hook shapes)
   └── peerDep @cyberstrike-io/cyberstrike   (CORE = RUNTIME: Intel, Session,
                                              orchestrateLayer2, registry, vuln-status)
```

A package pins compatible **core + SDK** versions; the core version is the runtime
compatibility boundary ("SDK upgrade → core upgrade"). Mismatch → health `✗ incompatible`,
not a crash.

### Azure extraction map (code-verified)
| Azure dep | Kind | Destination |
|-----------|------|-------------|
| `cloud/groups` (CLOUD_GROUPS) | azure data | → package |
| `cloud/classify` (azure `Finding`) | azure logic | → package |
| `tool/azurehook/assess-cache` | azure tool internal | → package (with azurehook) |
| 4 azure prompts | azure content | → package |
| `cloud/types` (CloudAnalysis) | types | package or SDK (types) |
| `methodology/intel` (`Intel.get`) | **core runtime** | stays core → public API |
| `session/vulnerability-status` (`triageGuide/Actions`) | **core runtime** | stays core → public API |
| `cloud/orchestrate` (`orchestrateLayer2`) | **core runtime** | stays core → public API |

### Core must expose a curated public API
These runtime services are internal modules today (`../methodology/intel`, `../session/…`).
For a package to import them, core exports a curated, versioned surface (`src/public.ts`):
`Intel`, `triageGuide/triageActions`, `orchestrateLayer2`, `registerProvider/resolveProvider`,
`isAssessmentProvider`, `AssessmentProvider`, `CloudAnalysis` types + the SDK contract re-exported.
This public surface IS the core side of the version boundary — internal modules stay private.

### Revised build order
1. **Core public API surface** (`src/public.ts` + package `exports`) — the runtime boundary.
2. Extract azure-specific code into a package shape (groups, classify, azurehook, prompts).
3. `@cyberstrike-io/azure`: peerDep core + SDK; export `provider` + `tool` hooks.
4. Private org → publish + `.npmrc` + restricted-access CI.

## Azure extraction — staged (in progress)

The azure cluster is large and woven into core, so the move is staged; the tree
stays green at every step.

**Cluster to move → `packages/azure-ent` (`@cyberstrike-io/azure`)** — code-verified,
all azure-specific, moves as ONE unit:
`cloud/provider-azure.ts`, `cloud/groups.ts`, `cloud/classify.ts`, `tool/azurehook/`
(16 files + `assess/`, incl. `assess-cache` + `shared`), `tool/assess-findings.ts`,
`tool/cloud-intel.ts` (both azure — use CLOUD_GROUPS + Finding + getAssessResult),
`agent/prompt/cloud/*.txt` (4 prompts). `assess-cache` moves too (both its reader
provider-azure and writer azurehook move together).

**Stays in core, reached via `cyberstrike/public` (all exposed ✅):** the registry,
`orchestrateLayer2`, `isAssessmentProvider`, `CloudAnalysis`, `Intel`, `Session`,
`Vulnerability`, `VulnStatus`, `triageGuide/triageActions`, `isActionable/isExcluded`,
the version check + SDK contract.

**Tool conversion:** azurehook/assess-findings/cloud-intel are core `Tool.define`; in the
package they become SDK `tool` hook entries (`args` raw shape, `execute → string` + set
rich metadata via `context.metadata(...)` — the SDK ToolContext already carries it, so no
metadata is lost and no SDK change is needed).

**Core reference points to flip (the atomic cut-over, last):**
`cloud/provider-registry.ts` (drop the azure built-in), `tool/registry.ts:239` (drop
`AzurehookTool` from built-ins — comes via the package `tool` hook), `cloud/index.ts`
(drop azure re-exports).

**Move order:** ① scaffold ✅ ② decouple azurehook → provider-azure ✅ ③ expand
`cyberstrike/public` ✅ ④ THE MOVE ✅ (relocated the cluster to `packages/azure-ent/src`,
rewired to `cyberstrike/public`, converted the 3 tools to the SDK `tool` hook, removed azure
from core — registry built-in, 4 tools in tool/registry, cloud/index re-exports; decoupled
`ClassifiedGroup` into `CloudAnalysis`) ⑤ migrate azure tests → N/A (core had no azure unit
tests; the registry/health tests were updated to reflect azure-is-a-package) ⑥ verify azure
runs from the package ✅.

> **EXTRACTION COMPLETE.** Azure is no longer in core; it is `@cyberstrike-io/azure`,
> registering via the plugin `provider` + `tool` hooks and reaching core only through
> `cyberstrike/public`. End-to-end verified: azure resolves from the package (13 agents,
> 9 groups, isAssessmentProvider, 4 tools). Core all-green (tsc 0, 2308 pass, 3 pre-existing
> fails). Remaining for the publish milestone: core ships a built `dist`+`.d.ts` for
> `cyberstrike/public` (so external `tsc` resolves it — runtime already works), then publish
> `@cyberstrike-io/azure` to the private registry.

### Step ① done — scaffold verified at runtime
`packages/azure-ent` exists: package.json (peerDeps `cyberstrike` + `@cyberstrike-io/plugin`,
`private`), tsconfig, `src/index.ts` (plugin default: `requireCoreApi("1.0.0")` + a
`provider` hook). Runtime-verified: it resolves `cyberstrike/public`, passes the version
check, and returns the azure domain hook.

### Packaging finding — core must ship built types for external typecheck
`cyberstrike`'s `exports` map raw source (`./*: ./src/*.ts`). At RUNTIME bun resolves it
(including core's `@/` aliases via tsconfig paths) — the scaffold runs. But isolated
`tsc` of a consumer pulls core's raw source and cannot resolve `@/` aliases or core's own
strictness. So an external package cannot cleanly typecheck against core today. Fix
(pre-publish): core exposes a **built dist + `.d.ts`** entry for `cyberstrike/public`
(a `types`/`exports` to dist), not raw src. Runtime already works; this is a build-config
task for the publish milestone.

## Invariants (do not compromise)
1. Zero core edits to add a domain — the `provider` hook is the only surface.
2. A broken/incompatible plugin degrades gracefully (skipped + surfaced), never crashes core.
3. Agent-name uniqueness across domains is enforced at registration (fail-fast on collision).
4. Web + Azure behavior is byte-preserved through the refactor (they become the first two
   registry entries, not special cases).
