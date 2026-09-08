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
export { params, responseFields, requestBodyKind, responseBodyKind } from "./params"
export type { BodyKind, BodyView } from "./body"
export { bodyKind, analyzeBody, messageBody } from "./body"
export type { Cookie } from "./cookies"
export { parseSetCookie, responseCookies, requestCookies } from "./cookies"
export type { GraphQL } from "./graphql"
export { graphql } from "./graphql"
export { contentType, isStaticAsset, isRedirect, isSuccess, isContentResponse, isObserved, observed } from "./scope"
export type { Har } from "./har"
export { fromHar, parseHar, toHar } from "./har"
export { groupByEndpoint, groupByShape, identities } from "./corpus"
export { requestShape } from "./shape"
export type { Rule, CorpusRule, Signal } from "./rule"
export { RuleRegistry, dedupe } from "./rule"
export type { CompiledQuery } from "./httpql"
export { compile, query, QueryError } from "./httpql"
// The send engine (raw-HTTP mutate/send/observe) and the Transaction bridge.
export * as Engine from "./send"
export type { RequestSpec, SendOptions, SendResult } from "./replay"
export { send, toRequest, buildRequest } from "./replay"
export type { ActiveRule, Sender } from "./active"
export { runActiveRules } from "./active"
export { activeRules, authStrip } from "./rules/authstrip"

import { RuleRegistry } from "./rule"
import { headerRules } from "./rules/headers"
import { accessRules } from "./rules/access"
import { signatureRules } from "./rules/signatures"
import { compileRules } from "./declarative"

// The declarative rule DSL (LLM-friendly: a rule is {when: HTTPQL, message, severity} data).
export type { DeclarativeRule } from "./declarative"
export { DeclarativeRuleSchema, compileRule, compileRules, parseRules } from "./declarative"
export type { ChainRule } from "./chain"
export { ChainRuleSchema, compileChain, parseChains } from "./chain"
export { correlatable, responseValues, requestValues, sharedValues } from "./taint"
export type { Extract, Discovered } from "./discovery"
export { ingestExtract, discoveredId } from "./discovery"
export { fieldValue } from "./httpql"
export { signatureRules } from "./rules/signatures"

// The baseline rule set — everything OSS. Per-transaction hygiene + response-signature (declarative)
// rules + cross-transaction access-control rules. `defaultRegistry()` preloads them all.
export const baselineRules = [...headerRules, ...compileRules(signatureRules)]
export const baselineCorpusRules = [...accessRules]

export function defaultRegistry(): RuleRegistry {
  return new RuleRegistry().registerAll(baselineRules).registerCorpusAll(baselineCorpusRules)
}

export { headerRules, missingSecurityHeaders, weakCookieFlags, serverBanner } from "./rules/headers"
export { accessRules, crossIdentityAccess, unauthenticatedReach } from "./rules/access"
