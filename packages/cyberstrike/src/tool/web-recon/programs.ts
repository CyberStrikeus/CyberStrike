import { safeFetch, extractLocs } from "./shared"
import type { Finding, WebReconResult } from "./shared"

// ---------------------------------------------------------------------------
// sitemap_scan
// ---------------------------------------------------------------------------

const MAX_CHILD_SITEMAPS = 20

export async function sitemapScan(target: string, _args: string[], timeout: number): Promise<WebReconResult> {
  const findings: Finding[] = []
  const output: string[] = [`[*] Scanning sitemaps for ${target}`]
  const origin = new URL(target).origin

  const candidates = ["/sitemap.xml", "/sitemap_index.xml"]
  const pages = new Set<string>()
  let foundAt = ""

  for (const path of candidates) {
    const resp = await safeFetch(origin + path, { timeout })
    if (!resp || resp.status !== 200 || !resp.text.includes("<")) continue

    foundAt = origin + path
    const locs = extractLocs(resp.text)

    if (/<sitemapindex/i.test(resp.text)) {
      output.push(`[+] Sitemap index found: ${foundAt} (${locs.length} child sitemaps)`)
      let fetched = 0
      for (const child of locs.slice(0, MAX_CHILD_SITEMAPS)) {
        const childResp = await safeFetch(child, { timeout })
        if (!childResp || childResp.status !== 200) continue
        for (const loc of extractLocs(childResp.text)) pages.add(loc)
        fetched++
      }
      output.push(`[*] Fetched ${fetched} child sitemaps`)
    } else {
      output.push(`[+] Sitemap found: ${foundAt}`)
      for (const loc of locs) pages.add(loc)
    }
    break
  }

  if (pages.size === 0 && !foundAt) {
    output.push("[-] No sitemap found")
    return { output: output.join("\n"), findings }
  }

  output.push(`[+] Total URLs discovered: ${pages.size}`)
  if (pages.size > 0) {
    const sorted = [...pages].sort()
    for (const url of sorted.slice(0, 50)) output.push(`    ${url}`)
    if (sorted.length > 50) output.push(`    ... and ${sorted.length - 50} more`)

    findings.push({
      checkId: "WEB-SITEMAP-001",
      provider: "web-recon",
      severity: "info",
      status: "FOUND",
      resource: foundAt,
      title: `Sitemap with ${pages.size} URLs`,
      details: `Sitemap at ${foundAt} exposes ${pages.size} application URLs`,
      remediation: "Review sitemap for sensitive or admin URLs that should not be publicly indexed",
    })
  }

  return { output: output.join("\n"), findings }
}

// ---------------------------------------------------------------------------
// robots_scan
// ---------------------------------------------------------------------------

export async function robotsScan(target: string, _args: string[], timeout: number): Promise<WebReconResult> {
  const findings: Finding[] = []
  const output: string[] = [`[*] Scanning robots.txt for ${target}`]
  const origin = new URL(target).origin

  const resp = await safeFetch(origin + "/robots.txt", { timeout })
  if (!resp || resp.status !== 200) {
    output.push("[-] No robots.txt found")
    return { output: output.join("\n"), findings }
  }

  output.push(`[+] robots.txt found (${resp.text.length} bytes)`)

  const disallow: string[] = []
  const allow: string[] = []
  const sitemaps: string[] = []

  for (const line of resp.text.split(/\r?\n/)) {
    const trimmed = line.trim()
    const disMatch = /^disallow\s*:\s*(\S+)/i.exec(trimmed)
    if (disMatch && disMatch[1] !== "/") disallow.push(disMatch[1])
    const allowMatch = /^allow\s*:\s*(\S+)/i.exec(trimmed)
    if (allowMatch && allowMatch[1] !== "/") allow.push(allowMatch[1])
    const smMatch = /^sitemap\s*:\s*(\S+)/i.exec(trimmed)
    if (smMatch) sitemaps.push(smMatch[1])
  }

  if (disallow.length > 0) {
    output.push(`\n[+] Disallow entries (${disallow.length}):`)
    for (const path of disallow) output.push(`    ${path}`)
    findings.push({
      checkId: "WEB-ROBOTS-001",
      provider: "web-recon",
      severity: "info",
      status: "FOUND",
      resource: origin + "/robots.txt",
      title: `${disallow.length} disallowed paths in robots.txt`,
      details: `Disallowed paths often reveal admin/API/sensitive areas: ${disallow.slice(0, 5).join(", ")}`,
      remediation: "Test disallowed paths for access control issues — robots.txt is not a security mechanism",
    })
  }

  if (allow.length > 0) {
    output.push(`\n[+] Allow entries (${allow.length}):`)
    for (const path of allow) output.push(`    ${path}`)
  }

  if (sitemaps.length > 0) {
    output.push(`\n[+] Sitemap references (${sitemaps.length}):`)
    for (const sm of sitemaps) output.push(`    ${sm}`)
  }

  return { output: output.join("\n"), findings }
}

