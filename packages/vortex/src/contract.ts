// The consumer contract — the stable seam a consumer (web / cloud / mobile / community) builds on
// without touching the core. Three pieces:
//   1. CORE_API_VERSION      — the contract's own version; a plugin declares the range it needs.
//   2. SourceAdapter         — the shape of a thing that FEEDS traffic in (browser/proxy/sdk/har).
//   3. VortexPlugin + registerPlugin — the shape of a thing that EXTENDS detection (rules/probes),
//                              with a compatibility handshake.
//
// PUBLIC API (pinned — safe to build on, only broken with a CORE_API_VERSION bump):
//   Transaction/Header/Request/Response/Source/Severity · TrafficStore/MemoryStore/SqliteStore ·
//   RuleRegistry/defaultRegistry · Rule/CorpusRule/Signal · DeclarativeRule/ChainRule/ProbeRule +
//   their compile*/parse* · Httpql (agent query) · forAgent/agentCapabilities/Vortex/Capability ·
//   send/RequestSpec/SendOptions/SendResult + replaySafety/isAuthStale · subjects/inventory/lead ·
//   this module (SourceAdapter/VortexPlugin/registerPlugin/CORE_API_VERSION).
// INTERNAL (NOT part of the contract — may change without a version bump): the `Engine.*` namespace
//   (raw-HTTP Mutate/Apply/Batch/Encode/Governor), the expr tokenizer/parser internals, and the
//   fields resolver internals. Consumers should not import these directly.
import type { Source, Transaction } from "./transaction"
import type { TrafficStore } from "./store"
import type { Rule, CorpusRule, TransactionHook } from "./rule"
import type { ActiveRule } from "./active"
import { RuleRegistry } from "./rule"
import type { DeclarativeRule } from "./declarative"
import { compileRules } from "./declarative"
import type { ChainRule } from "./chain"
import { compileChain } from "./chain"
import type { AggregateRule } from "./aggregate"
import { compileAggregates } from "./aggregate"
import type { ProbeRule } from "./probe"
import { compileProbes } from "./probe"

// The contract version. Bump on a breaking change to the public API / plugin shape. (npm package
// version is separate — this versions the CONTRACT.)
export const CORE_API_VERSION = "1.0.0"

export class PluginError extends Error {}

// ── source adapters (feed traffic IN) ───────────────────────────────────────
// A source adapter normalizes one raw source event into a Transaction. The core never calls these —
// a consumer runs its adapter and feeds the store. The interface is the contract: browser / proxy /
// sdk-ingest / har-import all implement the same shape, so everything downstream is identical.
export interface SourceAdapter<Raw = unknown> {
  readonly source: Source
  ingest(raw: Raw): Transaction | undefined // undefined = skip this event
}

// Convenience: run an adapter over a batch of raw events into the store. Returns how many landed.
export function feed<Raw>(store: TrafficStore, adapter: SourceAdapter<Raw>, raws: Raw[]): number {
  let n = 0
  for (const raw of raws) {
    const tx = adapter.ingest(raw)
    if (tx) {
      store.add(tx)
      n++
    }
  }
  return n
}

// ── plugins (extend DETECTION) ───────────────────────────────────────────────
// A plugin contributes rules to the engine — the way azure / web / community add detection without
// touching the core. Declarative/chain/probe rules are DATA; perTx/corpus are hand-written TS rules.
export interface VortexPlugin {
  name: string
  version: string
  requiresCore?: string // semver range against CORE_API_VERSION, e.g. "^1.0.0"; omit = any
  rules?: DeclarativeRule[] // passive, compiled to Rule
  chains?: ChainRule[] // cross-transaction, compiled to CorpusRule
  aggregates?: AggregateRule[] // cross-transaction rollup ("one finding, many URLs"), compiled to CorpusRule
  probes?: ProbeRule[] // active, compiled to ActiveRule (run via runActiveRules, not the registry)
  perTxRules?: Rule[] // hand-written per-transaction rules
  corpusRules?: CorpusRule[] // hand-written corpus rules
  // Imperative per-transaction extractors (e.g. the Enterprise jsmine miner). Run via scan.ts
  // `extract(store, registry)`; each is handed the store + a transaction and does its own work
  // (parse a body → write discovered endpoints/JS + signals). The seam that lets core invoke a paid
  // extractor without importing it — core owns the registry, the plugin implements the hook.
  onTransaction?: TransactionHook[]
}

// Minimal semver check against CORE_API_VERSION: supports "^x.y.z" (same major, >=), ">=x.y.z", and
// exact "x.y.z". Enough for the contract handshake without a semver dependency.
function coreSatisfies(range: string): boolean {
  const cur = CORE_API_VERSION.split(".").map(Number)
  const m = range.trim().match(/^(\^|>=|=)?\s*(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return false
  const want = [Number(m[2]), Number(m[3]), Number(m[4])]
  const cmp = () => {
    for (let i = 0; i < 3; i++) if (cur[i]! !== want[i]!) return cur[i]! < want[i]! ? -1 : 1
    return 0
  }
  if (m[1] === "^") return cur[0] === want[0] && cmp() >= 0
  if (m[1] === ">=") return cmp() >= 0
  return cmp() === 0
}

// Register a plugin's rules into a registry (after a compatibility check). Returns the plugin's
// compiled ACTIVE rules (probes) — those don't live in the registry; the caller runs them with
// runActiveRules(activeRules, txs, send).
export function registerPlugin(registry: RuleRegistry, plugin: VortexPlugin): ActiveRule[] {
  if (plugin.requiresCore && !coreSatisfies(plugin.requiresCore))
    throw new PluginError(`plugin "${plugin.name}" needs core ${plugin.requiresCore}, but this is ${CORE_API_VERSION}`)
  if (plugin.rules) registry.registerAll(compileRules(plugin.rules))
  if (plugin.perTxRules) registry.registerAll(plugin.perTxRules)
  if (plugin.chains) registry.registerCorpusAll(plugin.chains.map(compileChain))
  if (plugin.aggregates) registry.registerCorpusAll(compileAggregates(plugin.aggregates))
  if (plugin.corpusRules) registry.registerCorpusAll(plugin.corpusRules)
  if (plugin.onTransaction) registry.registerHookAll(plugin.onTransaction)
  return plugin.probes ? compileProbes(plugin.probes) : []
}
