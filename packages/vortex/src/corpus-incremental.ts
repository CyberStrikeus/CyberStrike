// Incremental (Rete-style) corpus matching — the proven-path replacement for re-scanning the whole
// corpus on every run (#40 P1c). A matcher maintains per-endpoint aggregate state and is fed one tx at
// a time (`observe`); `signals()` reads the current findings from that state in O(result). It produces
// the SAME signals as the batch access CorpusRules (access.ts) — locked by an equivalence test that
// diffs batch vs incremental over many corpora. This is the alpha-node half of Rete: single-fact
// aggregation. (The multi-step chain join keeps its inverted index from P1a.)
import type { Transaction } from "./transaction"
import type { Signal } from "./rule"
import { endpointKey } from "./endpoint"
import { isSuccess } from "./scope"
import { requestValues, correlatable } from "./taint"

const ANON = "(anonymous)"

interface EndpointState {
  identities: Set<string> // distinct identities that reached this endpoint (insertion order = first-seen)
  anchor: string // first successful tx on this endpoint (matches batch `reached[0]`)
  anonAnchor?: string // first anonymous successful tx (matches batch `reached.find(!identity)`)
  authed: boolean // any credentialed identity reached it
  anon: boolean // any anonymous access reached it
}

// Cross-identity + unauthenticated-reach access findings, maintained incrementally. Mirrors
// crossIdentityAccess and unauthenticatedReach in rules/access.ts exactly (same ids, anchors, evidence,
// dedupKeys) so it is a drop-in for those two CorpusRules.
export class AccessMatcher {
  private readonly endpoints = new Map<string, EndpointState>()
  // Every tx id ever observed, so observe() is idempotent — a matcher can be hydrated from store.all()
  // once (e.g. after a restart) and then fed new txs at ingest without double-counting or order skew.
  private readonly seen = new Set<string>()

  observe(tx: Transaction): void {
    if (this.seen.has(tx.id)) return
    this.seen.add(tx.id)
    if (!isSuccess(tx)) return // batch filters group by isSuccess before looking at identities
    const key = endpointKey(tx)
    let e = this.endpoints.get(key)
    if (!e) {
      e = { identities: new Set(), anchor: tx.id, authed: false, anon: false }
      this.endpoints.set(key, e)
    }
    const id = tx.identity ?? ANON
    e.identities.add(id)
    if (tx.identity && tx.identity !== ANON) e.authed = true
    if (!tx.identity) {
      e.anon = true
      if (e.anonAnchor === undefined) e.anonAnchor = tx.id
    }
  }

  signals(): Signal[] {
    const out: Signal[] = []
    for (const [key, e] of this.endpoints) {
      if (e.identities.size >= 2) {
        out.push({
          ruleId: "cross-identity-access",
          transactionId: e.anchor,
          severity: "low",
          category: "access-control",
          title: "Endpoint reachable under multiple identities — access-control review",
          evidence: `${key} reached by: ${[...e.identities].join(", ")}`,
          dedupKey: `cross-identity-access:${key}`,
        })
      }
      if (e.authed && e.anon) {
        out.push({
          ruleId: "unauthenticated-reach",
          transactionId: e.anonAnchor ?? e.anchor,
          severity: "medium",
          category: "access-control",
          title: "Authenticated endpoint also reachable anonymously",
          evidence: `${key} returned 2xx with no credentials`,
          dedupKey: `unauthenticated-reach:${key}`,
        })
      }
    }
    return out
  }
}

// Incrementally-maintained request-value index for chain value-reuse joins (#40 P1c). Fed one tx at a
// time (observe), it holds `correlatable value → ids of txs whose request carries it` — byte-identical
// to chain.ts's one-pass buildRequestValueIndex over the same txs, so passing map() to a chain via the
// CorpusContext yields the exact same reuse candidates (and thus signals) without rebuilding it per run.
export class ChainValueIndex {
  private readonly index = new Map<string, Set<string>>()
  private readonly seen = new Set<string>()

  observe(tx: Transaction): void {
    if (this.seen.has(tx.id)) return
    this.seen.add(tx.id)
    for (const v of requestValues(tx)) {
      if (!correlatable(v)) continue
      let s = this.index.get(v)
      if (!s) {
        s = new Set<string>()
        this.index.set(v, s)
      }
      s.add(tx.id)
    }
  }

  map(): Map<string, Set<string>> {
    return this.index
  }
}
