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

  const setCookie = resp.headers.get("set-cookie")
  if (setCookie) {
    const sessionLike = /session|token|auth|sid|connect\.sid|PHPSESSID|JSESSIONID/i.test(setCookie)
    if (sessionLike) {
      const cookieIssues: string[] = []
      if (!/;\s*secure/i.test(setCookie)) cookieIssues.push("missing Secure flag")
      if (!/;\s*httponly/i.test(setCookie)) cookieIssues.push("missing HttpOnly flag")
      if (!/;\s*samesite/i.test(setCookie)) cookieIssues.push("missing SameSite attribute")
      if (cookieIssues.length > 0) {
        output.push(`\n[!] Session cookie security issues:`)
        for (const issue of cookieIssues) output.push(`    ${issue}`)
        findings.push({
          checkId: "WEB-HDR-COOKIE",
          provider: "web-recon",
          severity: "medium",
          status: "WEAK",
          resource: target,
          title: "Session cookie missing security flags",
          details: `Set-Cookie header: ${cookieIssues.join(", ")}`,
          remediation: "Add Secure, HttpOnly, and SameSite=Lax (or Strict) to session cookies",
          cwe: "CWE-614",
        })
      }
    }
  }

  const score = Math.round((present.length / HEADER_CHECKS.length) * 100)
  output.push(`\n[*] Security header score: ${score}% (${present.length}/${HEADER_CHECKS.length})`)

  return { output: output.join("\n"), findings }
}

// ---------------------------------------------------------------------------
// sensitive_files
// ---------------------------------------------------------------------------

type SensitiveProbe = {
  id: string
  path: string
  title: string
  severity: string
  cwe: string
  validate: (text: string, status: number) => boolean
}

