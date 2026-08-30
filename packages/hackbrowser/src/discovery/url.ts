import type { ScopeMatcher } from "../scope.ts"

/**
 * Resolve raw hrefs/paths against a base URL, keep only in-scope http(s) URLs,
 * strip the fragment, and de-duplicate. Detectors emit page URLs through this so
 * every result is an absolute, in-scope, deduped URL ready for the BFS queue.
 */
/** True when `raw` is an absolute http(s) URL whose host is in scope. */
export function inScopeUrl(raw: string, inScope: ScopeMatcher): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    return inScope(url.hostname)
  } catch {
    return false
  }
}

export function toScopedPages(raw: Iterable<string>, baseUrl: string, inScope: ScopeMatcher): string[] {
  const out = new Set<string>()
  for (const value of raw) {
    if (!value) continue
    try {
      const url = new URL(value, baseUrl)
      if (url.protocol !== "http:" && url.protocol !== "https:") continue
      if (!inScope(url.hostname)) continue
      url.hash = ""
      out.add(url.href)
    } catch {
      // malformed URL — skip
    }
  }
  return [...out]
}
