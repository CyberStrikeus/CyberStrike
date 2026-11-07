// Corpus helpers: grouping/correlation primitives that cross-transaction (CorpusRule) rules build
// on. The engine's real leverage is here — reasoning over the whole body of traffic, not one
// request at a time.
import type { Severity, Transaction } from "./transaction"
import type { Signal } from "./rule"
import { endpointKey } from "./endpoint"
import { requestShape } from "./shape"

// Group transactions by their logical endpoint (method + host + normalized path). This is how a
// corpus rule sees "all the times we hit THIS endpoint" across instances and identities.
export function groupByEndpoint(txs: Transaction[]): Map<string, Transaction[]> {
  const out = new Map<string, Transaction[]>()
  for (const tx of txs) {
    const key = endpointKey(tx)
    const list = out.get(key)
    if (list) list.push(tx)
    else out.set(key, [tx])
  }
  return out
}

// Group by request SHAPE (endpoint + parameter-name set) — finer than endpoint, so near-identical
// requests that differ only in values collapse together. Used to dedup traffic and map operations.
export function groupByShape(txs: Transaction[]): Map<string, Transaction[]> {
  const out = new Map<string, Transaction[]>()
  for (const tx of txs) {
    const key = requestShape(tx)
    const list = out.get(key)
    if (list) list.push(tx)
    else out.set(key, [tx])
  }
  return out
}

// The distinct identities (credential/role labels) present in a set, with anonymous as a marker.
export function identities(txs: Transaction[]): Set<string> {
  const out = new Set<string>()
  for (const tx of txs) out.add(tx.identity ?? "(anonymous)")
  return out
}

// ── The "detect-once" config-class format (issue #87) ──────────────────────────────────────────────
// A config/host-scoped class (missing security headers, weak cookie flags, CORS, banner, …) is a
// property of the HOST, not each URL — once seen on a host, that's enough. Emitting one signal per
// endpoint floods the queue. This is the CODE variant of the format (the declarative variant is an
// AggregateRule with groupBy:"host"): a hand CorpusRule computes a per-transaction `detail` and emits
// exactly ONE signal per host, listing the affected endpoints (deduped + capped) and the union of the
// per-tx details. dedupKey = `${id}:${host}`, so re-runs / incremental feeds collapse correctly.
const ROLLUP_LIST_CAP = 50

export interface RollupSpec {
  id: string
  category: string
  severity: Severity
  // undefined ⇒ this transaction does not match. A string ⇒ the match's detail; comma-separated tokens
  // are unioned across the host (e.g. the set of missing header labels seen anywhere on the host).
  match(tx: Transaction): string | undefined
  title(host: string, endpointCount: number, detail: string): string
  evidence(host: string, endpoints: string, detail: string): string
}

export function rollupByHost(txs: Transaction[], spec: RollupSpec): Signal[] {
  type Group = { rep: Transaction; endpoints: string[]; seen: Set<string>; details: Set<string> }
  const groups = new Map<string, Group>()
  for (const tx of txs) {
    const detail = spec.match(tx)
    if (detail === undefined) continue
    const g = groups.get(tx.host) ?? { rep: tx, endpoints: [], seen: new Set<string>(), details: new Set<string>() }
    if (!groups.has(tx.host)) groups.set(tx.host, g)
    for (const token of detail.split(",").map((s) => s.trim()).filter(Boolean)) g.details.add(token)
    const ep = endpointKey(tx)
    if (ep && !g.seen.has(ep)) {
      g.seen.add(ep)
      if (g.endpoints.length < ROLLUP_LIST_CAP) g.endpoints.push(ep)
    }
  }
  const out: Signal[] = []
  for (const [host, g] of groups) {
    const overflow = g.seen.size - g.endpoints.length
    const endpoints = g.endpoints.join(", ") + (overflow > 0 ? `, …(+${overflow} more)` : "")
    const detail = [...g.details].join(", ")
    out.push({
      ruleId: spec.id,
      transactionId: g.rep.id,
      severity: spec.severity,
      category: spec.category,
      title: spec.title(host, g.seen.size, detail),
      evidence: spec.evidence(host, endpoints, detail),
      dedupKey: `${spec.id}:${host}`,
    })
  }
  return out
}
