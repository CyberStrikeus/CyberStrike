// Pivot getters — the "I confirmed one, now hunt the rest" moves that aren't a per-request HTTPQL
// SELECT nor a per-object inventory lookup:
//  - valueOccurrences: a value the agent spotted in a rawView (a leaked token, an internal host, an
//    object id) → WHERE ELSE it appears across the corpus, and in which field. Feeds the pivot from
//    "read the raw" to "find everywhere this value flows".
//  - untestedEndpoints: endpoints the crawl/JS-mine DISCOVERED but no request ever hit — the attack
//    surface not yet exercised, so the agent can expand a finding to its untested siblings.
import type { TrafficStore } from "./store"
import type { Transaction } from "./transaction"
import type { Discovered } from "./discovery"
import { params, responseFields } from "./params"
import { normalizePath } from "./endpoint"

export interface Occurrence {
  transactionId: string
  sites: string[] // where the value appeared: "req.query.id", "resp.header.location", "resp.body", …
}

// Every transaction carrying `value` (substring), with the field(s) it appears in — request and
// response. For pivoting off a value found in a rawView.
export function valueOccurrences(store: TrafficStore, value: string): Occurrence[] {
  if (!value) return []
  const out: Occurrence[] = []
  for (const tx of store.all()) {
    const sites: string[] = []
    const p = params(tx)
    for (const [k, v] of Object.entries(p.query)) if (v.includes(value)) sites.push(`req.query.${k}`)
    for (const [k, v] of Object.entries(p.body)) if (v.includes(value)) sites.push(`req.body.${k}`)
    for (const h of tx.request.headers) if (h.value.includes(value)) sites.push(`req.header.${h.name.toLowerCase()}`)
    if (sites.length === 0 && tx.request.url.includes(value)) sites.push("req.url") // value embedded in the path
    if (tx.response) {
      const rf = responseFields(tx)
      let respBodyField = false
      for (const [k, v] of Object.entries(rf))
        if (v.includes(value)) {
          sites.push(`resp.body.${k}`)
          respBodyField = true
        }
      for (const h of tx.response.headers) if (h.value.includes(value)) sites.push(`resp.header.${h.name.toLowerCase()}`)
      if (!respBodyField && tx.response.body && tx.response.body.includes(value)) sites.push("resp.body")
    }
    if (sites.length) out.push({ transactionId: tx.id, sites })
  }
  return out
}

function pathOf(value: string): string {
  try {
    return new URL(value).pathname
  } catch {
    const q = value.indexOf("?")
    return q === -1 ? value : value.slice(0, q)
  }
}

// Discovered endpoints that no transaction ever hit — untested attack surface. Compared by
// normalized path (the same folding endpointKey uses), so "/users/42" hit means "/users/{id}" is
// covered.
export function untestedEndpoints(store: TrafficStore): Discovered[] {
  const requested = new Set(store.all().map((tx: Transaction) => normalizePath(pathOf(tx.request.url))))
  return store.discovered("endpoint").filter((d) => !requested.has(normalizePath(pathOf(d.value))))
}