const SENSITIVE_PROBES: SensitiveProbe[] = [
  {
    id: "ENV", path: "/.env",
    title: ".env file exposed (credentials/secrets)", severity: "critical", cwe: "CWE-538",
    validate: (text) => /^[A-Z_]+=.+/m.test(text) || /DB_PASSWORD|API_KEY|SECRET|AWS_/i.test(text),
  },
  {
    id: "GIT-HEAD", path: "/.git/HEAD",
    title: "Git repository exposed", severity: "high", cwe: "CWE-538",
    validate: (text) => /^ref: refs\//.test(text.trim()),
  },
  {
    id: "GIT-CONFIG", path: "/.git/config",
    title: "Git config exposed (may contain credentials)", severity: "high", cwe: "CWE-538",
    validate: (text) => text.includes("[core]") || text.includes("[remote"),
  },
  {
    id: "DS-STORE", path: "/.DS_Store",
    title: "macOS .DS_Store exposes directory listing", severity: "medium", cwe: "CWE-538",
    validate: (text) => text.startsWith("\x00\x00\x00\x01Bud1"),
  },
  {
    id: "SVN", path: "/.svn/entries",
    title: "SVN repository exposed", severity: "high", cwe: "CWE-538",
    validate: (text, status) => status === 200 && (text.startsWith("10") || text.startsWith("12") || text.includes("dir\n")),
  },
  {
    id: "SERVER-STATUS", path: "/server-status",
    title: "Apache server-status exposed", severity: "medium", cwe: "CWE-200",
    validate: (text) => text.includes("Apache Server Status") || text.includes("Server uptime"),
  },
  {
    id: "SERVER-INFO", path: "/server-info",
    title: "Apache server-info exposed", severity: "medium", cwe: "CWE-200",
    validate: (text) => text.includes("Apache Server Information") || text.includes("Server Settings"),
  },
  {
    id: "PHPINFO", path: "/phpinfo.php",
    title: "phpinfo() page exposed", severity: "medium", cwe: "CWE-200",
    validate: (text) => text.includes("phpinfo()") || text.includes("PHP Version"),
  },
  {
    id: "INFO-PHP", path: "/info.php",
    title: "PHP info page exposed", severity: "medium", cwe: "CWE-200",
    validate: (text) => text.includes("phpinfo()") || text.includes("PHP Version"),
  },
  {
    id: "ELMAH", path: "/elmah.axd",
    title: "ELMAH error log exposed (ASP.NET)", severity: "high", cwe: "CWE-209",
    validate: (text) => text.includes("Error Log for") || text.includes("ELMAH"),
  },
  {
    id: "TRACE-AXD", path: "/trace.axd",
    title: "ASP.NET trace exposed", severity: "high", cwe: "CWE-209",
    validate: (text) => text.includes("Application Trace") || text.includes("Request Details"),
  },
  {
    id: "ACTUATOR-ENV", path: "/actuator/env",
    title: "Spring Boot actuator /env exposed", severity: "critical", cwe: "CWE-200",
    validate: (text) => {
      try { const j = JSON.parse(text); return j.propertySources !== undefined || j.activeProfiles !== undefined } catch { return false }
    },
  },
  {
    id: "ACTUATOR-HEALTH", path: "/actuator/health",
    title: "Spring Boot actuator /health exposed", severity: "low", cwe: "CWE-200",
    validate: (text) => {
      try { const j = JSON.parse(text); return j.status === "UP" || j.status === "DOWN" } catch { return false }
    },
  },
  {
    id: "ACTUATOR-INDEX", path: "/actuator",
    title: "Spring Boot actuator index exposed", severity: "medium", cwe: "CWE-200",
    validate: (text) => {
      try { const j = JSON.parse(text); return j._links !== undefined } catch { return false }
    },
  },
  {
    id: "DEBUG-VARS", path: "/debug/vars",
    title: "Go debug variables exposed", severity: "medium", cwe: "CWE-200",
    validate: (text) => {
      try { const j = JSON.parse(text); return j.cmdline !== undefined || j.memstats !== undefined } catch { return false }
    },
  },
  {
    id: "WP-CONFIG-BAK", path: "/wp-config.php.bak",
    title: "WordPress config backup exposed", severity: "critical", cwe: "CWE-538",
    validate: (text) => text.includes("DB_PASSWORD") || text.includes("DB_NAME"),
  },
  {
    id: "WP-CONFIG-TILDE", path: "/wp-config.php~",
    title: "WordPress config editor backup exposed", severity: "critical", cwe: "CWE-538",
    validate: (text) => text.includes("DB_PASSWORD") || text.includes("DB_NAME"),
  },
  {
    id: "CROSSDOMAIN", path: "/crossdomain.xml",
    title: "Overly permissive crossdomain.xml", severity: "medium", cwe: "CWE-942",
    validate: (text) => text.includes('domain="*"') || text.includes('to-ports="*"'),
  },
  {
    id: "WEB-CONFIG", path: "/web.config",
    title: "IIS web.config exposed", severity: "high", cwe: "CWE-538",
    validate: (text) => text.includes("<configuration") && text.includes("<system.web"),
  },
  {
    id: "SECURITY-TXT", path: "/.well-known/security.txt",
    title: "security.txt found (informational)", severity: "info", cwe: "CWE-200",
    validate: (text) => /contact:/i.test(text),
  },
  {
    id: "BACKUP-SQL", path: "/backup.sql",
    title: "SQL database dump exposed", severity: "critical", cwe: "CWE-538",
    validate: (text) => /^(--|CREATE TABLE|INSERT INTO|DROP TABLE)/m.test(text),
  },
  {
    id: "DUMP-SQL", path: "/dump.sql",
    title: "SQL database dump exposed", severity: "critical", cwe: "CWE-538",
    validate: (text) => /^(--|CREATE TABLE|INSERT INTO|DROP TABLE)/m.test(text),
  },
]

