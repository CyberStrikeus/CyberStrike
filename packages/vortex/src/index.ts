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
export { scan, recordSignals, scanStored, extract } from "./scan"
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
export { inventory, crossRoleObjects, crossRoleFunctions, objectsByResource, objectsForRole, transactionsForObject, humanName } from "./inventory"
// Pivot getters — "confirmed one, hunt the rest": where a value flows, and untested attack surface.
export type { Occurrence } from "./pivot"
export { valueOccurrences, untestedEndpoints } from "./pivot"
// The AGENT surface: a narrow curated facade (forAgent) + framework-neutral tool descriptors
// (agentCapabilities) a consumer adapts into its tool framework. SDK-produced fixed tools.
export type { Vortex, Capability, LeadFilter } from "./agent"
export { forAgent, agentCapabilities } from "./agent"
// The consumer contract: source-adapter + plugin interfaces + the CORE_API_VERSION handshake.
export type { SourceAdapter, VortexPlugin } from "./contract"
export { CORE_API_VERSION, feed, registerPlugin, PluginError } from "./contract"
export type { Params } from "./params"
export { params, responseFields, requestBodyKind, responseBodyKind } from "./params"
export { injectPoints, injectPointKey, coverageKey, valueType } from "./injectpoint"
export type { InjectPoint, InjectLocation, ValueType, Coverage } from "./injectpoint"
export { probeInjectPoints, probeSession, mutationForPoint, injectionPayloads } from "./injectprobe"
export type { PayloadClass, DetectMode, ProbeOptions } from "./injectprobe"
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
export type { Rule, CorpusRule, Signal, SignalParam, TransactionHook } from "./rule"
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
import { idorRules } from "./rules/idor"
import { signatureRules } from "./rules/signatures"
import { misconfigRules } from "./rules/misconfig"
import { techRules } from "./rules/tech"
import { authRules } from "./rules/auth"
import { authProviderRules } from "./rules/auth-providers"
import { tlsCaRules } from "./rules/tls-ca"
import { securityRules } from "./rules/security"
import { cdnRules } from "./rules/cdn"
import { containerRules } from "./rules/containers"
import { databaseRules } from "./rules/databases"
import { loadBalancerRules } from "./rules/load-balancers"
import { paasRules } from "./rules/paas"
import { dbManagerRules } from "./rules/db-managers"
import { accessibilityRules } from "./rules/accessibility"
import { developmentRules } from "./rules/development"
import { editorRules } from "./rules/editors"
import { jsFrameworkRules } from "./rules/js-frameworks"
import { jsGraphicsRules } from "./rules/js-graphics"
import { jsLibraryRules } from "./rules/js-libraries"
import { pageBuilderRules } from "./rules/page-builders"
import { languageRules } from "./rules/languages"
import { uiFrameworkRules } from "./rules/ui-frameworks"
import { webFrameworkRules } from "./rules/web-frameworks"
import { hostingPanelRules } from "./rules/hosting-panels"
import { contentCurationRules } from "./rules/content-curation"
import { issueTrackerRules } from "./rules/issue-trackers"
import { webServerRules } from "./rules/web-servers"
import { reverseProxyRules } from "./rules/reverse-proxies"
import { osRules } from "./rules/os"
import { cmsRules } from "./rules/cms"
import { cveRules } from "./rules/cve"
import { chainRules } from "./rules/chains"
import { aggregateRules } from "./rules/aggregates"
import { compileRules } from "./declarative"
import { compileChain } from "./chain"
import { compileAggregates } from "./aggregate"

// The declarative rule DSL (LLM-friendly: a rule is {when: DSL-expression, message, severity} data).
export type { DeclarativeRule } from "./declarative"
export { DeclarativeRuleSchema, compileRule, compileRules, parseRules } from "./declarative"
export type { ChainRule } from "./chain"
export { ChainRuleSchema, compileChain, parseChains } from "./chain"
// Aggregate rules (LLM-friendly: same per-tx `when` + an `aggregate` block that collapses all matches
// into ONE finding listing every affected endpoint — one finding, many URLs).
export type { AggregateRule } from "./aggregate"
export { AggregateRuleSchema, compileAggregate, compileAggregates, parseAggregates } from "./aggregate"
export { correlatable, responseValues, requestValues, sharedValues } from "./taint"
export type { Extract, Discovered } from "./discovery"
export { ingestExtract, discoveredId } from "./discovery"
// Crawl — the discovery producer (shallow scaffold; deepened separately). Walks same-host links via
// a Sender, stores fetched traffic, records endpoints/script-URLs into the discovered inventory.
export type { CrawlOptions, CrawlResult } from "./crawl"
export { crawl } from "./crawl"
export type { RawView } from "./fields"
export { fieldValue, rawView } from "./fields"
export { signatureRules } from "./rules/signatures"

