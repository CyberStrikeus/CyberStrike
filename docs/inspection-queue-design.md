# Inspection Queue — Domain-Agnostic OO Design

Issue: #19 (to be opened)

## Problem

The current `WebRetest` namespace + `RetestWorker` is:
1. **Misnamed**: "retest" implies a second pass; this IS the first (and only) test dispatch
2. **Namespace-based**: static functions + module-scoped Maps — no isolation, no testability
3. **Web-only**: hardcoded to web's flag types (`signal`, `credential`, `role`, `object_value`)
4. **No completion signal**: when the queue drains, nothing announces "testing complete"
5. **Not extensible**: every future domain (mobile, API, network, LLM) would need its own copy

## Current Architecture

```
POST /request → ingest → Vortex → WebRetest.flag()
                                        ↓
                              web_retest_queue (SQLite)
                              key_hash | status | flags
                                        ↓ Bus: web_retest.updated
                              RetestWorker.loop()
                              → resolveAgents(flags) → dispatch(child session)
                                        ↓
                              Sub-agent sessions (hunt-authz, hunt-injection, ...)
```

Cloud has a completely different model — batch pipeline in `orchestrate.ts` with
`OrchestrationState.phase` tracking. Not queue-based.

## Observation: Two Dispatch Models

| | Web (streaming) | Cloud (batch) |
|---|---|---|
| **Input** | Continuous traffic flow | One-shot asset inventory |
| **Trigger** | Each new flag → wake | `startAssessment()` once |
| **Queue** | Per-endpoint, flag accumulation | Per-group, fixed set |
| **Re-open** | New evidence re-opens examined | No re-open concept |
| **Parallelism** | Semaphore(N) concurrent agents | Semaphore(N) concurrent agents |
| **Completion** | Queue empty + sources idle | Phase reaches "complete" |
| **Lifecycle** | None (the gap) | `OrchestrationState.phase` |

**Shared**: both dispatch specialist agents to test surfaces, both track what's been examined,
both need a completion signal, both run under concurrency control.

## Design

### Where It Lives

```
packages/plugin/src/inspection.ts    — contract interfaces (InspectionTarget, InspectionRouter)
packages/cyberstrike/src/inspection/  — runtime implementation
  queue.ts                            — InspectionQueue class
  dispatcher.ts                       — InspectionDispatcher class
  lifecycle.ts                        — SessionLifecycle (multi-source idle detection)
```

The **contract** (interfaces) goes in `@cyberstrike-io/plugin` so domain packages can type
against it without importing the host. The **runtime** stays in `cyberstrike` (DB access,
Bus, Session).

### Core Abstractions

```typescript
// ── packages/plugin/src/inspection.ts ──

/** A testable surface: an endpoint, a cloud resource, a mobile screen, etc. */
interface InspectionTarget {
  /** Stable identity key (dedups). Web: key_hash. Cloud: resource ARN. */
  key: string
  /** Human label. Web: "GET /api/v1/users". Cloud: "S3 bucket prod-data". */
  label: string
  /** Domain-specific metadata the router needs to choose specialists. */
  meta: Record<string, unknown>
}

/** One piece of evidence that a target should be (re)inspected. */
interface Evidence {
  type: string                    // domain-defined: "signal", "credential", "role", ...
  value: string                   // the specific item: "cors:misconfig", cred ID, ...
  priority: "high" | "medium" | "low"
  /** When true, this evidence type accumulates but does NOT re-open an examined target.
   *  Web: object_value (UUIDs churn; first IDOR pass is representative). */
  accumulateOnly?: boolean
}

/** Domain-specific routing: evidence → which specialists test this target. */
interface InspectionRouter {
  /** Given a target + its accumulated evidence, return the specialist agent names. */
  resolve(target: InspectionTarget, evidence: Evidence[]): string[] | Promise<string[]>
  /** Build the dispatch prompt for a specialist on this target. */
  prompt(target: InspectionTarget, evidence: Evidence[], agent: string): string
}
```

### InspectionQueue (runtime, generic)

