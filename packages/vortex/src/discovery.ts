// Discovery = the intel an EXTRACTOR pulls out of traffic (endpoints/JS URLs/tech/secrets from a
// JS response, say) and the inventory Vortex keeps of it. Vortex owns the CONTRACT and the DB sink;
// the extractor itself (e.g. @cyberstrike-io/jsmine, built separately) is just a producer of an
// `Extract`. This is the input/output seam: extractor(tx) → Extract → ingestExtract() → store.
import type { Transaction } from "./transaction"
import type { TrafficStore } from "./store"

// The output contract every extractor produces. Field-name-agnostic, HTTP-agnostic — a pure result.
export interface Extract {
  endpoints: string[] // API/route URLs or paths found (probe candidates)
  jsUrls: string[] // further JS bundles to fetch + mine recursively
  tech: string[] // technology markers (framework/library slugs)
  secrets: string[] // secret-looking strings found in the content
}

// A discovered target Vortex remembers: an endpoint or a JS asset it learned about but may not have
// sent/observed yet. `hit` flips true once a real transaction to it is seen.
export interface Discovered {
  id: string // stable: `${kind}:${value}`
  kind: "endpoint" | "js"
  value: string
  fromTransaction?: string
  source?: string
  hit: boolean
  // Whether the PAGE actually pulled this asset in (referenced-vs-loaded, issue #22). Set from the
  // browser's own load record (PerformanceResourceTiming): "executed" = ran as a script,
  // "loaded"/"preloaded" = fetched (maybe not run), "referenced" = only named in the DOM/another
  // bundle. Undefined when unknown. A finding on a "referenced"-only asset is down-ranked (the app may
  // ship but never load it — the classic "we don't load that" false positive).
  loadState?: "executed" | "loaded" | "preloaded" | "referenced"
}

export function discoveredId(kind: Discovered["kind"], value: string): string {
  return `${kind}:${value}`
}

function mergeTech(existing: string[] | undefined, add: string[]): string[] {
  const set = new Set(existing ?? [])
  for (const t of add) if (t) set.add(t)
  return [...set]
}

// Write an extractor's Extract into Vortex's DB: attach tech markers to the source transaction, and
// record discovered endpoints / JS URLs in the inventory (deduped, with provenance). Secrets are
// left to the secret-in-response rule / a future findings store. Returns what was added.
export function ingestExtract(store: TrafficStore, transactionId: string, extract: Extract): { discovered: number; tech: number } {
  let discovered = 0
  const tx = store.get(transactionId)
  if (tx && extract.tech.length) {
    const merged = mergeTech(tx.tech, extract.tech)
    store.add({ ...tx, tech: merged } as Transaction)
  }
  const items: Discovered[] = []
  for (const e of extract.endpoints) items.push({ id: discoveredId("endpoint", e), kind: "endpoint", value: e, fromTransaction: transactionId, source: "extract", hit: false })
  for (const u of extract.jsUrls) items.push({ id: discoveredId("js", u), kind: "js", value: u, fromTransaction: transactionId, source: "extract", hit: false })
  if (items.length) discovered = store.addDiscovered(items)
  return { discovered, tech: extract.tech.length }
}
