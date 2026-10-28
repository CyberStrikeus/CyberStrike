// Advanced cross-transaction corpus rules — deeper analysis than the basic access-control surface
// rules. These detect privilege escalation indicators, method confusion, inconsistent auth
// enforcement, cacheable authenticated responses, and response fingerprint differentials across
// identities. All deterministic, no LLM, no probing — they reason over the captured corpus.
import type { Transaction } from "../transaction"
import { header, headerAll } from "../transaction"
import type { CorpusRule, Signal } from "../rule"
import { groupByEndpoint, identities } from "../corpus"
import { endpointKey } from "../endpoint"
import { isSuccess } from "../scope"

const MUTATING = new Set(["POST", "PUT", "DELETE", "PATCH"])

// Strip the HTTP method from an endpoint key ("GET host/path" → "host/path") so we can group
// requests to the same path regardless of method.
function pathKey(tx: Transaction): string {
  const key = endpointKey(tx)
  const space = key.indexOf(" ")
  if (space === -1) return key
  return key.slice(space + 1)
}

// An endpoint reached by 2+ identities with 2xx where one identity gets a MUCH larger response
// (>2x size AND >200B difference) — one role sees more data than another. Privilege escalation
// surface: the bigger response likely contains fields the smaller role shouldn't see.
export const privilegeEscalation: CorpusRule = {
  id: "privilege-escalation-surface",
  title: "Response size differential across identities",
  category: "access-control",
  severity: "medium",
  evaluate(txs: Transaction[]): Signal[] {
    const out: Signal[] = []
    for (const [key, group] of groupByEndpoint(txs)) {
      const reached = group.filter(isSuccess)
      const who = identities(reached)
      if (who.size < 2) continue
      // Per-identity max response size (use bodyLength when available, else body string length).
      const sizes = new Map<string, number>()
      for (const tx of reached) {
        const id = tx.identity ?? "(anonymous)"
        const len = tx.response?.bodyLength ?? tx.response?.body?.length ?? 0
        const cur = sizes.get(id) ?? 0
        if (len > cur) sizes.set(id, len)
      }
      const vals = [...sizes.entries()]
      if (vals.length < 2) continue
      vals.sort((a, b) => b[1] - a[1])
      const biggest = vals[0]
      const smallest = vals[vals.length - 1]
      if (smallest[1] === 0) continue
      const ratio = biggest[1] / smallest[1]
      const diff = biggest[1] - smallest[1]
      if (ratio < 2 || diff < 200) continue
      const anchor = reached.find((t) => (t.identity ?? "(anonymous)") === biggest[0]) ?? reached[0]
      out.push({
        ruleId: this.id,
        transactionId: anchor.id,
        severity: "medium",
        category: "access-control",
        title: "Privilege escalation surface — response size differential across identities",
        evidence: `${key}: ${biggest[0]} gets ${biggest[1]}B vs ${smallest[0]} gets ${smallest[1]}B (${ratio.toFixed(1)}x) — the larger response may contain fields the other role shouldn't see`,
        dedupKey: `${this.id}:${key}`,
      })
    }
    return out
  },
}

// An endpoint path reachable via BOTH a safe method (GET/HEAD) AND a mutating method (POST/PUT/
// DELETE/PATCH) with 2xx — the mutating method may bypass read-only intent or access control that
// only gates the GET. One signal per host+path.
export const methodConfusion: CorpusRule = {
  id: "method-confusion",
  title: "Endpoint accepts both safe and mutating methods",
  category: "access-control",
  severity: "medium",
  evaluate(txs: Transaction[]): Signal[] {
    const out: Signal[] = []
    // Group by host+path (ignoring method).
    const groups = new Map<string, Transaction[]>()
    for (const tx of txs) {
      if (!isSuccess(tx)) continue
      const pk = pathKey(tx)
      const list = groups.get(pk)
      if (list) list.push(tx)
      else groups.set(pk, [tx])
    }
    for (const [pk, group] of groups) {
      const methods = new Set(group.map((t) => t.request.method.toUpperCase()))
      const safe = methods.has("GET") || methods.has("HEAD")
      const mutating = [...methods].some((m) => MUTATING.has(m))
      if (!safe || !mutating) continue
      const anchor = group.find((t) => MUTATING.has(t.request.method.toUpperCase())) ?? group[0]
      const found = [...methods].join(", ")
      out.push({
        ruleId: this.id,
        transactionId: anchor.id,
        severity: "medium",
        category: "access-control",
        title: "Method confusion — safe and mutating methods both succeed on the same path",
        evidence: `${pk} accepted: ${found} — test whether the mutating method bypasses read-only access control`,
        dedupKey: `${this.id}:${pk}`,
      })
    }
    return out
  },
}

