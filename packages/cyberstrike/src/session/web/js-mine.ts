// Pure JS-bundle endpoint miner (P4.1, design §5). Deterministic, framework-agnostic — no LLM,
// no model bias: raw JS never enters a prompt, only the extracted endpoint list does. Given a JS
// bundle's source text it harvests candidate API endpoints (call sites + fetch + API-prefix path
// literals), in-scope + deduped. These are DISCOVERED (never hit here) — they feed the navigator
// as "known but unvisited routes" and the vuln pipeline tests them consciously.
//
// FLAG (intentional duplication): this is ported verbatim-in-spirit from the 1.x discovery-core
// `feat/discovery-core:packages/hackbrowser/src/discovery/mine.ts` (Epic #125). That branch is not
// merged into hackbrowser-2.0, so the logic cannot yet be shared by import. When discovery-core
// lands on main, collapse these two into one module. Keep the regexes in sync until then.
export namespace JsMine {
  export interface Endpoint {
    method: string
    url: string
  }

  // Call sites: `.get("/x")`, `.post('/y')`, axios/http-client style. Method captured.
  const HTTP_METHOD_CALL = /\.(get|post|put|delete|patch|head|options)\s*\(\s*(["'`])([^"'`]+?)\2/gi
  // `fetch("/x")` — method defaults to GET (the options arg is not parsed here).
  const FETCH_CALL = /\bfetch\s*\(\s*(["'`])([^"'`]+?)\1/gi
  // Bare path literals for common API prefixes — a bonus harvest independent of call shape. The
  // prefix must be a WHOLE path segment (lookahead for /, ?, or a closing quote) so "/user-guide"
  // and "/username" don't masquerade as "/user".
  const API_PATH_LITERAL =
    /(["'`])(\/(?:api|rest|graphql|v\d+|auth|oauth2?|admin|internal|account|user|session)s?(?=[/?"'`])[^"'`\s]*)\1/gi

  // Static assets and non-HTTP schemes are never application endpoints.
  const SKIP_EXT = /\.(js|mjs|cjs|css|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|html?)($|\?)/i
  const SKIP_SCHEME = /^(data|blob|javascript|mailto|tel):/i

  // `/api/users/${id}` → `/api/users/{}` so the endpoint SHAPE (not one value) is what's recorded.
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
      return href.replace(/%7B%7D/gi, "{}") // restore the {} placeholder URL() percent-encoded
    } catch {
      return null
    }
  }

  // Extract candidate API endpoints from a JS bundle's source text. Pure + deterministic.
  // `inScope(absoluteUrl)` bounds the harvest to the target (single source: WebScope at the call site).
  export function mineEndpoints(text: string, origin: string, inScope: (url: string) => boolean): Endpoint[] {
    const out = new Map<string, Endpoint>()
    const add = (method: string, raw: string): void => {
      const url = toUrl(raw, origin)
      if (!url) return
      if (!inScope(url)) return
      const key = `${method} ${url}`
      if (!out.has(key)) out.set(key, { method, url })
    }
    let m: RegExpExecArray | null
    HTTP_METHOD_CALL.lastIndex = 0
    while ((m = HTTP_METHOD_CALL.exec(text))) add(m[1].toUpperCase(), m[3])
    FETCH_CALL.lastIndex = 0
    while ((m = FETCH_CALL.exec(text))) add("GET", m[2])
    API_PATH_LITERAL.lastIndex = 0
    while ((m = API_PATH_LITERAL.exec(text))) add("GET", m[2])
    return [...out.values()]
  }

  // JS-in-JS: string literals that reference ANOTHER bundle (a webpack/vite chunk, a dynamic
  // import target, a modulepreload). Following these is the "recursive" step — the app shell loads
  // more code that carries more endpoints. Bounded + in-scope; the miner fetches each once.
  const JS_REF = /(["'`])([^"'`\s]+?\.m?js)(?:\?[^"'`]*)?\1/gi
  const DYNAMIC_IMPORT = /\bimport\s*\(\s*(["'`])([^"'`]+?)\1\s*\)/gi

  export function mineChunkUrls(text: string, jsUrl: string, inScope: (url: string) => boolean): string[] {
    const base = jsUrl // resolve chunk paths relative to the bundle's own URL, not the page origin
    const out = new Set<string>()
    const add = (raw: string) => {
      const cleaned = raw.trim()
      if (!cleaned || cleaned.startsWith("data:") || cleaned.startsWith("//")) return
      try {
        const abs = /^https?:\/\//i.test(cleaned) ? new URL(cleaned).href : new URL(cleaned, base).href
        if (!/\.m?js(?:$|\?)/i.test(abs)) return
        if (abs === jsUrl) return // don't re-mine self
        if (inScope(abs)) out.add(abs)
      } catch {}
    }
    let m: RegExpExecArray | null
    JS_REF.lastIndex = 0
    while ((m = JS_REF.exec(text))) add(m[2])
    DYNAMIC_IMPORT.lastIndex = 0
    while ((m = DYNAMIC_IMPORT.exec(text))) add(m[2])
    return [...out]
  }
}
