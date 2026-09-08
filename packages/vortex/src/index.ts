// Vortex — CyberStrike's HTTP traffic engine (public surface).
//
// Shape of the thing: every request/response the platform sees becomes a `Transaction` in a
// `TrafficStore`; a `RuleRegistry` runs deterministic `Rule`s over that traffic to emit `Signal`s
// without waiting on agent initiative. HTTPQL-lite (a query layer over the store) lands next.
export type { Source, Severity, Header, Request, Response, Transaction } from "./transaction"
export { header, headerAll, hasHeader } from "./transaction"
export type { TrafficStore } from "./store"
export { MemoryStore } from "./store"
export type { Rule, Signal } from "./rule"
export { RuleRegistry } from "./rule"

import { RuleRegistry } from "./rule"
import { headerRules } from "./rules/headers"

// The baseline rule set — everything OSS. `defaultRegistry()` returns a fresh registry preloaded
// with it, so a consumer can `defaultRegistry().run(tx)` out of the box or start empty and pick.
export const baselineRules = [...headerRules]

export function defaultRegistry(): RuleRegistry {
  return new RuleRegistry().registerAll(baselineRules)
}

export { headerRules, missingSecurityHeaders, weakCookieFlags, serverBanner } from "./rules/headers"
