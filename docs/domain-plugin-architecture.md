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

## Invariants (do not compromise)
1. Zero core edits to add a domain — the `provider` hook is the only surface.
2. A broken/incompatible plugin degrades gracefully (skipped + surfaced), never crashes core.
3. Agent-name uniqueness across domains is enforced at registration (fail-fast on collision).
4. Web + Azure behavior is byte-preserved through the refactor (they become the first two
   registry entries, not special cases).