// ---------------------------------------------------------------------------
// openapi_scan
// ---------------------------------------------------------------------------

const SPEC_CANDIDATES = [
  "/openapi.json",
  "/swagger.json",
  "/v3/api-docs",
  "/api-docs",
  "/swagger/v1/swagger.json",
  "/v2/api-docs",
  "/api/openapi.json",
  "/api/swagger.json",
]

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"])

export async function openapiScan(target: string, _args: string[], timeout: number): Promise<WebReconResult> {
  const findings: Finding[] = []
  const output: string[] = [`[*] Probing for OpenAPI/Swagger specs at ${target}`]
  const origin = new URL(target).origin

  for (const path of SPEC_CANDIDATES) {
    const resp = await safeFetch(origin + path, { timeout })
    if (!resp || resp.status !== 200) continue

    let spec: Record<string, unknown>
    try {
      spec = JSON.parse(resp.text)
    } catch {
      continue
    }
    if (!spec.openapi && !spec.swagger) continue

    const version = (spec.openapi || spec.swagger) as string
    const specUrl = origin + path
    output.push(`[+] OpenAPI spec found: ${specUrl} (version ${version})`)

    const paths = spec.paths as Record<string, Record<string, unknown>> | undefined
    if (paths && typeof paths === "object") {
      const methods: Record<string, number> = {}
      let total = 0
      for (const [, item] of Object.entries(paths)) {
        if (!item || typeof item !== "object") continue
        for (const method of Object.keys(item)) {
          if (!HTTP_METHODS.has(method.toLowerCase())) continue
          methods[method.toUpperCase()] = (methods[method.toUpperCase()] || 0) + 1
          total++
        }
      }

      const pathCount = Object.keys(paths).length
      output.push(`[+] Paths: ${pathCount}, Endpoints: ${total}`)
      output.push(`[+] Methods: ${Object.entries(methods).map(([m, c]) => `${m}:${c}`).join(", ")}`)

      output.push("\n    Paths:")
      for (const p of Object.keys(paths).slice(0, 30)) output.push(`    ${p}`)
      if (pathCount > 30) output.push(`    ... and ${pathCount - 30} more`)

      findings.push({
        checkId: "WEB-OPENAPI-001",
        provider: "web-recon",
        severity: "medium",
        status: "FOUND",
        resource: specUrl,
        title: `OpenAPI spec exposed with ${total} endpoints`,
        details: `${version} spec at ${specUrl} — ${pathCount} paths, ${total} operations`,
        remediation: "Review whether the API specification should be publicly accessible. Check for undocumented/admin endpoints",
      })
    }

    const info = spec.info as Record<string, string> | undefined
    if (info) {
      if (info.title) output.push(`\n    Title: ${info.title}`)
      if (info.version) output.push(`    API Version: ${info.version}`)
    }

    const secDefs =
      (spec.components as Record<string, unknown>)?.securitySchemes || spec.securityDefinitions
    if (secDefs && typeof secDefs === "object") {
      output.push(`\n[+] Auth schemes: ${Object.keys(secDefs as object).join(", ")}`)
    }

    return { output: output.join("\n"), findings }
  }

  output.push("[-] No OpenAPI/Swagger spec found at standard paths")
  return { output: output.join("\n"), findings }
}

