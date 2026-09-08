// auth-strip — the flagship active rule. For each authenticated endpoint that returned 2xx, re-send
// the request WITHOUT its credentials; if it still returns 2xx, the endpoint does not enforce
// authentication = broken access control. This is deterministic (no agent) and server-side (it sees
// the true response), and it is exactly the check the passive layer could never make. One probe per
// endpoint, so it can't fan out.
import type { Transaction } from "../transaction"
import { header } from "../transaction"
import type { Signal } from "../rule"
import type { ActiveRule, Sender } from "../active"
import { endpointKey } from "../endpoint"
import { isSuccess } from "../scope"
import { requestCookies } from "../cookies"
import type { Apply } from "../send"

// Does this request carry credentials we can strip?
function authHeaders(tx: Transaction): string[] {
  const out: string[] = []
  if (header(tx.request.headers, "authorization")) out.push("authorization")
  if (header(tx.request.headers, "x-api-key")) out.push("x-api-key")
  if (Object.keys(requestCookies(tx)).length > 0) out.push("cookie")
  return out
}

export const authStrip: ActiveRule = {
  id: "auth-strip",
  title: "Endpoint does not enforce authentication",
  category: "access-control",
  severity: "high",
  async probe(txs: Transaction[], send: Sender): Promise<Signal[]> {
    const out: Signal[] = []
    const seen = new Set<string>() // one probe per endpoint
    for (const tx of txs) {
      if (!isSuccess(tx)) continue
      const creds = authHeaders(tx)
      if (creds.length === 0) continue
      const key = endpointKey(tx)
      if (seen.has(key)) continue
      seen.add(key)
      const mutations: Apply.Mutation[] = creds.map((name) => ({ op: "remove-header", name }))
      const { result } = await send(tx, { mutations })
      const status = result.response?.status
      if (status === undefined) continue // transport error → inconclusive, no signal
      if (status >= 200 && status < 300) {
        out.push({
          ruleId: this.id,
          transactionId: tx.id,
          severity: "high",
          category: "access-control",
          title: "Authenticated endpoint served a 2xx WITHOUT credentials",
          evidence: `${key} → ${status} after stripping ${creds.join(", ")}`,
          dedupKey: `${this.id}:${key}`,
        })
      }
    }
    return out
  },
}

export const activeRules: ActiveRule[] = [authStrip]