// Within an API prefix (first 2 path segments, e.g. /api/v1), if SOME endpoints required auth
// while others under the same prefix returned 2xx without any identity, the unauthed ones are
// likely missing auth enforcement — a developer forgot to protect them.
export const inconsistentAuth: CorpusRule = {
  id: "inconsistent-auth",
  title: "API prefix has mixed auth enforcement",
  category: "access-control",
  severity: "medium",
  evaluate(txs: Transaction[]): Signal[] {
    const out: Signal[] = []
    // Group by host + first 2 path segments as the "API prefix".
    const prefixes = new Map<string, { authed: Set<string>; unauthed: Set<string>; anchor: Transaction }>()
    for (const tx of txs) {
      if (!isSuccess(tx)) continue
      const key = endpointKey(tx)
      const space = key.indexOf(" ")
      const hostpath = space === -1 ? key : key.slice(space + 1)
      const segments = hostpath.split("/").filter(Boolean)
      if (segments.length < 3) continue // need host + at least 2 path segments
      const prefix = `${segments[0]}/${segments[1]}/${segments[2]}`
      const entry = prefixes.get(prefix) ?? { authed: new Set(), unauthed: new Set(), anchor: tx }
      if (!prefixes.has(prefix)) prefixes.set(prefix, entry)
      if (tx.identity && tx.identity !== "(anonymous)") entry.authed.add(key)
      if (!tx.identity) entry.unauthed.add(key)
    }
    for (const [prefix, data] of prefixes) {
      if (data.authed.size === 0 || data.unauthed.size === 0) continue
      // Only flag when the unauthed endpoints are a MINORITY — a fully public API is fine.
      const total = new Set([...data.authed, ...data.unauthed]).size
      if (data.unauthed.size >= total * 0.8) continue
      const list = [...data.unauthed].slice(0, 10).join(", ")
      const extra = data.unauthed.size > 10 ? ` (+${data.unauthed.size - 10} more)` : ""
      out.push({
        ruleId: this.id,
        transactionId: data.anchor.id,
        severity: "medium",
        category: "access-control",
        title: "Inconsistent auth enforcement within API prefix",
        evidence: `/${prefix.split("/").slice(1).join("/")} has ${data.authed.size} authed and ${data.unauthed.size} unauthed endpoints — unauthed: ${list}${extra}`,
        dedupKey: `${this.id}:${prefix}`,
      })
    }
    return out
  },
}