// ---------------------------------------------------------------------------
// graphql_probe
// ---------------------------------------------------------------------------

const GQL_CANDIDATES = ["/graphql", "/api/graphql", "/query", "/v1/graphql", "/gql"]
const TYPENAME_BODY = JSON.stringify({ query: "{__typename}" })

export async function graphqlProbe(target: string, _args: string[], timeout: number): Promise<WebReconResult> {
  const findings: Finding[] = []
  const output: string[] = [`[*] Probing for GraphQL endpoints at ${target}`]
  const origin = new URL(target).origin

  for (const path of GQL_CANDIDATES) {
    const url = origin + path
    const resp = await safeFetch(url, {
      timeout,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: TYPENAME_BODY,
    })
    if (!resp) continue

    let data: Record<string, unknown>
    try {
      data = JSON.parse(resp.text)
    } catch {
      continue
    }
    if (!data.data && !data.errors) continue

    output.push(`[+] GraphQL endpoint confirmed: ${url}`)
    const dataObj = data.data as Record<string, unknown> | undefined
    if (dataObj?.__typename) output.push(`    __typename: ${dataObj.__typename}`)

    let introspectionEnabled = false
    const introspBody = JSON.stringify({
      query:
        "{ __schema { queryType { name } mutationType { name } subscriptionType { name } types { name kind } } }",
    })
    const intrResp = await safeFetch(url, {
      timeout,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: introspBody,
    })

    if (intrResp) {
      try {
        const intrData = JSON.parse(intrResp.text)
        const schema = intrData.data?.__schema
        if (schema) {
          introspectionEnabled = true
          const types = schema.types?.length || 0
          const queryName = schema.queryType?.name || "Query"
          const mutationName = schema.mutationType?.name
          output.push(`    Introspection: ENABLED`)
          output.push(`    Types: ${types}`)
          output.push(`    Query type: ${queryName}`)
          if (mutationName) output.push(`    Mutation type: ${mutationName}`)

          findings.push({
            checkId: "WEB-GRAPHQL-002",
            provider: "web-recon",
            severity: "medium",
            status: "FOUND",
            resource: url,
            title: "GraphQL introspection enabled",
            details: `Full schema introspection available at ${url} — ${types} types exposed`,
            remediation: "Disable introspection in production (set introspection: false in GraphQL server config)",
            cwe: "CWE-200",
          })
        }
      } catch {
        /* not JSON */
      }
    }

    findings.push({
      checkId: "WEB-GRAPHQL-001",
      provider: "web-recon",
      severity: "info",
      status: "FOUND",
      resource: url,
      title: `GraphQL endpoint at ${path}`,
      details: `GraphQL at ${url}, introspection ${introspectionEnabled ? "enabled" : "disabled/restricted"}`,
      remediation: "Test for query depth attacks, batch queries, and authorization bypass on mutations",
    })

    return { output: output.join("\n"), findings }
  }

  output.push("[-] No GraphQL endpoint found at standard paths")
  return { output: output.join("\n"), findings }
}

// ---------------------------------------------------------------------------
// tech_detect
// ---------------------------------------------------------------------------

type TechHit = { category: string; name: string; evidence: string }