```typescript
// ── packages/cyberstrike/src/inspection/queue.ts ──

class InspectionQueue {
  constructor(
    private sessionID: string,
    private domain: string,         // "web", "azure", "mobile", ...
  ) {}

  /** Add evidence to a target. Creates the target if new; re-opens if examined
   *  (unless accumulateOnly). Returns true if the queue state changed. */
  flag(target: InspectionTarget, evidence: Evidence): boolean

  /** Flag every target in the session matching a predicate (session-wide triggers:
   *  new credential, new role). */
  flagMatching(evidence: Evidence, match: (t: InspectionTarget) => boolean): number

  /** Pending targets, highest priority first. */
  pending(): InspectionTarget[]

  /** Mark a target examined + snapshot its current evidence. */
  markExamined(key: string): void

  /** Counts. */
  count(): { pending: number; examined: number; total: number }

  /** True when pending === 0. */
  isEmpty(): boolean

  /** Evidence accumulated for one target (for dispatch prompts). */
  evidenceFor(key: string): Evidence[]

  /** Observable events. */
  on(event: "flagged" | "examined" | "drained" | "reopened", cb: Callback): Unsubscribe
}
```

**Storage**: Same SQLite table, renamed `inspection_queue`. Schema:

```sql
CREATE TABLE inspection_queue (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,             -- "web", "azure", "mobile", ...
  target_key TEXT NOT NULL,         -- stable identity
  target_label TEXT,                -- human-readable
  target_meta TEXT,                 -- JSON, domain-specific
  status TEXT NOT NULL,             -- "pending" | "examined"
  priority TEXT NOT NULL,           -- "high" | "medium" | "low"
  evidence TEXT NOT NULL,           -- JSON, accumulated
  examined_evidence TEXT,           -- JSON, snapshot at examine time
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
CREATE UNIQUE INDEX inspection_queue_target_idx ON inspection_queue(session_id, domain, target_key);
CREATE INDEX inspection_queue_status_idx ON inspection_queue(session_id, domain, status);
```

### InspectionDispatcher (runtime, generic)

```typescript
// ── packages/cyberstrike/src/inspection/dispatcher.ts ──

class InspectionDispatcher {
  constructor(
    private queue: InspectionQueue,
    private router: InspectionRouter,
    private options: {
      concurrency: number           // default 3
      timeoutMs?: number            // per-dispatch cap (0 = no cap)
    }
  ) {}

  /** Subscribe to queue events and start draining. Idempotent. */
  start(): void

  /** Wake the drain loop (called when new evidence arrives). */
  wake(): void

  /** True while the loop is actively dispatching agents. */
  isRunning(): boolean

  /** Observable events. */
  on(event: "dispatching" | "idle", cb: Callback): Unsubscribe
}
```

### SessionLifecycle (multi-source idle detection)

The hard part. "Test complete" requires ALL of these:
1. Queue is empty (no pending targets)
2. Dispatcher is not running (no in-flight agent spawns)
3. All activity sources are idle (no new evidence expected)

```typescript
// ── packages/cyberstrike/src/inspection/lifecycle.ts ──

/** Something that produces work for the inspection queue. */
interface ActivitySource {
  name: string                      // "crawler", "api-probe", "vortex-ingest", ...
  isActive(): boolean               // true while it could still produce evidence
}

class SessionLifecycle {
  constructor(
    private sessionID: string,
    private queue: InspectionQueue,
    private dispatcher: InspectionDispatcher,
  ) {}

  /** Register a source that feeds evidence to the queue. */
  registerSource(source: ActivitySource): void

  /** Current phase, derived from component states. */
  phase(): SessionPhase

  /** Observable. */
  on(event: "phase-change", cb: (phase: SessionPhase) => void): Unsubscribe
}

type SessionPhase =
  | "idle"          // nothing started
  | "discovering"   // at least one source is active, queue may be empty
  | "inspecting"    // queue has pending items OR dispatcher is running
  | "draining"      // sources idle, queue draining (no new evidence expected)
  | "complete"      // sources idle + queue empty + dispatcher idle
```

### Phase Derivation Logic

```
if (no sources registered)                    → "idle"
if (any source.isActive())                    → "discovering" (even if queue is draining)
if (queue.pending > 0 || dispatcher.running)  → "inspecting"
if (!any source.isActive() &&
    queue.pending > 0 || dispatcher.running)  → "draining"
if (!any source.isActive() &&
    queue.isEmpty() && !dispatcher.running)   → "complete"
```

