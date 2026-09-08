// Vortex — CyberStrike's HTTP traffic engine (public surface).
//
// Shape of the thing: every request/response the platform sees becomes a `Transaction` in a
// `TrafficStore`; a `RuleRegistry` runs deterministic per-transaction `Rule`s AND cross-transaction
// `CorpusRule`s over that traffic to emit `Signal`s (deduped) without waiting on agent initiative.
// HTTPQL-lite (a query layer over the store) lands next.
export type { Source, Severity, Header, Request, Response, Transaction } from "./transaction"
export { header, headerAll, hasHeader } from "./transaction"
export type { TrafficStore } from "./store"
export { MemoryStore } from "./store"
export { SqliteStore } from "./sqlite-store"
export { normalizePath, endpointKey } from "./endpoint"
export type { Params } from "./params"
export { params } from "./params"
export { contentType, isStaticAsset, isRedirect, isSuccess, isContentResponse } from "./scope"
export { groupByEndpoint, identities } from "./corpus"
export type { Rule, CorpusRule, Signal } from "./rule"
export { RuleRegistry, dedupe } from "./rule"
export type { CompiledQuery } from "./httpql"
export { compile, query, QueryError } from "./httpql"

import { RuleRegistry } from "./rule"
import { headerRules } from "./rules/headers"
import { accessRules } from "./rules/access"

// The baseline rule set — everything OSS. Per-transaction hygiene rules + cross-transaction
// access-control rules. `defaultRegistry()` returns a fresh registry preloaded with both.
export const baselineRules = [...headerRules]
export const baselineCorpusRules = [...accessRules]

export function defaultRegistry(): RuleRegistry {
  return new RuleRegistry().registerAll(baselineRules).registerCorpusAll(baselineCorpusRules)
}

export { headerRules, missingSecurityHeaders, weakCookieFlags, serverBanner } from "./rules/headers"
export { accessRules, crossIdentityAccess, unauthenticatedReach } from "./rules/access"