const COOKIE_FINGERPRINTS: [RegExp, string, string][] = [
  [/PHPSESSID/i, "Language", "PHP"],
  [/JSESSIONID/i, "Language", "Java"],
  [/ASP\.NET_SessionId/i, "Framework", "ASP.NET"],
  [/connect\.sid/i, "Framework", "Express.js"],
  [/laravel_session/i, "Framework", "Laravel"],
  [/rack\.session/i, "Framework", "Ruby/Rack"],
  [/csrftoken/i, "Framework", "Django"],
  [/_csrf_token/i, "Framework", "Phoenix/Rails"],
  [/wp-settings/i, "CMS", "WordPress"],
  [/ci_session/i, "Framework", "CodeIgniter"],
]

const HTML_FINGERPRINTS: [string, string, string][] = [
  ["wp-content", "CMS", "WordPress"],
  ["wp-includes", "CMS", "WordPress"],
  ["__next", "Framework", "Next.js"],
  ["__nuxt", "Framework", "Nuxt.js"],
  ["ng-version", "Framework", "Angular"],
  ["ng-app", "Framework", "Angular"],
  ["data-reactroot", "Framework", "React"],
  ["_reactroot", "Framework", "React"],
  ['id="__vue"', "Framework", "Vue.js"],
  ["data-v-", "Framework", "Vue.js"],
  ["data-svelte", "Framework", "Svelte"],
  ["data-turbo", "Framework", "Hotwire/Turbo"],
  ["data-ember", "Framework", "Ember.js"],
  ["data-sveltekit", "Framework", "SvelteKit"],
  ["_blazor", "Framework", "Blazor"],
]

