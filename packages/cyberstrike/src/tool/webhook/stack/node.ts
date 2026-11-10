// nodejs stack checks — ported from infra-security-mcp `providers/nodejs` (node_*).
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, host, summarize, type Check } from "./shared"

export namespace Node {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: "no response" }
    const miss = await get(sender, `${origin}/__404_${Date.now()}`)
    const node =
      /Express|Next\.js|Nuxt/i.test(header(res, "x-powered-by")) ||
      /__NEXT_DATA__|\/_nuxt\//.test(res.body) ||
      (ok(miss) && /^Cannot (GET|POST)/.test(miss.body))
    if (!node) return { check: "detect", hit: false, severity: "info", detail: "Node/Express not detected" }
    return { check: "detect", hit: true, severity: "info", detail: "Node.js (Express/Next/Nuxt) detected", evidence: header(res, "x-powered-by") || "Cannot GET / __NEXT_DATA__" }
  }

  export async function debugPort(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, `http://${host(origin)}:9229/json/list`)
    if (ok(res) && res.status === 200 && /webSocketDebuggerUrl/.test(res.body))
      return { check: "debug_port", hit: true, severity: "critical", detail: "Node inspector (:9229) exposed — remote debugging = RCE", evidence: res.body.slice(0, 200) }
    return { check: "debug_port", hit: false, severity: "info", detail: "Node inspector port not exposed (in-scope)" }
  }

  export async function prototypePollution(sender: HttpSender, origin: string): Promise<Check> {
    const res = await sender.send({ method: "POST", url: `${origin}/api`, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ __proto__: { polluted: "cs_pp_marker" } }) })
    if (failed(res)) return { check: "prototype_pollution", hit: false, severity: "info", detail: "no JSON endpoint at /api" }
    if (res.body.includes("cs_pp_marker") || /TypeError|prototype/i.test(res.body))
      return { check: "prototype_pollution", hit: true, severity: "high", detail: "prototype-pollution reflected/errored on __proto__ payload", evidence: res.body.slice(0, 150) }
    return { check: "prototype_pollution", hit: false, severity: "info", detail: "no prototype-pollution signal" }
  }

  export async function pathTraversal(sender: HttpSender, origin: string): Promise<Check> {
    const payloads = ["/static/..%2f..%2f..%2fetc%2fpasswd", "/..%2f..%2f..%2fetc%2fpasswd", "/static/..%252f..%252fetc%252fpasswd", "/%2e%2e/%2e%2e/etc/passwd"]
    for (const p of payloads) {
      const res = await get(sender, `${origin}${p}`)
      if (ok(res) && res.status === 200 && res.body.includes("root:") && res.body.includes("/bin/"))
        return { check: "path_traversal", hit: true, severity: "critical", detail: `Express static path traversal via ${p}`, evidence: res.body.slice(0, 120) }
    }
    const pkg = await get(sender, `${origin}/package.json`)
    if (ok(pkg) && pkg.status === 200 && /"dependencies"|"scripts"/.test(pkg.body))
      return { check: "path_traversal", hit: true, severity: "low", detail: "package.json served publicly (dependency disclosure)", evidence: pkg.body.slice(0, 120) }
    return { check: "path_traversal", hit: false, severity: "info", detail: "no static traversal / package.json exposure" }
  }

  export async function expressMisconfig(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin, { Origin: "https://evil.attacker.example" })
    if (ok(res)) {
      const acao = header(res, "access-control-allow-origin")
      const acc = header(res, "access-control-allow-credentials")
      if ((acao === "*" || acao.includes("evil.attacker.example")) && acc === "true")
        return { check: "express_misconfig", hit: true, severity: "high", detail: `CORS reflects arbitrary origin WITH credentials (acao=${acao})`, evidence: `acac=${acc}` }
    }
    const gql = await sender.send({ method: "POST", url: `${origin}/graphql`, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ __schema { types { name } } }" }) })
    if (ok(gql) && gql.status === 200 && gql.body.includes("__schema"))
      return { check: "express_misconfig", hit: true, severity: "medium", detail: "GraphQL introspection enabled at /graphql", evidence: gql.body.slice(0, 120) }
    return { check: "express_misconfig", hit: false, severity: "info", detail: "no CORS-with-creds or open introspection" }
  }

  export async function envLeak(sender: HttpSender, origin: string): Promise<Check> {
    for (const p of ["/.env", "/.env.local", "/.env.production"]) {
      const res = await get(sender, `${origin}${p}`)
      if (ok(res) && res.status === 200 && /[A-Z_]+=.+/.test(res.body) && !/<html/i.test(res.body.slice(0, 100)))
        return { check: "env_leak", hit: true, severity: "critical", detail: `.env file exposed at ${p}`, evidence: res.body.slice(0, 120).replace(/=(.+)/g, "=[REDACTED]") }
    }
    const map = await get(sender, `${origin}/main.js.map`)
    if (ok(map) && map.status === 200 && map.body.includes('"sources"'))
      return { check: "env_leak", hit: true, severity: "low", detail: "JS source map exposed (/main.js.map)", evidence: "sourcesContent present" }
    return { check: "env_leak", hit: false, severity: "info", detail: "no .env / source-map exposure" }
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

const DESCRIPTION = `Node.js / Express / Next checks (detection, inspector :9229 RCE port, prototype pollution, Express static path traversal + package.json, CORS-with-credentials + GraphQL introspection, .env / source-map leak).

Run after Vortex fingerprints Node/Express. Inspector probe respects the scope guard. check="all" (default) runs every check.`

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