// The baseline rule set — everything OSS. Per-transaction hygiene + response-signature (declarative)
// rules + cross-transaction access-control rules. `defaultRegistry()` preloads them all.
export const baselineRules = [...headerRules, ...idorRules, ...compileRules(signatureRules), ...compileRules(misconfigRules), ...compileRules(techRules), ...compileRules(authProviderRules), ...compileRules(tlsCaRules), ...compileRules(securityRules), ...compileRules(cdnRules), ...compileRules(containerRules), ...compileRules(databaseRules), ...compileRules(loadBalancerRules), ...compileRules(paasRules), ...compileRules(dbManagerRules), ...compileRules(accessibilityRules), ...compileRules(developmentRules), ...compileRules(editorRules), ...compileRules(jsFrameworkRules), ...compileRules(jsGraphicsRules), ...compileRules(jsLibraryRules), ...compileRules(pageBuilderRules), ...compileRules(languageRules), ...compileRules(uiFrameworkRules), ...compileRules(webFrameworkRules), ...compileRules(hostingPanelRules), ...compileRules(contentCurationRules), ...compileRules(issueTrackerRules), ...compileRules(webServerRules), ...compileRules(reverseProxyRules), ...compileRules(osRules), ...compileRules(cmsRules), ...compileRules(authRules), ...compileRules(cveRules)]
export { misconfigRules } from "./rules/misconfig"
export { techRules } from "./rules/tech"
export { authRules } from "./rules/auth"
export { authProviderRules } from "./rules/auth-providers"
export { tlsCaRules } from "./rules/tls-ca"
export { securityRules } from "./rules/security"
export { cdnRules } from "./rules/cdn"
export { containerRules } from "./rules/containers"
export { databaseRules } from "./rules/databases"
export { loadBalancerRules } from "./rules/load-balancers"
export { paasRules } from "./rules/paas"
export { dbManagerRules } from "./rules/db-managers"
export { accessibilityRules } from "./rules/accessibility"
export { developmentRules } from "./rules/development"
export { editorRules } from "./rules/editors"
export { jsFrameworkRules } from "./rules/js-frameworks"
export { jsGraphicsRules } from "./rules/js-graphics"
export { jsLibraryRules } from "./rules/js-libraries"
export { pageBuilderRules } from "./rules/page-builders"
export { languageRules } from "./rules/languages"
export { uiFrameworkRules } from "./rules/ui-frameworks"
export { webFrameworkRules } from "./rules/web-frameworks"
export { hostingPanelRules } from "./rules/hosting-panels"
export { contentCurationRules } from "./rules/content-curation"
export { issueTrackerRules } from "./rules/issue-trackers"
export { webServerRules } from "./rules/web-servers"
export { reverseProxyRules } from "./rules/reverse-proxies"
export { osRules } from "./rules/os"
export { cmsRules } from "./rules/cms"
export { cveRules } from "./rules/cve"
export const baselineCorpusRules = [...accessRules, ...chainRules.map(compileChain), ...compileAggregates(aggregateRules)]
export { chainRules } from "./rules/chains"
export { aggregateRules } from "./rules/aggregates"

export function defaultRegistry(): RuleRegistry {
  return new RuleRegistry().registerAll(baselineRules).registerCorpusAll(baselineCorpusRules)
}

export { headerRules, missingSecurityHeaders, weakCookieFlags, serverBanner } from "./rules/headers"
export { accessRules, crossIdentityAccess, unauthenticatedReach } from "./rules/access"
export { idorRules, numericIdEnumerable } from "./rules/idor"
