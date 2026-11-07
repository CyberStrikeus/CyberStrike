// Request "shape" — a finer identity than endpointKey. endpointKey ignores parameters; a raw
// instance is unique per value. The shape sits in between: endpoint + the SET of parameter names
// (query + body), sorted. Two requests with the same shape are the SAME operation differing only in
// values (e.g. `?id=1` vs `?id=2`), so shape is what you group by to dedup near-identical traffic
// and to map the real API surface (distinct operations, not distinct value instances).
import type { Transaction } from "./transaction"
import { endpointKey } from "./endpoint"
import { params } from "./params"

export function requestShape(tx: Transaction): string {
  const p = params(tx)
  const q = Object.keys(p.query).sort().join(",")
  const b = Object.keys(p.body).sort().join(",")
  return `${endpointKey(tx)} q[${q}] b[${b}]`
}
