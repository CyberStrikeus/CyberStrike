// Vortex — CyberStrike's HTTP traffic engine (public surface).
//
// Shape of the thing: every request/response the platform sees becomes a `Transaction` in a
// `TrafficStore`; a `RuleRegistry` runs deterministic per-transaction `Rule`s AND cross-transaction
// `CorpusRule`s over that traffic to emit `Signal`s (deduped) without waiting on agent initiative.
// The DSL engine (expr.ts) is the one predicate language — for both agent queries and rule
// conditions — with a function library (decode/hash/version/regex/len) over the field vocabulary.
export type { Source, Severity, Header, Request, Response, Transaction } from "./transaction"
export { header, headerAll, hasHeader } from "./transaction"
export type { TrafficStore } from "./store"
export { MemoryStore, signalKey } from "./store"
export { SqliteStore } from "./sqlite-store"
export { scan, recordSignals, scanStored } from "./scan"
export type { Canary, CanaryKind, ReflectionContext, TemplateCanary } from "./canary"
export { mintCanary, reflects, canaryFor, scanCanaries, CANARY_PLACEHOLDER, TEMPLATE_PLACEHOLDER, reflectionContext, brokeOut, mintTemplateCanary } from "./canary"
export { normalizePath, endpointKey, identifierShape } from "./endpoint"
export type { IdShape } from "./endpoint"
// The object/function/role extractor — deterministic "who/what/which" from URI + query + headers +
// nested body, so a Signal is self-describing (agent consumes context, doesn't author it).
export type { Subjects, ObjectRef, Site, Crud } from "./subjects"
export { subjects } from "./subjects"
// The producer→consumer boundary object: Signal + subjects + raw + replay-safety in one record.
export type { Lead } from "./lead"
export { lead, leads } from "./lead"
// The corpus-wide object & function graph the agent queries — same object under >1 role = an IDOR
// lead, same function under >1 role = a BFLA surface, all deterministic.
export type { Inventory, ObjectRecord, FunctionRecord } from "./inventory"
export { inventory, crossRoleObjects, crossRoleFunctions, objectsByResource, objectsForRole, transactionsForObject } from "./inventory"
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
// The DSL engine (expr) — OUR rule/matcher language (functions, active/passive/chain → signals).
export type { Compiled, CompileOptions, Value } from "./expr"
export { compile, query, ExprError, functionNames } from "./expr"
// HTTPQL — the AGENT's query interface (pure SELECT over the traffic DB, no function library). A
// separate surface for a separate actor: `Httpql.query(txs, "resp.status:500 AND resp.body:~SQL")`.
export * as Httpql from "./httpql"
// The send engine (raw-HTTP mutate/send/observe) and the Transaction bridge.
export * as Engine from "./send"
export type { RequestSpec, SendOptions, SendResult } from "./replay"
export { send, toRequest, buildRequest } from "./replay"
// Replay safety — refuse to replay a request that would destroy the live session (single-use-token
// reuse), fresh-token substitution, and the benign auth-stale (refresh-needed) signal.
export type { ReplaySafety, TokenRef, TokenKind, TokenSite } from "./replay-safety"
export { replaySafety, isAuthStale, ReplayUnsafeError } from "./replay-safety"
export type { ActiveRule, Sender } from "./active"
export { runActiveRules } from "./active"
export { activeRules, authStrip } from "./rules/authstrip"
export type { ProbeRule } from "./probe"
export { ProbeRuleSchema, compileProbe, compileProbes, parseProbes } from "./probe"
export { probeRules } from "./rules/probes"
// Rule selection metadata (tags/requires) + the file-distributed rule-pack loader — the scale path
// (~20k rules): select a subset by tags/severity/category + tech, compile only the survivors.
export type { RuleMeta, Selection, Context } from "./rule-meta"
export { RuleMetaShape, selectRules } from "./rule-meta"
export type { Pack } from "./pack"
export { PackSchema, parsePack, mergePacks, loadPackDir, contextFromCorpus } from "./pack"

import { RuleRegistry } from "./rule"
import { headerRules } from "./rules/headers"
import { accessRules } from "./rules/access"
import { signatureRules } from "./rules/signatures"
import { compileRules } from "./declarative"

// The declarative rule DSL (LLM-friendly: a rule is {when: DSL-expression, message, severity} data).
export type { DeclarativeRule } from "./declarative"
export { DeclarativeRuleSchema, compileRule, compileRules, parseRules } from "./declarative"
export type { ChainRule } from "./chain"
export { ChainRuleSchema, compileChain, parseChains } from "./chain"
export { correlatable, responseValues, requestValues, sharedValues } from "./taint"
export type { Extract, Discovered } from "./discovery"
export { ingestExtract, discoveredId } from "./discovery"
export type { RawView } from "./fields"
export { fieldValue, rawView } from "./fields"
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
