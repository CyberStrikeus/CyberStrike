# Module & Package Architecture

How the platform's packages import across each other, where the boundaries are, and
the rules a contributor (or a future domain author) must follow to stay on the right
side of them. This is the compile-time / import view; for the runtime domain
registration flow see [domain-plugin-architecture.md](./domain-plugin-architecture.md),
for the TUI/Web/Desktop split see [three-surface-architecture.md](./three-surface-architecture.md),
and for third-party domain authoring see [domain-package-authoring.md](./domain-package-authoring.md).

## The three boundary kinds

Every seam in this repo is one of three kinds. Keep them distinct — they fail
differently and are enforced differently.

| Kind | What it is | Enforced by | Example |
|------|-----------|-------------|---------|
| **Module-graph (structural)** | One package exposes two entry points; what you import decides what you can reach | The package's `exports` map + review | Vortex `./agent` vs root |
| **Declaration boundary** | A consumer compiles against generated `.d.ts`, not the producer's source | `tsconfig` + `dist/types` + `turbo ^build:types` | domains → `cyberstrike/public` |
| **Runtime / process seam** | Two processes exchange data at runtime; no shared module graph | the wire format (postMessage / HTTP ingest) | extension → background → server |

## 1. Vortex (`@cyberstrike-io/vortex`)

Vortex is the **deterministic producer**: it parses the corpus, runs the rule engine,
probes, and hands agents pre-computed signals and leads. Agents **consume** it and
change nothing in it — Vortex is read-mostly to agents, and agent probes return
findings without persisting.

### Two entry points — the structural boundary

```
@cyberstrike-io/vortex/agent   → src/agent.ts    the sanctioned AGENT surface
@cyberstrike-io/vortex         → src/index.ts    the ASSEMBLY API (platform-only)
```

- **`/agent`** exposes only the `forAgent(store, sender?)` facade plus
  `agentCapabilities` (framework-neutral tool descriptors: name + description + zod
  input + handler). It never exposes the store, the `RuleRegistry`, the expr compiler,
  or the send-engine internals, so agent-facing code **physically cannot** import past
  it. Guards are baked in (HTTPQL `search` is grep-gated; `send` keeps the
  replay-safety guard).
- **root** is the full assembly API — `SqliteStore`, the rule engine, the prober,
  `send`, adapters. Only the **assembler** imports it.

**Import rule:** agent-facing code imports `@cyberstrike-io/vortex/agent`; only the
platform assembler (`packages/cyberstrike/src/tool/vortex.ts`, which writes the
~10-line `agentCapabilities → Tool.define` adapter) imports the root. The boundary is
structural (it lives in the module graph), reviewable (a root import in agent code is
visible in a diff), and AGPL-clean (the shippable facade is separable from the
assembly internals).

### Coverage model

The engine's auto-probe pass writes the store; the agent tracks its **own** coverage
against the read-only inject-point inventory. The agent never mutates the corpus.

### Packaging trajectory (plan C)

Workspace member now → private npm / compiled-standalone-behind-facade later. The
`/agent` split is the seam that makes that move possible without touching consumers.
See [vortex ARCHITECTURE.md](../packages/vortex/ARCHITECTURE.md) for the engine internals.

## 2. HackBrowser 2.0 (`@cyberstrike-io/hackbrowser`)

An MV3 browser extension that captures real traffic and feeds it into the platform.
The capture → ingest path is a **runtime/process seam**, not a module import.

### Package layout

```
packages/hackbrowser/
  extension/      the MV3 extension (unbundled, loaded directly)
    content.js        isolated-world observer + surface-reveal sweep (#11)
    capture-patch.js  MAIN-world fetch/XHR + native-dialog patch
    background.js     service worker — relays captures to the server
    session-early.js  document_start session hash read
  src/            platform-side helpers
    v2/spawn.ts       exported as "./v2-spawn" (role-profile browser spawn)
    har-ingest.ts     HAR → ingest
```

Only `./v2-spawn` is a package export; the extension is loaded by the browser, not
imported.

### The capture → Vortex seam (must stay intact)

