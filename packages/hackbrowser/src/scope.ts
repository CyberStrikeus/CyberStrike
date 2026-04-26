// psl ships types/index.d.ts but does not expose it via package.json
// "exports", so TypeScript treats the import as untyped. We narrow it
// here with the only call signature we use.
// @ts-expect-error - see comment above
import pslDefault from "psl"
const psl = pslDefault as {
  parse(host: string): { domain: string | null; error?: { code: string; message: string } }
}

// ============================================================
// Network scope (ARCHITECTURE.md §1.2 — Network Scope)
//
// Scope = which hostnames the agent forwards to CyberStrike.
// Distinct from --exclude (semantic task filter, planner-side).
//
// Resolution order at startup:
//   1. If user passes --scope flag(s), use that list verbatim.
//   2. Otherwise derive scope from target URL via PSL eTLD+1
//      and wrap as "*.{base}" wildcard.
//
// All matching uses the same predicate: exact match OR endsWith
// "." + base. Wildcard "*.foo.com" and bare "foo.com" produce
// equivalent matchers (matching foo.com itself + any subdomain).
// ============================================================

export type ScopeMatcher = (host: string) => boolean

/**
 * Strip protocol, path, query, port, trailing dots; lowercase.
 * Accepts "https://app.test.com:8080/foo?x=1" or bare "app.test.com".
 * Wildcard prefix "*." is preserved.
 */
export function normalizeScope(input: string): string {
  let s = input.trim().toLowerCase()
  if (!s) return ""
  s = s.replace(/^https?:\/\//, "")
  s = s.split(/[/?#]/)[0] ?? ""
  s = s.replace(/:\d+$/, "")
  s = s.replace(/\.+$/, "")
  return s
}

/**
 * Derive default scope from target URL: "*.{eTLD+1}".
 * Examples:
 *   https://test.com         → "*.test.com"
 *   https://app.test.com     → "*.test.com"
 *   https://x.example.com.tr → "*.example.com.tr"  (PSL handles ccTLDs)
 *
 * Falls back to "*.{hostname}" when PSL cannot resolve (e.g. raw IP,
 * localhost, unknown TLD). This keeps the agent functional in test
 * setups while logging a warning is the caller's responsibility.
 */
export function deriveScope(targetUrl: string): string {
  const host = new URL(targetUrl).hostname.toLowerCase()
  const parsed = psl.parse(host)
  if ("error" in parsed || !parsed.domain) return `*.${host}`
  return `*.${parsed.domain}`
}

/**
 * Build a matcher from one or more scope patterns. The matcher
 * returns true when the host matches ANY pattern (OR semantics).
 *
 *   makeMatcher(["*.test.com"])               → matches test.com + *.test.com
 *   makeMatcher(["app.test.com"])             → same as "*.app.test.com"
 *   makeMatcher(["app.test.com","api.test.com"]) → exact OR
 *
 * Empty input → matcher that rejects everything (safe default).
 */
export function makeMatcher(scopes: readonly string[]): ScopeMatcher {
  const bases = scopes
    .map(normalizeScope)
    .filter((s) => s.length > 0)
    .map((s) => (s.startsWith("*.") ? s.slice(2) : s))
  if (bases.length === 0) return () => false
  return (host: string) => {
    const h = host.toLowerCase().replace(/\.+$/, "")
    for (const base of bases) {
      if (h === base || h.endsWith("." + base)) return true
    }
    return false
  }
}