export async function sensitiveFiles(target: string, _args: string[], timeout: number): Promise<WebReconResult> {
  const findings: Finding[] = []
  const output: string[] = [`[*] Probing for sensitive files at ${target}`]
  const origin = new URL(target).origin

  const results = await Promise.allSettled(
    SENSITIVE_PROBES.map((probe) => safeFetch(origin + probe.path, { timeout })),
  )

  for (let i = 0; i < SENSITIVE_PROBES.length; i++) {
    const r = results[i]
    if (r.status !== "fulfilled" || !r.value) continue
    const resp = r.value
    if (resp.status >= 400) continue
    const probe = SENSITIVE_PROBES[i]
    if (!probe.validate(resp.text, resp.status)) continue

    const url = origin + probe.path
    output.push(`[+] FOUND: ${url} — ${probe.title}`)
    findings.push({
      checkId: `WEB-FILE-${probe.id}`,
      provider: "web-recon",
      severity: probe.severity,
      status: "VULNERABLE",
      resource: url,
      title: probe.title,
      details: `Sensitive file accessible at ${url} (HTTP ${resp.status}, ${resp.text.length} bytes)`,
      remediation: `Block public access to ${probe.path} via web server configuration or WAF rules`,
      cwe: probe.cwe,
    })
  }

  if (findings.length === 0) {
    output.push("[*] No sensitive files found at standard paths")
  } else {
    output.push(`\n[!] ${findings.length} sensitive file(s) exposed`)
  }

  return { output: output.join("\n"), findings }
}

// ---------------------------------------------------------------------------
// cors_check
// ---------------------------------------------------------------------------

export async function corsCheck(target: string, _args: string[], timeout: number): Promise<WebReconResult> {
  const findings: Finding[] = []
  const output: string[] = [`[*] Testing CORS configuration for ${target}`]

  const targetHost = new URL(target).hostname
  const origins = [
    { origin: "https://evil.com", label: "arbitrary origin" },
    { origin: "null", label: "null origin" },
    { origin: `https://evil.${targetHost}`, label: "subdomain prefix" },
    { origin: `https://${targetHost}.evil.com`, label: "domain suffix" },
  ]

  for (const test of origins) {
    const resp = await safeFetch(target, {
      timeout,
      headers: { Origin: test.origin },
    })
    if (!resp) continue

    const acao = resp.headers.get("access-control-allow-origin")
    const acac = resp.headers.get("access-control-allow-credentials")

    if (!acao) continue

    const reflected = acao === test.origin || acao === "*"
    const withCreds = acac?.toLowerCase() === "true"

    if (acao === "*" && withCreds) {
      output.push(`[+] CRITICAL: Access-Control-Allow-Origin: * with Access-Control-Allow-Credentials: true`)
      output.push(`    This is an invalid combination per spec but some browsers may not enforce it`)
      findings.push({
        checkId: "WEB-CORS-001",
        provider: "web-recon",
        severity: "high",
        status: "VULNERABLE",
        resource: target,
        title: "CORS wildcard with credentials",
        details: `Access-Control-Allow-Origin: * combined with Access-Control-Allow-Credentials: true`,
        remediation: "Never combine wildcard ACAO with credentials. Validate the Origin header against an allowlist",
        cwe: "CWE-942",
      })
    } else if (reflected && test.origin !== "*" && test.origin !== "null") {
      const severity = withCreds ? "high" : "medium"
      output.push(`[+] ${severity.toUpperCase()}: Origin "${test.origin}" reflected in Access-Control-Allow-Origin`)
      if (withCreds) output.push(`    Access-Control-Allow-Credentials: true — attacker can read authenticated responses`)
      findings.push({
        checkId: "WEB-CORS-002",
        provider: "web-recon",
        severity,
        status: "VULNERABLE",
        resource: target,
        title: `CORS origin reflection (${test.label})${withCreds ? " with credentials" : ""}`,
        details: `Origin "${test.origin}" is reflected in ACAO header${withCreds ? " with ACAC:true — full cross-origin data theft" : ""}`,
        remediation: "Validate the Origin header server-side against a strict allowlist. Do not reflect arbitrary origins",
        cwe: "CWE-942",
      })
    } else if (acao === "null" && test.origin === "null") {
      output.push(`[+] MEDIUM: Access-Control-Allow-Origin: null accepted`)
      output.push(`    Exploitable via sandboxed iframes (sandbox attribute strips origin to null)`)
      findings.push({
        checkId: "WEB-CORS-003",
        provider: "web-recon",
        severity: withCreds ? "high" : "medium",
        status: "VULNERABLE",
        resource: target,
        title: `CORS null origin accepted${withCreds ? " with credentials" : ""}`,
        details: `Server accepts Origin: null — exploitable via sandboxed iframes${withCreds ? " with credential sharing" : ""}`,
        remediation: "Do not whitelist the null origin. Validate against explicit domain allowlist",
        cwe: "CWE-942",
      })
    } else if (acao === "*") {
      output.push(`[*] Access-Control-Allow-Origin: * (public API, no credentials)`)
    }
  }

  if (findings.length === 0) {
    const baseline = await safeFetch(target, { timeout })
    const acao = baseline?.headers.get("access-control-allow-origin")
    if (!acao) {
      output.push("[*] No CORS headers present — same-origin policy enforced")
    } else {
      output.push(`[*] CORS properly configured: Access-Control-Allow-Origin: ${acao}`)
    }
  }

  return { output: output.join("\n"), findings }
}

