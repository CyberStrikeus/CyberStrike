import type { ScopeMatcher } from "../../scope.ts"
import { register } from "../registry.ts"
import { EMPTY_RESULT, type Detector, type DiscoveryContext, type DiscoveryResult, type Endpoint } from "../detector.ts"

// Common locations where an OpenAPI (v3) / Swagger (v2) spec is served.
const SPEC_CANDIDATES = [
  "/openapi.json",
  "/swagger.json",
  "/v3/api-docs",
  "/api-docs",
  "/swagger/v1/swagger.json",
  "/v2/api-docs",
]

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"])

interface OpenApiSpec {
  openapi?: string
  swagger?: string
  paths?: Record<string, Record<string, unknown>>
  servers?: { url?: string }[]
  basePath?: string
  host?: string
  schemes?: string[]
}

/** Resolve the API base URL: OpenAPI v3 `servers`, else Swagger v2 host/basePath, else spec origin. */
export function resolveBase(spec: OpenApiSpec, specUrl: string): string {
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

/** Turn a spec's paths x methods into Endpoints. Path templates ({id}) are preserved. */
export function parseSpec(spec: OpenApiSpec, specUrl: string, inScope: ScopeMatcher): Endpoint[] {
  if (!spec.paths || typeof spec.paths !== "object") return []
  const base = resolveBase(spec, specUrl)
  let baseHost: string
  try {
    baseHost = new URL(base).hostname
  } catch {
    return []
  }
  if (!inScope(baseHost)) return []

  const endpoints: Endpoint[] = []
  for (const [path, item] of Object.entries(spec.paths)) {
    if (!item || typeof item !== "object") continue
    for (const method of Object.keys(item)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue
      endpoints.push({ method: method.toUpperCase(), url: base + path, source: "openapi" })
    }
  }
  return endpoints
}

/**
 * Discover API endpoints from an OpenAPI/Swagger spec served by the target.
 * Endpoints are emitted (not navigated) — the proxy-agents test them via
 * http_replay; the crawler never blindly hits a non-GET endpoint.
 */
const openapi: Detector = {
  name: "openapi",
  kind: "spec",
  async applies(): Promise<boolean> {
    return true // cheap: probe common spec URLs
  },
  async detect(ctx: DiscoveryContext): Promise<DiscoveryResult> {
    const origin = new URL(ctx.baseUrl).origin
    for (const path of SPEC_CANDIDATES) {
      const text = await ctx.fetchText(origin + path)
      if (!text) continue
      let spec: OpenApiSpec
      try {
        spec = JSON.parse(text)
      } catch {
        continue // not JSON
      }
      if (!spec.openapi && !spec.swagger) continue // not an OpenAPI/Swagger doc
      const endpoints = parseSpec(spec, origin + path, ctx.inScope)
      if (endpoints.length > 0) return { pages: [], endpoints, confidence: 1 }
    }
    return EMPTY_RESULT
  },
}

register(openapi)
export { openapi }
