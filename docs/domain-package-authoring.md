# Authoring a CyberStrike Domain Package

Build a security domain — its agents, tools, and skills — as an npm package that
CyberStrike loads as a **native, deterministic** part of its agentic flow. Same
ergonomics as adding an MCP server (`npm install`), but the package integrates as
a first-class domain, not as an MCP tool server (see [Native, not MCP](#native-not-mcp)).

`@cyberstrike-io/azure` is the reference implementation — read `packages/azure`
alongside this guide.

---

## 1. The principle: native and deterministic

CyberStrike's value is a **deterministic** agentic structure: a provider registry,
a signal fabric that routes findings by rule (not by an LLM's whim), structured
sub-agent dispatch, and coverage tracking. A domain package plugs INTO that
structure:

- its agents are real entries in the agent registry,
- its tools are real deterministic tools the agents call,
- its findings feed the same signal fabric and reports.

The host never treats your package as an opaque tool server. That is what keeps
the flow deterministic.

---

## 2. The two surfaces you connect through

| Surface | What it is | How you get it |
|---------|-----------|----------------|
| **SDK — `@cyberstrike-io/plugin`** | The CONTRACT: hook shapes + types (`Hooks`, `PluginInput`, `AgentSpec`, `DomainProvider`, `ToolDefinition`, `tool()`). | A normal npm dependency of your package. |
| **`input.core`** | The live core RUNTIME the host injects when it loads you: the registry, session/vuln stores, orchestration, and the reusable building blocks (HTTP replay, signal fabric, ...). | Passed to your plugin's default export as `input.core`. |

**Why injection, not `import "cyberstrike/..."`:** the host ships as a compiled
binary; an installed package can't resolve the host's modules. Your package runs
IN the host process, and the host hands you its live functions through `input.core`
— in-process references that work in the `.exe` on every OS. You import only the
TYPE of the runtime (`import type { CoreRuntime } from "cyberstrike/public"`),
which is erased at build time and needs no runtime resolution.

---

## 3. Package setup

```jsonc
{
  "name": "@your-scope/mydomain",
  "type": "module",
  "exports": { ".": "./src/index.ts" },   // ship TS source; the Bun host runs it
  "files": ["src"],
  "cyberstrike": {                         // ← the manifest: how the host discovers you
    "coreApi": "1.2.0",                    //   minimum core API you need (>=)
    "domains": ["mydomain"],               //   domain keys you register (informational)
    "tools": ["my_tool"],                  //   tool ids you contribute (informational)
    "tier": "pro"                          //   "free" | "pro" (informational)
  },
  "dependencies": {
    "@cyberstrike-io/plugin": "^1",         // the SDK (contract)
    "zod": "^4"                             // declare EVERY dep you import (see note)
  },
  "peerDependencies": { "cyberstrike": "*" },       // the host, provided at runtime
  "peerDependenciesMeta": { "cyberstrike": { "optional": true } },
  "publishConfig": { "access": "restricted" }        // "public" for a free tier
}
```

> **Declare every dependency you import** — `zod` especially. It must be the same
> major as core (v4); if you import it but don't declare it, resolution can walk up
> and find a stray older copy, and core's `z.toJSONSchema` on your tool's args then
> throws at agent init. Match core's zod (v4).

The `cyberstrike` manifest is what makes `npm install` "just work": the host
scans your project's `node_modules`, finds packages carrying this field, checks
`coreApi` against the running host BEFORE importing you, and auto-loads the
compatible ones — no plugin config entry needed (see §9). The manifest is a
declaration for discovery + listing; the real registration still happens when
your default export runs and returns its hooks.

Your plugin is a default export `(input) => Promise<Hooks>`:

```ts
// src/core.ts — a tiny holder so the rest of the package reaches core lazily.
import type { CoreRuntime } from "cyberstrike/public"
let _core: CoreRuntime | undefined
export function setCore(c: CoreRuntime) { _core = c }
export function core(): CoreRuntime {
  if (!_core) throw new Error("core runtime not injected yet")
  return _core            // read at CALL time — never destructure members at module top
}
```

```ts
// src/index.ts — the plugin default export.
import type { Hooks, PluginInput } from "@cyberstrike-io/plugin"
import type { CoreRuntime } from "cyberstrike/public"
import { setCore, core } from "./core"

export default async function myDomain(input: PluginInput): Promise<Hooks> {
  setCore(input.core as CoreRuntime)   // capture the injected runtime FIRST
  core().requireCoreApi("1.1.0")       // then refuse to load against an incompatible host
  return {
    provider: { mydomain: () => new MyProvider() },
    tool: { my_tool: MyTool },
  }
}
```

---

## 4. The `provider` hook — contribute a domain + agents

A `DomainProvider` is just a stable `key` plus the agents it contributes:

```ts
interface DomainProvider {
  key: string
  agentSpecs(): AgentSpec[]         // sync or async
}

interface AgentSpec {
  name: string                      // unique across ALL domains (fail-fast on collision)
  role: "orchestrator" | "analyzer" | "specialist" | "analyst"
      | "batch-verifier" | "verifier" | "followup" | "support"
  group?: string                    // logical grouping (e.g. an assessment group key)
  description: string
  steps: number
  color: string
  prompt: string
  skills: string[]
  permissions: Record<string, PermissionRule>   // which tools this agent may call, by name
  hidden?: boolean
  prependRequestContext?: boolean
  useSmallModel?: boolean
}
```

Return `provider: { <domainKey>: () => new MyProvider() }` from your hook. The host
merges each spec into the agent registry, so your agents appear alongside the
built-ins and dispatch through the same `task` tool. An assessment-style domain
implements the host's richer `AssessmentProvider` (groups / classify /
analystPrompt / verifyPrompt / ...) so its batch scan+verify workflow runs through
core's `orchestrateLayer2` — `@cyberstrike-io/azure`'s `AzureProvider` is the
worked example.

---

## 5. The `tool` hook — contribute tools

Return `tool: { <id>: ToolDefinition }`, built with the SDK's `tool()`:

```ts
import { tool } from "@cyberstrike-io/plugin"
export const MyTool = tool({
  description: "…",
  args: { target: tool.schema.string() },
  async execute(args, ctx) {
    // structured metadata via ctx.metadata(...); return the human-readable output string
    return "…"
  },
})
```

The host registers these into the same tool registry; your agents allow them by
name in their `permissions`. Tools that need HTTP send, signal recording, or
session data use the building blocks from `input.core` (see next).

---

## 6. `input.core` — the building-block kit

Everything the host injects. Use the VALUES from `core`; import the TYPE from
`cyberstrike/public`. Current members (grows in new core versions):

| Member | Use |
|--------|-----|
| `CORE_API_VERSION`, `requireCoreApi`, `coreApiSatisfies` | version gate |
| `registerProvider`, `resolveProvider`, `isAssessmentProvider` | registry |
| `orchestrateLayer2` | run an assessment workflow |
| `Intel`, `Session`, `Vulnerability`, `VulnStatus` | session + finding stores |
| `triageGuide`, `triageActions`, `isActionable`, `isExcluded` | finding triage |
| `web` | the web building-block kit (see below) — **core ≥ 1.2.0** |

### `input.core.web` — the web building-block kit

The "Lego" surface for building your own web tools: the same governed-send path,
request model, replay engine, captured-traffic store, webhook tool shells, and
signal fabric that core's own web tools compose. Use the VALUES from
`core().web`; import the TYPES (`ProbeRequest`, `WebhookContext`, `WebKit`, ...)
from `cyberstrike/public`.

| Group | Members | Use |
|-------|---------|-----|
| send seam | `governedSend`, `ReplaySender` | one governed HTTP send (budget + circuit breaker per call) |
| request model | `HttpMessage`, `Mutate`, `Apply`, `Observe`, `Encode` | build / transform a request, analyse a response (pure) |
| replay engine | `Send`, `ReplayResponse`, `Batch`, `Governor` | retry, response parsing, bounded-concurrency batching, governors |
| captured traffic | `Request` | resolve a `request_id` → the raw captured request |
| tool shells | `defineWebhookTool`, `webhookContext`, `toolResult`, `toolError` | wrap a probe as a CyberStrike tool |
| signal fabric | `web.signal.{ SignalStore, SignalRouter, CanaryRegistry, runDetectors, DETECTORS, scanCapturedResponse, scanProbeResponse, scanElicitedResponse }` | detect → route → persist → verify web findings |

```ts
// inside a tool your package ships — build a probe with the injected web kit
import { core } from "./core"
const web = core().web
const sender = new web.ReplaySender({ followRedirects: false })
const res = await sender.send({ method: "GET", url, headers: {} })
new web.signal.SignalStore(sessionID).record(/* … */)
```

> Need a block the installed core doesn't expose yet? It ships in a newer core
> version — pin it with `requireCoreApi` (see §8). New kits (e.g. a `cloud` kit)
> arrive the same additive way.

---

## 7. Native, not MCP

Your package may ALSO expose an MCP server as a **separate output adapter** (e.g.
to drive it from Claude Desktop). That is fine — but it is a second face, not how
CyberStrike uses you. **Inside CyberStrike you integrate natively** (provider/tool
hooks), never as an MCP server. MCP tools are opaque and non-deterministic; routing
a domain through MCP would break the signal fabric and structured dispatch that
make CyberStrike deterministic. Keep the two faces separate: native domain for CS,
optional MCP adapter for external clients.

---

## 8. Versioning — the compatibility boundary

`input.core` and `cyberstrike/public` are versioned by `CORE_API_VERSION` (the
version of the public surface, independent of the app release). Call
`requireCoreApi("X.Y.Z")` in your default export; if the host is older it throws,
the host catches it, and your domain shows in the health report as
`✗ incompatible core API` — the host and other domains keep working. When you need
a building block the installed core doesn't expose, that block ships in a newer
core version; pin it with `requireCoreApi`.

MAJOR bump = a public member changed/removed (packages pinned to the old major
refuse to load); MINOR = members added (older packages still work).

---

## 9. Distribution

Three ways a domain reaches a running host — the same load path, different origin:

- **Free-tier / default domains** ship WITH core: listed in core's
  `bundledDependencies` + loaded by the default-domain loader — the user gets them
  out of the box, no install, no config (e.g. `@cyberstrike-io/azure`).
- **Your own custom domains** (self-hosted): put a `cyberstrike` manifest (§3) in
  your package, run `npm install @your-scope/mydomain` in your workspace, and the
  host **auto-discovers** and loads it on next start — no plugin config needed.
  (You can still list it explicitly in `config.plugin`; the host then installs it
  into its own cache and loads it there. A package in both is loaded once.) Inspect
  what loaded with `cyberstrike domains list`, one package's manifest with
  `cyberstrike domains info <name>`.
- **CyberStrike's commercial pro capabilities** run **SaaS-side**, not as a
  restricted npm package a user installs into a local binary. The SaaS backend is
  itself a host: it loads the pro domains through the exact same hooks + `input.core`
  + auto-discovery described here, and access is gated by the account subscription
  at the SaaS layer. So "pro" is an entitlement, not a local install — the
  mechanism in this doc is how it plugs in server-side.

**Compatibility at discovery:** the host reads your manifest `coreApi` and skips an
incompatible package *without importing it* (it shows as `✗` in `domains list` with
the reason). This is the static pre-flight; your default export's `requireCoreApi`
is the runtime backstop.

**Replace / extend a domain:** a package's `provider` hook can register an existing
domain key to REPLACE that domain (e.g. a richer variant of `web`), or add
specialists to it. Registration is idempotent by key, so the later registration
wins — this is how a SaaS pro build supersedes the free domain.

---

## 10. Publish

```bash
bun publish              # respects publishConfig.access; workspace:* → real versions
```

Publish an OSS / free domain `--access public`; publish a private one (a SaaS
build, or your own internal domain) `--access restricted`. Never publish anything
that carries secrets or client identifiers. A published version is permanent (npm
unpublish only within 72h), so a burned version number is gone.

---

## Reference checklist

- [ ] `cyberstrike` manifest in package.json (`coreApi`, `domains`, `tools`, `tier`) so the host discovers you
- [ ] default export `(input) => Hooks`; `setCore(input.core)` + `requireCoreApi` first
- [ ] `provider` hook returns your domain's `AgentSpec[]` (unique names)
- [ ] `tool` hook returns SDK `tool()` definitions; agents allow them by name
- [ ] core VALUES via `input.core`; core TYPES via `import type … from "cyberstrike/public"`
- [ ] native integration only — no MCP inside the CS flow
- [ ] `requireCoreApi` pins the core version you need
- [ ] publish access matches the tier (public vs restricted)