```
page JS ──(fetch/XHR)──▶ capture-patch.js (MAIN world)
                              │ window.postMessage({__cs_capture})
                              ▼
                         content.js (isolated world)
                              │ chrome.runtime.sendMessage
                              ▼
                         background.js (service worker)
                              │ HTTP → server ingest endpoint
                              ▼
                         platform → Vortex store (source: "browser")
```

`content.js` runs the deterministic **surface-reveal sweep** (#11) — expand
disclosures, reveal lazy content, explore modal-gated surface — *before* observing,
so the fuller surface reaches ingest. `capture-patch.js` also neutralizes native
`alert/confirm/prompt` so a blocking dialog never stalls the co-drive loop.

## 3. Security domain packages

Each domain (`@cyberstrike-io/web`, `azure`, `aws`, `gcp`, `re`, planned
oracle/android/ios/internal-network) is its own package that registers a whole domain
— agents, tools, skills, and (cloud) an `AssessmentProvider` — with **zero edits to
core**. Runtime registration is covered in
[domain-plugin-architecture.md](./domain-plugin-architecture.md); the *compile-time*
contract is here.

### The declaration boundary

A domain compiles against core's **generated declarations**, never its deep source:

```jsonc
// packages/<domain>/tsconfig.json
{ "extends": "../../tsconfig.domain.base.json", "include": ["src"] }
```

- `cyberstrike/public` ships as `.d.ts` (`dist/types/public.d.ts`); domains import
  from it and compile against declarations, not source.
- `tsconfig.domain.base.json` is self-contained and sets `skipLibCheck` at the
  declaration boundary so a domain build doesn't re-typecheck all of core.
- `turbo` wires `^build:types` so a domain build waits for core's declarations.

### The building-block kit

Domains share the `input.core.web` **WebKit** (roster/signal-routing/placeholder
helpers) and declare a `CORE_API_VERSION` so a domain built against an older core API
is detectable. `cyberstrike domains list` discovers installed domains via the
`cyberstrike` manifest in each package.json.

**Import rule:** a domain imports `cyberstrike/public` (declarations) and
`@cyberstrike-io/plugin`; it never deep-imports core source. Everything it needs is on
the public surface — if it isn't, the fix is to widen `public.ts`, not to reach past it.

## 4. How they interrelate

`cyberstrike` (the platform) is the **assembler**. It is the only package that:

- imports the Vortex **root** (to assemble the store/engine/prober) and exposes only
  the `/agent` facade to agents;
- drives the HackBrowser capture → ingest seam (server ingest endpoint → Vortex store);
- loads **domain packages** through the plugin loader + provider registry, compiling
  against their declarations.

```
                         ┌─────────────────────────────┐
                         │        cyberstrike          │  the ASSEMBLER
                         │  (TUI / server / assembler) │
                         └──────┬───────────┬──────────┘
         root import (assembly) │           │ declaration boundary
                                ▼           ▼  (cyberstrike/public .d.ts)
                    ┌───────────────────┐  ┌──────────────────────────┐
                    │ @.../vortex       │  │ domain packages          │
                    │  ./agent  (facade)│◀─┤ web · azure · aws · gcp  │
                    │  .        (root)  │  │ re · (oracle/android/…)  │
                    └───────────────────┘  └──────────────────────────┘
                                ▲
                 runtime/process seam (postMessage → HTTP ingest)
                                │
                    ┌───────────────────┐
                    │ @.../hackbrowser  │
                    │  MV3 extension    │
                    └───────────────────┘
```

- **cyberstrike → vortex:** root import (structural boundary — agents get `/agent`).
- **domains → cyberstrike:** declaration boundary (`cyberstrike/public` as `.d.ts`).
- **hackbrowser → cyberstrike:** runtime/process seam (no shared module graph; the
  wire format is the contract).

## Answers this doc guarantees

- *"If I write agent-facing code, what may I import from Vortex?"* — only
  `@cyberstrike-io/vortex/agent` (`forAgent` + `agentCapabilities`). The root is
  assembler-only.
- *"If I add a new security domain, what is the package/tsconfig contract?"* —
  `{ "extends": "../../tsconfig.domain.base.json", "include": ["src"] }`, import
  `cyberstrike/public` (declarations) + `@cyberstrike-io/plugin`, declare the
  `cyberstrike` manifest and `CORE_API_VERSION`, never deep-import core source.
