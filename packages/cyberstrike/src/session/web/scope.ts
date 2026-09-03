// Crawl scope for the co-driving loop — keeps the AI ON the target instead of wandering off
// into external links (a demo site's footer "source on GitHub" link had the loop crawling all
// of github.com). 1.x bounded the crawl to `*.{eTLD+1}`; this restores that for 2.0.
//
// Scope is the target's registrable domain (auto) plus any explicit patterns from the
// hackbrowser `scope` arg. rank/frontier drop out-of-scope targets, so the loop never
// navigates off-domain. No public-suffix dependency — a pragmatic registrable-domain with a
// small multi-part-TLD table (good enough to keep the crawl home; not a security boundary).
export namespace WebScope {
  interface S {
    domain: string // auto registrable domain of the origin (e.g. testfire.net)
    patterns: string[] // explicit scope patterns (exact host or *.example.com)
  }
  const bySession = new Map<string, S>()

  // Common two-part public suffixes where the registrable domain is the last THREE labels.
  const TWO_PART: ReadonlySet<string> = new Set([
    "co.uk", "org.uk", "gov.uk", "ac.uk", "co.jp", "com.au", "net.au", "org.au", "com.br",
    "com.tr", "com.cn", "com.mx", "co.in", "co.nz", "co.za", "com.sg", "com.hk", "co.kr",
  ])

  export function registrable(host: string): string {
    const l = host.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean)
    if (l.length <= 2) return l.join(".")
    const last2 = l.slice(-2).join(".")
    return (TWO_PART.has(last2) ? l.slice(-3) : l.slice(-2)).join(".")
  }
  function hostOf(url: string): string | undefined {
    try {
      const u = new URL(url)
      return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.toLowerCase() : undefined
    } catch {
      return undefined
    }
  }
  function matchPattern(host: string, pat: string): boolean {
    const p = pat.toLowerCase().trim().replace(/^\*\./, "")
    return host === p || host.endsWith("." + p)
  }

  // Establish scope once from the crawl origin (auto eTLD+1) + optional explicit patterns.
  // Idempotent (first write wins) — the launcher sets it authoritatively; the loop is a fallback.
  export function ensure(sessionID: string, originUrl: string, patterns?: string[]): void {
    if (bySession.has(sessionID)) return
    const h = hostOf(originUrl)
    bySession.set(sessionID, { domain: h ? registrable(h) : "", patterns: (patterns ?? []).filter(Boolean) })
  }
  export function get(sessionID: string): S | undefined {
    return bySession.get(sessionID)
  }

  // In scope? Non-http urls (mailto:/javascript:/tel:) are out. No scope set → allow (don't
  // block un-scoped/manual use); the loop always ensure()s scope before it navigates.
  export function allowed(sessionID: string, url: string): boolean {
    const s = bySession.get(sessionID)
    if (!s) return true
    const h = hostOf(url)
    if (!h) return false
    if (s.domain && registrable(h) === s.domain) return true
    return s.patterns.some((p) => matchPattern(h, p))
  }

  export function clearSession(sessionID: string): void {
    bySession.delete(sessionID)
  }
  export function _reset(): void {
    bySession.clear()
  }
}
