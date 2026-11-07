// Pure OpenAPI/Swagger spec parser (well-known API-doc discovery). Deterministic — no LLM. Turns a
// fetched spec (OpenAPI v3 / Swagger v2) into concrete API endpoints. These are DISCOVERED (never
// hit here) — emitted to the ingest pipeline so the vuln sub-agents test them and DataCollector
// surfaces them to the navigator.
//
// FLAG (intentional duplication): ported from the 1.x discovery-core
// `feat/discovery-core:packages/hackbrowser/src/discovery/detectors/openapi.ts` (Epic #125). That
// branch is not merged into hackbrowser-2.0, so the logic can't yet be shared by import. Collapse
// when it lands. Keep in sync until then. Sibling of `js-mine.ts` (same porting story).
export namespace OpenApi {
  export interface Endpoint {
    method: string
    url: string // absolute
  }

  // Common locations where an OpenAPI (v3) / Swagger (v2) spec is served.
  export const SPEC_CANDIDATES = [
    "/openapi.json",
    "/swagger.json",
    "/swagger/properties.json",
    "/swagger/v1/swagger.json",
    "/v3/api-docs",
    "/api-docs",
    "/v2/api-docs",
  ]

  const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"])

  interface Spec {
    openapi?: string
    swagger?: string
    paths?: Record<string, Record<string, unknown>>
    servers?: { url?: string }[]
    basePath?: string
    host?: string
    schemes?: string[]
  }

  // Resolve the API base URL: OpenAPI v3 `servers`, else Swagger v2 host/basePath, else spec origin.
  export function resolveBase(spec: Spec, specUrl: string): string {
    const origin = new URL(specUrl).origin
    const server = spec.servers?.[0]?.url
    if (server) {
      try {
        return new URL(server, origin).href.replace(/\/+$/, "")
      } catch {
        /* fall through */
      }
    }
    if (spec.host) {
      const scheme = spec.schemes?.[0] ?? new URL(specUrl).protocol.replace(":", "")
      return `${scheme}://${spec.host}${spec.basePath ?? ""}`.replace(/\/+$/, "")
    }
    return (origin + (spec.basePath ?? "")).replace(/\/+$/, "")
  }

  // Parse a spec's paths × methods into endpoints, in scope. Path templates ({id}) are preserved.
  // `text` is the raw spec body; returns [] on anything malformed.
  export function parse(text: string, specUrl: string, inScope: (url: string) => boolean): Endpoint[] {
    let spec: Spec
    try {
      spec = JSON.parse(text) as Spec
    } catch {
      return []
    }
    if (!spec || !spec.paths || typeof spec.paths !== "object") return []
    let base: string
    try {
      base = resolveBase(spec, specUrl)
      if (!inScope(base)) return []
    } catch {
      return []
    }
    const out: Endpoint[] = []
    const seen = new Set<string>()
    for (const [path, item] of Object.entries(spec.paths)) {
      if (!item || typeof item !== "object") continue
      for (const method of Object.keys(item)) {
        if (!HTTP_METHODS.has(method.toLowerCase())) continue
        const url = base + path
        const key = `${method.toUpperCase()} ${url}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ method: method.toUpperCase(), url })
      }
    }
    return out
  }

  // Is this body plausibly an OpenAPI/Swagger spec (cheap check before a full parse)?
  export function looksLikeSpec(text: string): boolean {
    return /"(openapi|swagger)"\s*:/.test(text) && /"paths"\s*:/.test(text)
  }
}