export async function techDetect(target: string, _args: string[], timeout: number): Promise<WebReconResult> {
  const findings: Finding[] = []
  const output: string[] = [`[*] Detecting technology stack for ${target}`]

  const resp = await safeFetch(target, { timeout })
  if (!resp) {
    output.push("[-] Target unreachable")
    return { output: output.join("\n"), findings }
  }

  output.push(`[+] HTTP ${resp.status}`)
  const techs: TechHit[] = []

  const server = resp.headers.get("server")
  if (server) techs.push({ category: "Server", name: server, evidence: "Server header" })

  const powered = resp.headers.get("x-powered-by")
  if (powered) techs.push({ category: "Framework", name: powered, evidence: "X-Powered-By header" })

  const aspnet = resp.headers.get("x-aspnet-version")
  if (aspnet) techs.push({ category: "Framework", name: `ASP.NET ${aspnet}`, evidence: "X-AspNet-Version" })

  const mvc = resp.headers.get("x-aspnetmvc-version")
  if (mvc) techs.push({ category: "Framework", name: `ASP.NET MVC ${mvc}`, evidence: "X-AspNetMvc-Version" })

  const cookies = resp.headers.get("set-cookie") || ""
  for (const [re, cat, name] of COOKIE_FINGERPRINTS) {
    if (re.test(cookies)) techs.push({ category: cat, name, evidence: `${name} session cookie` })
  }

  const gen = /meta\s+name=["']generator["']\s+content=["']([^"']+)/i.exec(resp.text)
  if (gen?.[1]) techs.push({ category: "CMS/Generator", name: gen[1], evidence: "meta generator" })

  const lower = resp.text.toLowerCase()
  for (const [pattern, cat, name] of HTML_FINGERPRINTS) {
    if (lower.includes(pattern.toLowerCase())) techs.push({ category: cat, name, evidence: `${pattern} in HTML` })
  }

  const cfRay = resp.headers.get("cf-ray")
  if (cfRay) techs.push({ category: "CDN/WAF", name: "Cloudflare", evidence: "cf-ray header" })
  const via = resp.headers.get("via") || ""
  if (via.toLowerCase().includes("cloudfront")) techs.push({ category: "CDN", name: "CloudFront", evidence: "via header" })
  if (resp.headers.get("x-vercel-id")) techs.push({ category: "Platform", name: "Vercel", evidence: "x-vercel-id" })
  if (resp.headers.get("x-nf-request-id")) techs.push({ category: "Platform", name: "Netlify", evidence: "x-nf-request-id" })
  if (resp.headers.get("x-amz-request-id")) techs.push({ category: "Cloud", name: "AWS", evidence: "x-amz-request-id" })
  if (resp.headers.get("x-azure-ref")) techs.push({ category: "Cloud", name: "Azure", evidence: "x-azure-ref" })

  const seen = new Set<string>()
  const deduped = techs.filter((t) => {
    const key = `${t.category}:${t.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (deduped.length === 0) {
    output.push("[-] No technology indicators detected from HTTP response")
    return { output: output.join("\n"), findings }
  }

  output.push(`\n[+] Detected technologies (${deduped.length}):`)
  const byCategory = new Map<string, TechHit[]>()
  for (const t of deduped) {
    if (!byCategory.has(t.category)) byCategory.set(t.category, [])
    byCategory.get(t.category)!.push(t)
  }
  for (const [cat, items] of byCategory) {
    output.push(`\n    ${cat}:`)
    for (const item of items) output.push(`      ${item.name} (${item.evidence})`)
  }

  const infoHeaders = [server, powered, aspnet, mvc].filter(Boolean)
  if (infoHeaders.length > 0) {
    findings.push({
      checkId: "WEB-TECH-001",
      provider: "web-recon",
      severity: "low",
      status: "FOUND",
      resource: target,
      title: "Server technology disclosed in HTTP headers",
      details: `Headers reveal: ${infoHeaders.join(", ")}`,
      remediation: "Remove or obfuscate Server, X-Powered-By, and version headers in production",
      cwe: "CWE-200",
    })
  }

  return { output: output.join("\n"), findings }
}

// ---------------------------------------------------------------------------
// header_audit
// ---------------------------------------------------------------------------

type HeaderCheck = {
  header: string
  severity: string
  checkId: string
  remediation: string
  cwe: string
}

const HEADER_CHECKS: HeaderCheck[] = [
  {
    header: "Strict-Transport-Security",
    severity: "medium",
    checkId: "WEB-HDR-HSTS",
    remediation: "Add Strict-Transport-Security: max-age=31536000; includeSubDomains",
    cwe: "CWE-523",
  },
  {
    header: "Content-Security-Policy",
    severity: "medium",
    checkId: "WEB-HDR-CSP",
    remediation: "Add Content-Security-Policy with restrictive directives (no unsafe-inline/unsafe-eval)",
    cwe: "CWE-1021",
  },
  {
    header: "X-Content-Type-Options",
    severity: "low",
    checkId: "WEB-HDR-XCTO",
    remediation: "Add X-Content-Type-Options: nosniff",
    cwe: "CWE-16",
  },
  {
    header: "X-Frame-Options",
    severity: "medium",
    checkId: "WEB-HDR-XFO",
    remediation: "Add X-Frame-Options: DENY (or SAMEORIGIN if framing is needed)",
    cwe: "CWE-1021",
  },
  {
    header: "Referrer-Policy",
    severity: "low",
    checkId: "WEB-HDR-RP",
    remediation: "Add Referrer-Policy: strict-origin-when-cross-origin (or no-referrer)",
    cwe: "CWE-200",
  },
  {
    header: "Permissions-Policy",
    severity: "low",
    checkId: "WEB-HDR-PP",
    remediation: "Add Permissions-Policy to restrict browser features (camera, microphone, geolocation)",
    cwe: "CWE-16",
  },
]

export async function headerAudit(target: string, _args: string[], timeout: number): Promise<WebReconResult> {
  const findings: Finding[] = []
  const output: string[] = [`[*] Auditing security headers for ${target}`]

  const resp = await safeFetch(target, { timeout })
  if (!resp) {
    output.push("[-] Target unreachable")
    return { output: output.join("\n"), findings }
  }

  const present: { header: string; value: string }[] = []
  const missing: HeaderCheck[] = []

  for (const check of HEADER_CHECKS) {
    const value = resp.headers.get(check.header.toLowerCase())
    if (value) {
      present.push({ header: check.header, value })
    } else {
      missing.push(check)
    }
  }

  if (present.length > 0) {
    output.push(`\n[+] Security headers present (${present.length}/${HEADER_CHECKS.length}):`)
    for (const h of present) {
      const truncated = h.value.length > 80 ? h.value.slice(0, 80) + "..." : h.value
      output.push(`    [+] ${h.header}: ${truncated}`)
    }
  }

  if (missing.length > 0) {
    output.push(`\n[!] Missing security headers (${missing.length}/${HEADER_CHECKS.length}):`)
    for (const h of missing) {
      output.push(`    [-] ${h.header}`)
      findings.push({
        checkId: h.checkId,
        provider: "web-recon",
        severity: h.severity,
        status: "MISSING",
        resource: target,
        title: `Missing ${h.header} header`,
        details: `The ${h.header} security header is not set on the response`,
        remediation: h.remediation,
        cwe: h.cwe,
      })
    }
  }

  const csp = resp.headers.get("content-security-policy")
  if (csp) {
    const weaknesses: string[] = []
    if (csp.includes("unsafe-inline")) weaknesses.push("unsafe-inline (allows inline scripts)")
    if (csp.includes("unsafe-eval")) weaknesses.push("unsafe-eval (allows eval())")
    if (csp.includes("'*'") || / \*[;\s]/.test(csp) || csp.endsWith(" *")) weaknesses.push("wildcard source")
    if (csp.includes("data:")) weaknesses.push("data: URI allowed")

    if (weaknesses.length > 0) {
      output.push(`\n[!] CSP weaknesses:`)
      for (const w of weaknesses) output.push(`    ${w}`)
      findings.push({
        checkId: "WEB-HDR-CSP-WEAK",
        provider: "web-recon",
        severity: "medium",
        status: "WEAK",
        resource: target,
        title: "Weak Content-Security-Policy directives",
        details: `CSP contains: ${weaknesses.join("; ")}`,
        remediation: "Remove unsafe-inline, unsafe-eval, and wildcard sources from CSP",
        cwe: "CWE-1021",
      })
    }
  }

  const score = Math.round((present.length / HEADER_CHECKS.length) * 100)
  output.push(`\n[*] Security header score: ${score}% (${present.length}/${HEADER_CHECKS.length})`)

  return { output: output.join("\n"), findings }
}

// ---------------------------------------------------------------------------
// full_recon
// ---------------------------------------------------------------------------

type ProgramFn = (target: string, args: string[], timeout: number) => Promise<WebReconResult>

const RECON_SUITE: { label: string; fn: ProgramFn }[] = [
  { label: "Technology Detection", fn: techDetect },
  { label: "Security Headers", fn: headerAudit },
  { label: "Sitemap", fn: sitemapScan },
  { label: "Robots.txt", fn: robotsScan },
  { label: "OpenAPI/Swagger", fn: openapiScan },
  { label: "GraphQL", fn: graphqlProbe },
]

export async function fullRecon(target: string, args: string[], timeout: number): Promise<WebReconResult> {
  const findings: Finding[] = []
  const output: string[] = [`=== FULL WEB RECONNAISSANCE: ${target} ===`]

  for (const suite of RECON_SUITE) {
    output.push(`\n--- ${suite.label} ---`)
    try {
      const result = await suite.fn(target, args, timeout)
      output.push(result.output)
      findings.push(...result.findings)
    } catch (err) {
      output.push(`[!] ${suite.label} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  output.push(`\n=== SUMMARY ===`)
  output.push(`[*] Total findings: ${findings.length}`)
  const bySeverity: Record<string, number> = {}
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1
  if (Object.keys(bySeverity).length > 0) {
    output.push(`[*] By severity: ${Object.entries(bySeverity).map(([s, c]) => `${s}:${c}`).join(", ")}`)
  }

  return { output: output.join("\n"), findings }
}
