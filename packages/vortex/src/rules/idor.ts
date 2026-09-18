// Enumerable-object-reference rules — the passive half of neighbor-ID IDOR/BOLA discovery (#40).
// A numeric object id sitting in a URL path that returned 2xx is a classic enumerable reference: its
// neighbours (id±N) very likely address OTHER objects, potentially belonging to accounts we don't hold
// credentials for. This rule only SURFACES the candidate (deterministic, no traffic); the active
// ±N probe (gated) confirms which neighbours actually return a different object.
import type { Transaction } from "../transaction"
import type { Rule, Signal } from "../rule"
import { injectPoints } from "../injectpoint"
import { endpointKey } from "../endpoint"
import { isSuccess } from "../scope"

export const numericIdEnumerable: Rule = {
  id: "numeric-id-enumerable",
  title: "Enumerable numeric object id in path",
  category: "access-control",
  severity: "low",
  evaluate(tx: Transaction): Signal[] {
    // Only real objects: a 2xx response means the id addressed something. A numeric id on a 404/403
    // isn't an enumerable-reference signal (it's the absence we'd be probing FOR).
    if (!tx.response || !isSuccess(tx)) return []
    const out: Signal[] = []
    const seen = new Set<string>()
    for (const pt of injectPoints(tx)) {
      // Sequential numeric ids in the PATH only — the cleanest enumerable object reference. Query
      // numbers are more often pages/counts (noise); uuid/objectid aren't ±N-enumerable.
      if (pt.location !== "path" || pt.valueType !== "number") continue
      if (seen.has(pt.dotpath)) continue
      seen.add(pt.dotpath)
      const key = endpointKey(tx)
      out.push({
        ruleId: this.id,
        transactionId: tx.id,
        severity: "low",
        category: "access-control",
        title: "Enumerable numeric object id — BOLA/IDOR neighbour candidates",
        evidence: `${key} carries a numeric object id in the path (${pt.valueSample ?? "?"}); id±N neighbours likely address other objects — candidate for cross-account BOLA/IDOR review`,
        // Carry the exact inject point so the active ±N probe knows what to mutate.
        param: { location: "path", dotpath: pt.dotpath, name: pt.name },
        // One finding per (endpoint, path-param): the same enumerable reference hit many times is one surface.
        dedupKey: `${this.id}:${key}:${pt.dotpath}`,
      })
    }
    return out
  },
}

export const idorRules: Rule[] = [numericIdEnumerable]