// ---------------------------------------------------------------------------
// method_check
// ---------------------------------------------------------------------------

const DANGEROUS_METHODS = ["TRACE", "PUT", "DELETE"]

export async function methodCheck(target: string, _args: string[], timeout: number): Promise<WebReconResult> {
  const findings: Finding[] = []
  const output: string[] = [`[*] Testing HTTP methods for ${target}`]

  const optResp = await safeFetch(target, { timeout, method: "OPTIONS" })
  if (optResp) {
    const allow = optResp.headers.get("allow")
    if (allow) {
      output.push(`[+] OPTIONS Allow header: ${allow}`)
      const methods = allow.split(",").map((m) => m.trim().toUpperCase())
      for (const m of DANGEROUS_METHODS) {
        if (methods.includes(m)) {
          output.push(`[!] Dangerous method advertised: ${m}`)
        }
      }
    } else {
      output.push(`[*] OPTIONS returned HTTP ${optResp.status} (no Allow header)`)
    }
  }

  const traceResp = await safeFetch(target, { timeout, method: "TRACE" })
  if (traceResp && traceResp.status === 200) {
    const ct = (traceResp.headers.get("content-type") || "").toLowerCase()
    const reflected = ct.includes("message/http") || traceResp.text.includes("TRACE / ")
    if (reflected) {
      output.push(`[+] TRACE method enabled — Cross-Site Tracing (XST) possible`)
      output.push(`    Response reflects the request including cookies and auth headers`)
      findings.push({
        checkId: "WEB-METHOD-001",
        provider: "web-recon",
        severity: "medium",
        status: "VULNERABLE",
        resource: target,
        title: "TRACE method enabled (XST)",
        details: `TRACE returns HTTP 200 with reflected request body — combined with XSS this leaks HttpOnly cookies`,
        remediation: "Disable TRACE method in the web server configuration (TraceEnable Off for Apache)",
        cwe: "CWE-693",
      })
    }
  }

  for (const method of ["PUT", "DELETE"]) {
    const resp = await safeFetch(target, { timeout, method })
    if (!resp) continue
    if (resp.status < 400 && resp.status !== 301 && resp.status !== 302) {
      output.push(`[+] ${method} method accepted (HTTP ${resp.status})`)
      findings.push({
        checkId: `WEB-METHOD-${method}`,
        provider: "web-recon",
        severity: "medium",
        status: "VULNERABLE",
        resource: target,
        title: `${method} method accepted on root`,
        details: `HTTP ${method} returned status ${resp.status} — may allow unauthorized resource modification/deletion`,
        remediation: `Restrict ${method} method to authenticated and authorized requests only`,
        cwe: "CWE-749",
      })
    }
  }

  if (findings.length === 0) {
    output.push("[*] No dangerous HTTP methods enabled")
  }

  return { output: output.join("\n"), findings }
}

// ---------------------------------------------------------------------------
// open_redirect
// ---------------------------------------------------------------------------

const REDIRECT_PARAMS = [
  "url", "next", "redirect", "return", "returnUrl", "return_url",
  "continue", "dest", "destination", "target", "rurl", "redirect_uri",
  "redirect_url", "forward", "go", "out", "callback", "redir",
]

