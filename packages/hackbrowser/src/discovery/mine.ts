import type { ScopeMatcher } from "../scope.ts"
import type { Endpoint } from "./detector.ts"

// Call sites: `.get("/x")`, `.post('/y')`, axios/http-client style. Method is captured.
const HTTP_METHOD_CALL = /\.(get|post|put|delete|patch|head|options)\s*\(\s*(["'`])([^"'`]+?)\2/gi
// `fetch("/x")` — method defaults to GET (the options arg, if any, is not parsed here).
const FETCH_CALL = /\bfetch\s*\(\s*(["'`])([^"'`]+?)\1/gi
// Bare path literals for common API prefixes — a bonus harvest independent of
// call shape. The prefix must be a WHOLE path segment (lookahead for /, ?, or a
// closing quote) so "/user-guide" / "/username" don't masquerade as "/user".
const API_PATH_LITERAL =
  /(["'`])(\/(?:api|rest|graphql|v\d+|auth|oauth2?|admin|internal|account|user|session)s?(?=[/?"'`])[^"'`\s]*)\1/gi

// Static assets and non-HTTP schemes are never application endpoints.
const SKIP_EXT = /\.(js|mjs|cjs|css|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|html?)($|\?)/i
const SKIP_SCHEME = /^(data|blob|javascript|mailto|tel):/i

/** `/api/users/${id}` → `/api/users/{}` so the proxy-agent sees the endpoint shape. */
function normalizeTemplate(raw: string): string {
  return raw.replace(/\$\{[^}]*\}/g, "{}")
}

function toUrl(raw: string, origin: string): string | null {
  const cleaned = normalizeTemplate(raw.trim())
  if (!cleaned) return null
  if (cleaned.startsWith("//")) return null // protocol-relative: ambiguous host
  if (SKIP_SCHEME.test(cleaned)) return null
  if (SKIP_EXT.test(cleaned)) return null
  try {
    let href: string
    if (/^https?:\/\//i.test(cleaned)) href = new URL(cleaned).href
    else if (cleaned.startsWith("/")) href = new URL(cleaned, origin).href
    else return null // relative-without-slash: too ambiguous to resolve safely
    // Restore the `{}` template placeholder that URL() percent-encoded.
    return href.replace(/%7B%7D/gi, "{}")
  } catch {
    return null
  }
}

/**
 * Extract candidate API endpoints from a JS bundle's source text. Pure, framework-
 * agnostic (works on any minified bundle), deterministic — no LLM, no model bias.
 * In-scope + deduped. These are DISCOVERED (never hit here); the proxy-agents test
 * them via http_replay (Approach B).
 */
export function mineEndpoints(text: string, origin: string, inScope: ScopeMatcher): Endpoint[] {
  const out = new Map<string, Endpoint>()
  const add = (method: string, raw: string): void => {
    const url = toUrl(raw, origin)
    if (!url) return
    let host: string
    try {
      host = new URL(url).hostname
    } catch {
      return
    }
    if (!inScope(host)) return
    const key = `${method} ${url}`
    if (!out.has(key)) out.set(key, { method, url, source: "js-api" })
  }
  let match: RegExpExecArray | null
  HTTP_METHOD_CALL.lastIndex = 0
  while ((match = HTTP_METHOD_CALL.exec(text))) add(match[1].toUpperCase(), match[3])
  FETCH_CALL.lastIndex = 0
  while ((match = FETCH_CALL.exec(text))) add("GET", match[2])
  API_PATH_LITERAL.lastIndex = 0
  while ((match = API_PATH_LITERAL.exec(text))) add("GET", match[2])
  return [...out.values()]
}