// Authenticated responses served with a Cache-Control that allows caching (contains "public", or
// has max-age without "private"/"no-store"). A cache stores the authed response and serves it to
// another user. Aggregated per host — one signal listing affected endpoints.
export const cacheableAuth: CorpusRule = {
  id: "cacheable-auth-response",
  title: "Authenticated response allows caching",
  category: "misconfiguration",
  severity: "medium",
  evaluate(txs: Transaction[]): Signal[] {
    const out: Signal[] = []
    const hosts = new Map<string, { endpoints: Set<string>; anchor: Transaction }>()
    for (const tx of txs) {
      if (!isSuccess(tx)) continue
      if (!tx.identity || tx.identity === "(anonymous)") continue
      const cc = header(tx.response!.headers, "cache-control")
      if (!cc) continue
      const lower = cc.toLowerCase()
      if (lower.includes("no-store") || lower.includes("private")) continue
      if (!lower.includes("public") && !lower.includes("max-age")) continue
      const key = endpointKey(tx)
      const entry = hosts.get(tx.host) ?? { endpoints: new Set(), anchor: tx }
      if (!hosts.has(tx.host)) hosts.set(tx.host, entry)
      entry.endpoints.add(key)
    }
    for (const [host, data] of hosts) {
      const list = [...data.endpoints].slice(0, 20).join(", ")
      const extra = data.endpoints.size > 20 ? ` (+${data.endpoints.size - 20} more)` : ""
      out.push({
        ruleId: this.id,
        transactionId: data.anchor.id,
        severity: "medium",
        category: "misconfiguration",
        title: `Authenticated responses cacheable on ${host}`,
        evidence: `${data.endpoints.size} endpoint(s) serve authed responses with permissive Cache-Control: ${list}${extra}`,
        dedupKey: `${this.id}:${host}`,
      })
    }
    return out
  },
}

// For endpoints reached under 2+ identities, flag when the response HEADER profile differs between
// identities — different Set-Cookie count, or presence/absence of security-critical headers. This
// reveals inconsistent server-side handling (different middleware paths per role).
const SECURITY_HEADERS = ["strict-transport-security", "content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy"]

export const headerDifferential: CorpusRule = {
  id: "response-header-differential",
  title: "Response header profile differs across identities",
  category: "misconfiguration",
  severity: "low",
  evaluate(txs: Transaction[]): Signal[] {
    const out: Signal[] = []
    for (const [key, group] of groupByEndpoint(txs)) {
      const reached = group.filter(isSuccess)
      const who = identities(reached)
      if (who.size < 2) continue
      // Build per-identity header fingerprint: which security headers are present + Set-Cookie count.
      const prints = new Map<string, { secHeaders: Set<string>; cookies: number }>()
      for (const tx of reached) {
        const id = tx.identity ?? "(anonymous)"
        if (prints.has(id)) continue
        const present = new Set<string>()
        for (const name of SECURITY_HEADERS) {
          if (header(tx.response!.headers, name)) present.add(name)
        }
        prints.set(id, { secHeaders: present, cookies: headerAll(tx.response!.headers, "set-cookie").length })
      }
      if (prints.size < 2) continue
      // Compare all pairs — any difference in security header presence or cookie count is a finding.
      const entries = [...prints.entries()]
      let diff = false
      let detail = ""
      for (let i = 0; i < entries.length && !diff; i++) {
        for (let j = i + 1; j < entries.length && !diff; j++) {
          const a = entries[i]
          const b = entries[j]
          if (a[1].cookies !== b[1].cookies) {
            diff = true
            detail = `Set-Cookie count: ${a[0]}=${a[1].cookies}, ${b[0]}=${b[1].cookies}`
            break
          }
          const missing = [...a[1].secHeaders].filter((h) => !b[1].secHeaders.has(h))
          const extra = [...b[1].secHeaders].filter((h) => !a[1].secHeaders.has(h))
          if (missing.length > 0 || extra.length > 0) {
            diff = true
            const parts: string[] = []
            if (missing.length) parts.push(`${a[0]} has ${missing.join(",")} that ${b[0]} lacks`)
            if (extra.length) parts.push(`${b[0]} has ${extra.join(",")} that ${a[0]} lacks`)
            detail = parts.join("; ")
          }
        }
      }
      if (!diff) continue
      out.push({
        ruleId: this.id,
        transactionId: reached[0].id,
        severity: "low",
        category: "misconfiguration",
        title: "Response header profile differs across identities",
        evidence: `${key}: ${detail} — suggests different server-side handling per role`,
        dedupKey: `${this.id}:${key}`,
      })
    }
    return out
  },
}

export const advancedCorpusRules: CorpusRule[] = [privilegeEscalation, methodConfusion, inconsistentAuth, cacheableAuth, headerDifferential]
