// Corpus helpers: grouping/correlation primitives that cross-transaction (CorpusRule) rules build
// on. The engine's real leverage is here — reasoning over the whole body of traffic, not one
// request at a time.
import type { Transaction } from "./transaction"
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