With a grace period: after all sources go idle + queue drains, wait N seconds before
declaring "complete" (a late flag can still arrive from a slow agent's discovery).

### Activity Sources per Domain

**Web domain:**
| Source | `isActive()` |
|--------|-------------|
| CoDrive (crawler) | `CoDrive.isRunning(sessionID)` |
| ApiProbe | sweep in progress |
| Vortex ingest | last ingest < 5s ago |
| IngestQueue | pending > 0 |
| RoleQueue | has un-captured roles |

**Cloud domain:**
| Source | `isActive()` |
|--------|-------------|
| Asset discovery | scan phase running |
| OrchestrationState | phase !== "complete" |

**Future mobile domain:**
| Source | `isActive()` |
|--------|-------------|
| Screen crawler | exploring |
| Frida hook | injecting |
| Traffic interceptor | active |

### Migration Path

1. **Create** `InspectionQueue` + `InspectionDispatcher` + `SessionLifecycle` in host
2. **Adapt** `WebRetest` → thin wrapper that delegates to `InspectionQueue` (domain="web")
3. **Adapt** `RetestWorker` → `InspectionDispatcher` with web's `InspectionRouter`
4. **Rename** DB table `web_retest_queue` → `inspection_queue` (migration)
5. **Wire** activity sources for web domain
6. **Expose** `SessionLifecycle.phase()` to TUI sidebar + `web_get_session_context`
7. **Delete** old WebRetest namespace + RetestWorker namespace

Steps 2-3 are backward-compatible: same behavior, new internals.

### TUI Impact

Sidebar "Retest Queue" section becomes **"Inspection Queue"** with a phase indicator:

```
▼ Inspection Queue (3 pending · inspecting)
  • H  POST /api/v1/chat           [2c 3s]
  • M  GET /api/v1/users/{id}      [1c 1r 2o]
  • L  GET /api/v1/tasks/search    [4s]
```

When phase is "complete":
```
✓ Inspection Complete (189 examined)
  14 high · 13 medium · 36 low · 1 info
```

When phase is "discovering" and queue is empty:
```
◌ Discovering... (0 queued, 12 examined)
```

### Agent Context Impact

`web_get_session_context` tool's `retest_queue` section becomes `inspection_queue`:

```json
{
  "inspection_queue": {
    "phase": "inspecting",
    "pending": 3,
    "examined": 186,
    "total": 189,
    "items": [...]
  }
}
```

### Multi-Domain / Multi-Tier / Multi-Workflow Dispatch

Three independent dimensions affect which agents handle a target:

```
Domain    → WHAT can be tested    (web endpoints, mobile screens, cloud resources)
Tier      → WHICH agents exist    (free: 4 basic, pro: 10+ advanced, enterprise: full)
Workflow  → HOW to behave         (pentest: comprehensive, bug-bounty: impact-first)
```

**The dispatcher knows NONE of these.** It calls `router.resolve()` and dispatches
whatever comes back. All three dimensions collapse into the router, which the domain
provides.

#### Where Each Dimension Lives

```
┌─────────────────────────────────────────────────────────────────┐
│ DomainProvider (the package: @cyberstrike-io/web, /mobile, ..) │
│                                                                 │
│  agentSpecs()         → the roster (tier determines which)     │
│  specialistClasses()  → class→agent map (tier determines who)  │
│  createRouter()       → InspectionRouter (all 3 baked in)      │
│                                                                 │
│  Tier lives HERE:                                               │
│    @cyberstrike-io/web        = free (hunt-authz owns authz)   │
│    @cyberstrike-io/web-pro    = paid (web-authorization owns)  │
│    Same interface, different package, different roster.         │
│                                                                 │
│  Workflow lives HERE too:                                       │
│    router.resolve() can weight by workflow context              │
│    router.prompt() can inject workflow-specific instructions    │
└─────────────────────────────────────────────────────────────────┘
              │
              │ createRouter(context)
              ▼
┌─────────────────────────────────────────────────────────────────┐
│ InspectionRouter (domain-provided, opaque to dispatcher)        │
│                                                                 │
│  resolve(target, evidence) → ["web-authorization", "hunt-inj"] │
│  prompt(target, evidence, agent) → dispatch prompt string       │
│                                                                 │
│  Internally uses:                                               │
│    - specialistClasses map (from its domain's roster)           │
│    - evidence type → class routing (signal:owner → class)      │
│    - surface predicates (isInjectionSurface, isAccessControl)  │
│    - workflow config (bug-bounty skips low-prio, etc.)          │
└─────────────────────────────────────────────────────────────────┘
              │
              │ router.resolve() returns agent names
              ▼
┌─────────────────────────────────────────────────────────────────┐
│ InspectionDispatcher (generic, domain-agnostic)                 │
│                                                                 │
│  Knows: queue, router, concurrency, timeout                    │
│  Does: pop pending → router.resolve() → spawn child session    │
│  Does NOT know: domain, tier, workflow, agent internals         │
└─────────────────────────────────────────────────────────────────┘
```

#### DomainProvider Contract Extension

```typescript
// ── packages/plugin/src/provider.ts ──

interface DomainProvider {
  key: string
  agentSpecs(): AgentSpec[]
  specialistClasses?(): Record<string, string>

  /** Create a router for the inspection dispatcher. The domain owns the routing
   *  logic — which evidence patterns map to which specialists — so the host's
   *  dispatcher stays domain-agnostic. Context carries session-level config
   *  (workflow, scope) the router may use to adjust priorities or skip classes. */
  createRouter?(context?: RouterContext): InspectionRouter
}

interface RouterContext {
  workflow?: "pentest" | "bug-bounty" | "compliance" | "recon"
  scope?: { include?: string[]; exclude?: string[] }  // URL patterns, resource ARNs, ...
}
```

#### How Different Tiers Work (No Runtime Flag Needed)

The tier difference is the **package itself**, not a runtime flag:

| Package | Tier | authorization class owner | input-validation owner |
|---------|------|--------------------------|----------------------|
| `@cyberstrike-io/web` | free | `hunt-authz` | `hunt-injection` |
| `@cyberstrike-io/web-pro` | pro | `web-authorization` | `web-input-validation` |

Both implement `DomainProvider`. Both have a `createRouter()` that uses their own
`specialistClasses()`. The host installs one or the other — `DEFAULT_DOMAINS` in the
plugin loader picks it up. No if/else in the dispatcher.

This already works today: `WEB_AUTHORIZATION` / `WEB_INPUT_VALIDATION` flags in
`provider-web.ts` toggle who owns the class. The only change is moving that toggle
from compile-time flags to separate packages (free vs pro).

#### How Workflows Work

The workflow doesn't change WHICH agents exist — it changes HOW the router behaves:

```typescript
// Inside WebInspectionRouter (domain-provided):

resolve(target: InspectionTarget, evidence: Evidence[]): string[] {
  const agents = this.resolveByEvidence(target, evidence)

  if (this.workflow === "bug-bounty") {
    // Bug bounty: skip low-severity-only targets, prioritize impact
    if (target.meta.onlyLowSignals && !this.hasHighImpactEvidence(evidence))
      return []
  }

  if (this.workflow === "compliance") {
    // Compliance: ALWAYS include config-deployment specialist
    const configAgent = this.classMap.get("config-deployment")
    if (configAgent) agents.add(configAgent)
  }

  return [...agents]
}

prompt(target: InspectionTarget, evidence: Evidence[], agent: string): string {
  const base = this.buildBasePrompt(target, evidence, agent)

  if (this.workflow === "bug-bounty") {
    return base + "\n\nFocus on IMPACT. Skip informational findings. " +
      "Prioritize: RCE > auth bypass > data leak > IDOR > XSS."
  }

  if (this.workflow === "compliance") {
    return base + "\n\nMap findings to compliance controls (PCI-DSS, SOC2). " +
      "Document remediation steps for each finding."
  }

  return base
}
```

#### Multi-Domain Session

A session can run multiple domains simultaneously (e.g., web + API + cloud):

```
Session
  ├── InspectionQueue(domain="web")     + WebRouter     + Dispatcher
  ├── InspectionQueue(domain="api")     + ApiRouter     + Dispatcher
  └── InspectionQueue(domain="cloud")   + CloudRouter   + Dispatcher
                    │
                    └── SessionLifecycle aggregates all queues
                        phase = "complete" only when ALL queues are empty
                        AND all sources across all domains are idle
```

Each domain's queue is independent — web evidence doesn't leak into cloud's queue.
The `SessionLifecycle` watches all of them.

#### Concrete Example: Same Endpoint, Three Workflows

Target: `POST /api/v1/users/{id}` with evidence `[signal:cors, credential:admin, role:viewer]`

| Workflow | Router returns | Prompt suffix |
|----------|---------------|---------------|
| pentest | `[web-authorization, hunt-injection, hunt-misconfig]` | (none — full test) |
| bug-bounty | `[web-authorization]` | "Focus on BOLA/privilege escalation impact" |
| compliance | `[web-authorization, config-deployment]` | "Map to PCI-DSS 6.5.x controls" |

Same dispatcher, same queue, same evidence. Different behavior because the router
is workflow-aware.

### What This Enables for Future Domains

A new domain (e.g. `@cyberstrike-io/mobile`) only needs to:

1. Define its `InspectionRouter` (which specialists test which evidence)
2. Register its `ActivitySource`s
3. Call `queue.flag()` when it discovers testable surfaces
4. Optionally: handle `RouterContext.workflow` for workflow-specific behavior

The queue mechanics, dispatch concurrency, lifecycle detection, TUI rendering,
and agent context injection are all shared infrastructure. The domain package is a
self-contained unit: different package = different tier, same interface.
