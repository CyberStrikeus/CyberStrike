// Active neighbour-ID probing — the ACTIVE half of #40's BOLA/IDOR discovery. For an endpoint whose
// path carries a numeric object id that returned 2xx, re-send the request (SAME credentials) with the
// id mutated to id±1..±N. A neighbour that returns 2xx with content different from BOTH our own object
// (baseline) AND a definitely-nonexistent id (control — this rules out an app that serves one 200
// "shell" for every id) means we reached a DISTINCT object we were never handed: a cross-object /
// BOLA candidate, possibly another account's. One probe per (endpoint, path-param); the governed
// sender gates and rate-limits this whole layer (it runs only when active probing is enabled).
import type { Transaction } from "../transaction"
import type { Signal } from "../rule"
import type { ActiveRule, Sender } from "../active"
import type { Apply } from "../send"
import { injectPoints } from "../injectpoint"
import { endpointKey } from "../endpoint"

const WINDOW = Math.max(1, Number(process.env.CYBERSTRIKE_VORTEX_ID_NEIGHBOR_WINDOW) || 5)
const MAX_POINTS = Math.max(1, Number(process.env.CYBERSTRIKE_VORTEX_ID_NEIGHBOR_MAX_POINTS) || 25)
const CONTROL_OFFSET = 100_000_003 // a large offset → very likely a non-existent id (the "not found" shape)

// ±1..±WINDOW, nearest first (a closer neighbour is the more likely live sibling).
function deltas(w: number): number[] {
  const out: number[] = []
  for (let d = 1; d <= w; d++) out.push(d, -d)
  return out
}

function ok2xx(status: number | undefined): boolean {
  return status !== undefined && status >= 200 && status < 300
}

function sameBytes(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export const numericIdNeighbor: ActiveRule = {
  id: "numeric-id-neighbor-bola",
  title: "Neighbour object id returns a distinct object (BOLA/IDOR)",
  category: "access-control",
  severity: "medium",
  async probe(txs: Transaction[], send: Sender): Promise<Signal[]> {
    const out: Signal[] = []
    const seen = new Set<string>()
    let probed = 0
    const sendId = async (tx: Transaction, dotpath: string, value: string) => {
      const mutations: Apply.Mutation[] = [{ op: "set-path-param", name: dotpath, value }]
      try {
        return (await send(tx, { mutations })).result.response
      } catch {
        return undefined
      }
    }
    for (const tx of txs) {
      if (probed >= MAX_POINTS) break
      if (tx.response === undefined || !ok2xx(tx.response.status)) continue
      for (const pt of injectPoints(tx)) {
        if (probed >= MAX_POINTS) break
        if (pt.location !== "path" || pt.valueType !== "number" || pt.valueSample === undefined) continue
        const key = `${endpointKey(tx)}:${pt.dotpath}`
        if (seen.has(key)) continue
        const orig = Number.parseInt(pt.valueSample, 10)
        if (!Number.isSafeInteger(orig)) continue
        seen.add(key)
        probed++

        // Our own object (must re-fetch to establish the reference) + the not-found shape.
        const baseline = await sendId(tx, pt.dotpath, String(orig))
        if (!baseline) continue // couldn't establish our own object → can't diff, skip
        const control = await sendId(tx, pt.dotpath, String(orig + CONTROL_OFFSET))
        const controlBody = control && ok2xx(control.status) ? control.body : undefined

        for (const d of deltas(WINDOW)) {
          const nid = orig + d
          if (nid < 0) continue
          const res = await sendId(tx, pt.dotpath, String(nid))
          if (!res || !ok2xx(res.status) || !res.body || res.body.length === 0) continue
          if (sameBytes(res.body, baseline.body)) continue // same as our own object → not cross-object
          if (sameBytes(res.body, controlBody)) continue // looks like the not-found shell → not a real object
          out.push({
            ruleId: this.id,
            transactionId: tx.id,
            severity: "medium",
            category: "access-control",
            title: "Neighbour object id returned a distinct object — cross-object BOLA/IDOR",
            evidence: `${endpointKey(tx)}: path id ${orig} → ${nid} returned ${res.status} with different content under the same credentials (reached an object we were not handed)`,
            param: { location: "path", dotpath: pt.dotpath, name: pt.name },
            dedupKey: `${this.id}:${key}`,
          })
          break // one confirmation per point
        }
      }
    }
    return out
  },
}

export const idorActiveRules: ActiveRule[] = [numericIdNeighbor]
