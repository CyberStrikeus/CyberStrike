// Canary correlation — the reflection/injection tracker, ported to Vortex's model. A canary is a
// unique marker embedded in a request; every later OBSERVED response is scanned for it. A token
// injected at request A that surfaces in a DIFFERENT response B is a STORED (second-order)
// reflection — the hardest injection case, invisible to a single-response check. Same-request
// reflection is ordinary and handled at send time (SendResult.canaryReflected), NOT here.
//
// Edge cases handled: (1) same-request hits excluded from "stored" (they're not); (2) unique
// low-collision tokens so an incidental substring match is implausible; (3) only OBSERVED responses
// are scanned — an agent's own replay echo never counts as the app reflecting it; (4) `template`
// canaries carry the EVALUATED marker (e.g. "49" from {{7*7}}) so a hit proves engine evaluation.
import type { Transaction } from "./transaction"
import type { Signal } from "./rule"
import { endpointKey } from "./endpoint"
import { isObserved } from "./scope"

export type CanaryKind = "reflect" | "template" | "callback" | "file" | "log"

export interface Canary {
  token: string
  kind: CanaryKind
  originRequestId: string // the transaction the payload was injected at (a replay, usually)
  endpoint: string
  field?: string
  vulnClass?: string
  agent?: string
  createdAt: number
}

let counter = 0
// Unique, low-collision token: `cs` + time + counter + random, all base36. Alphanumeric, so it
// survives HTML/URL encoding unchanged — a raw substring match is enough to detect reflection.
export function mintCanary(): string {
  counter = (counter + 1) % 0xffffff
  return `cs${Date.now().toString(36)}${counter.toString(36).padStart(4, "0")}${Math.random().toString(36).slice(2, 6)}`
}

export function reflects(body: string | undefined, token: string): boolean {
  return !!body && body.includes(token)
}

// The placeholder a caller puts in a payload where the minted token should go: value "…{canary}…".
export const CANARY_PLACEHOLDER = "{canary}"

// Build the Canary record for a token injected at a transaction.
export function canaryFor(token: string, tx: Transaction, opts: { kind?: CanaryKind; field?: string; vulnClass?: string; agent?: string } = {}): Canary {
  return {
    token,
    kind: opts.kind ?? "reflect",
    originRequestId: tx.id,
    endpoint: endpointKey(tx),
    field: opts.field,
    vulnClass: opts.vulnClass,
    agent: opts.agent,
    createdAt: Date.now(),
  }
}

// Scan OBSERVED responses for registered canaries. Emits a stored_reflection signal per canary that
// appears in a DIFFERENT transaction than it was injected at. Cross-request only — same-request
// reflection is not "stored". Observed-only — a replay echo is never the app reflecting the token.
export function scanCanaries(txs: Transaction[], canaries: Canary[]): Signal[] {
  const out: Signal[] = []
  for (const tx of txs) {
    if (!isObserved(tx)) continue
    const body = tx.response?.body
    if (!body) continue
    for (const c of canaries) {
      if (tx.id === c.originRequestId) continue // same request → not stored
      if (!reflects(body, c.token)) continue
      out.push({
        ruleId: "stored-reflection",
        transactionId: tx.id,
        severity: "medium",
        category: "injection",
        title: `Stored reflection: canary from ${c.endpoint}${c.field ? ` (${c.field})` : ""} renders at ${endpointKey(tx)}`,
        evidence: `token ${c.token} injected at ${c.endpoint} appears in the response of ${endpointKey(tx)}`,
        dedupKey: `stored-reflection:${c.token}:${endpointKey(tx)}`,
      })
    }
  }
  return out
}
