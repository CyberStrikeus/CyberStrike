# Vortex SDK — embedding & consumer guide

How a **consumer** (web / cloud / mobile / community package) assembles Vortex: feed traffic in,
run detection, hand tools to agents. This is the broad platform API; the agent's narrow surface is
in [`agents.md`](./agents.md), the design in [`ARCHITECTURE.md`](../ARCHITECTURE.md).

`@cyberstrike-io/vortex` · TypeScript / Bun · AGPL-3.0-only.

## Quickstart

```ts
import { MemoryStore, defaultRegistry, leads } from "@cyberstrike-io/vortex"

const store = new MemoryStore()            // (or SqliteStore for a durable, session-scoped store)
store.add(tx)                               // feed traffic in (a Transaction) — see Ingestion

const signals = defaultRegistry().analyze(store.all())  // run the baseline catalog over the corpus
store.addSignals(signals)                   // persist the flags

for (const l of leads(store))               // actionable leads for an agent / a report
  console.log(l.signal.ruleId, l.function.endpoint, l.objects.map((o) => o.ref))
```

## 1. Ingestion — get traffic into the store

Everything the platform sees becomes a `Transaction` — a plain object you build (`{ id, source,
host, request:{method,url,headers,body?}, response?:{status,headers,body?} }`). Feed it however the
source produces it:

```ts
store.add({                                 // sdk-ingest: report a fetch you already made
  id: "c1", source: "cloud", host: "management.azure.com",
  request:  { method: "GET", url: "https://management.azure.com/subscriptions?api-version=2022-12-01", headers: [] },
  response: { status: 200, headers: [{ name: "content-type", value: "application/json" }], body: "…" },
})
```

For a repeatable source, implement `SourceAdapter` (normalize one raw event → `Transaction`) and use
`feed()`:

```ts
import { feed, type SourceAdapter } from "@cyberstrike-io/vortex"

const proxyAdapter: SourceAdapter<ProxyEvent> = {
  source: "proxy",
  ingest: (e) => ({ id: e.id, source: "proxy", host: e.host, request: e.request, response: e.response }),
}
feed(store, proxyAdapter, proxyEvents)      // returns how many landed
```

HAR has a built-in loader — no adapter needed: `for (const t of parseHar(harJsonString)) store.add(t)`
(or `fromHar(parsedHar)` if you already have the object).

Adapters cover browser (extension), proxy (MITM — roadmap J), sdk-ingest, send-through, har-import.
The core doesn't care which fed a transaction; `source` records provenance.

## 2. Detection — rules over the corpus

`defaultRegistry()` preloads the baseline catalog (22 DSL rules + hygiene/access). Author your own
rules as **data** and register them via a plugin:

```ts
import { RuleRegistry, registerPlugin, runActiveRules, send, type VortexPlugin } from "@cyberstrike-io/vortex"

const azure: VortexPlugin = {
  name: "azure", version: "0.1.0", requiresCore: "^1.0.0",
  rules:  [{ id: "imds-exposed", category: "misconfiguration", severity: "high",
             when: 'contains(req.url, "169.254.169.254") && resp.status == 200' }],
  chains: [/* ChainRule[] */],
  probes: [/* ProbeRule[] */],
}

const reg = defaultRegistry()
const probes = registerPlugin(reg, azure)   // passive/corpus → registry; returns the active probes
const signals = reg.analyze(store.all())
const active  = await runActiveRules(probes, store.all(), send)   // probes send, so they need a Sender
```

Rule shapes (all data, `when`/`select`/`detect` are DSL expressions — functions like `regex`,
`compare_versions`, `jwt_alg`, `base64_decode`):

- `DeclarativeRule {when, severity, message?, dedupBy?, tags?, requires?}` → passive.
- `ChainRule {steps:[{as, when?, reuses?, link?}], distinctIdentity?}` → cross-transaction.
- `ProbeRule {select, inject, detect}` → active (sends; `detect` may be `"reflected"` / `"evaluated"`).

`requires.tech` + `selectRules(rules, {tags, minSeverity, categories}, ctx)` let you pick a subset
at scale (the ~20k-rule path); file rule-packs load via `loadPackDir(dir)`.

## 3. Query / correlate / inspect

- **Agent query (HTTPQL):** `Httpql.query(store.all(), "resp.status:500 AND resp.body:~SQL")` — SELECT
  over the corpus (see [`agents.md`](./agents.md) for the language).
- **Object/function graph:** `inventory(store)` → `crossRoleObjects` (IDOR) / `crossRoleFunctions`
  (BFLA); `objectsByResource` / `transactionsForObject`.
- **Pivot:** `valueOccurrences(store, v)` (where a value flows) · `untestedEndpoints(store)`.
- **Inspect one:** `store.get(id)` + `rawView(tx)` → verbatim raw request+response.

## 4. Send — replay & craft

```ts
import { send } from "@cyberstrike-io/vortex"

await send(store.get("tx_42"), { mutations: [{ op: "set-query", name: "id", value: "'" }] })
await send({ method: "POST", url: "https://host/api", body: "…" })   // craft a fresh request
```

`send()` returns a **new** replay `Transaction` (append-only; the captured original is never mutated).
The **replay-safety guard** refuses a session-destroying replay (auth-exchange endpoint / session-mint
response / single-use token) unless `allowUnsafeReplay`; `resolveToken` substitutes fresh CSRF/nonce
values; `isAuthStale(tx)` is the benign "refresh me" signal.

## 5. Hand tools to agents

```ts
import { forAgent, agentCapabilities } from "@cyberstrike-io/vortex"
const api = forAgent(store)                 // the narrow facade
// map agentCapabilities → your tool framework (see agents.md)
```

## 6. The contract

- **`CORE_API_VERSION`** — a plugin declares `requiresCore` (e.g. `"^1.0.0"`); `registerPlugin`
  rejects incompatible ones with `PluginError`.
- **Public vs internal:** the pinned public API is the stable contract (see the `contract.ts`
  header). The `Engine.*` namespace (raw-HTTP `Mutate`/`Apply`/`Batch`) and the expr/fields internals
  are NOT part of the contract — don't import them directly.