const CANARY_DOMAIN = "https://evil.example.com"

export async function openRedirect(target: string, _args: string[], timeout: number): Promise<WebReconResult> {
  const findings: Finding[] = []
  const output: string[] = [`[*] Testing open redirect parameters at ${target}`]

  const base = new URL(target)
  let found = 0

  for (const param of REDIRECT_PARAMS) {
    const testUrl = new URL(target)
    testUrl.searchParams.set(param, CANARY_DOMAIN)

    const resp = await safeFetch(testUrl.href, {
      timeout,
      redirect: "manual",
    })
    if (!resp) continue

    const location = resp.headers.get("location") || ""
    const isRedirect = resp.status >= 300 && resp.status < 400

    if (isRedirect && location.includes("evil.example.com")) {
      found++
      output.push(`[+] OPEN REDIRECT: ?${param}=${CANARY_DOMAIN}`)
      output.push(`    HTTP ${resp.status} Location: ${location}`)
      findings.push({
        checkId: `WEB-REDIR-${String(found).padStart(3, "0")}`,
        provider: "web-recon",
        severity: "medium",
        status: "VULNERABLE",
        resource: `${base.origin}${base.pathname}?${param}=`,
        title: `Open redirect via ?${param} parameter`,
        details: `Parameter "${param}" redirects to arbitrary external domain (HTTP ${resp.status} -> ${location})`,
        remediation: "Validate redirect targets against an allowlist of trusted domains. Use relative paths instead of full URLs",
        cwe: "CWE-601",
      })
    }

    const metaRefresh = resp.text.match(/meta\s+http-equiv=["']refresh["']\s+content=["']\d+;\s*url=([^"']+)/i)
    if (metaRefresh && metaRefresh[1].includes("evil.example.com")) {
      found++
      output.push(`[+] OPEN REDIRECT (meta refresh): ?${param}=${CANARY_DOMAIN}`)
      findings.push({
        checkId: `WEB-REDIR-${String(found).padStart(3, "0")}`,
        provider: "web-recon",
        severity: "medium",
        status: "VULNERABLE",
        resource: `${base.origin}${base.pathname}?${param}=`,
        title: `Open redirect via meta refresh on ?${param}`,
        details: `Parameter "${param}" causes meta refresh redirect to external domain`,
        remediation: "Validate redirect targets server-side before rendering meta refresh tags",
        cwe: "CWE-601",
      })
    }

    const jsRedirect = resp.text.match(/(?:window\.location|location\.href)\s*=\s*["']([^"']*evil\.example\.com[^"']*)/i)
    if (jsRedirect) {
      found++
      output.push(`[+] OPEN REDIRECT (JavaScript): ?${param}=${CANARY_DOMAIN}`)
      findings.push({
        checkId: `WEB-REDIR-${String(found).padStart(3, "0")}`,
        provider: "web-recon",
        severity: "medium",
        status: "VULNERABLE",
        resource: `${base.origin}${base.pathname}?${param}=`,
        title: `Open redirect via JavaScript on ?${param}`,
        details: `Parameter "${param}" value injected into JavaScript redirect`,
        remediation: "Sanitize user input before use in client-side redirects",
        cwe: "CWE-601",
      })
    }
  }

  if (found === 0) {
    output.push(`[*] Tested ${REDIRECT_PARAMS.length} redirect parameters — no open redirects found`)
  } else {
    output.push(`\n[!] ${found} open redirect(s) found`)
  }

  return { output: output.join("\n"), findings }
}

// ---------------------------------------------------------------------------
// full_recon
// ---------------------------------------------------------------------------

type ProgramFn = (target: string, args: string[], timeout: number) => Promise<WebReconResult>

const RECON_SUITE: { label: string; fn: ProgramFn }[] = [
  { label: "Technology Detection", fn: techDetect },
  { label: "Security Headers", fn: headerAudit },
  { label: "Sensitive Files", fn: sensitiveFiles },
  { label: "CORS Configuration", fn: corsCheck },
  { label: "HTTP Methods", fn: methodCheck },
  { label: "Open Redirect", fn: openRedirect },
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
