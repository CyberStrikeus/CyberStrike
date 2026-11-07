import z from "zod"
import { Tool } from "../../tool"
import { toolResult, toolError } from "../result"
import { governedSend } from "@/replay/govern"
import type { HttpMessage } from "@/replay/message"

export namespace HttpSmuggling {
  export interface Probe {
    type: string
    timing: number
    baseline: number
    detected: boolean
  }

  export interface Result {
    vulnerable: boolean
    probes: Probe[]
    requests: number
  }

  async function raw(
    origin: string,
    method: string,
    target: string,
    headers: HttpMessage.Header[],
    body: Uint8Array,
    signal?: AbortSignal,
  ): Promise<{ status: number; timing: number } | { error: string }> {
    const start = performance.now()
    const result = await governedSend(
      { method, target, version: "HTTP/1.1", headers, body },
      origin,
      { insecureTls: true, totalTimeoutMs: 15000, signal },
    )
    const timing = performance.now() - start
    if (result.error || !result.response) return { error: result.error?.message ?? "no response" }
    return { status: result.response.status, timing }
  }

  function encode(s: string): Uint8Array {
    return new TextEncoder().encode(s)
  }

  export async function run(url: string, signal?: AbortSignal): Promise<Result> {
    let parsed: URL
    try { parsed = new URL(url) } catch { return { vulnerable: false, probes: [], requests: 0 } }

    const origin = `${parsed.protocol}//${parsed.host}`
    const target = parsed.pathname || "/"
    let requests = 0
    const probes: Probe[] = []

    const base = await raw(
      origin, "POST", target,
      [
        { name: "Host", value: parsed.host },
        { name: "Content-Type", value: "application/x-www-form-urlencoded" },
        { name: "Content-Length", value: "4" },
      ],
      encode("x=1\r\n"),
      signal,
    )
    requests++
    if ("error" in base) return { vulnerable: false, probes: [], requests }
    const baseline = base.timing

    // CL.TE: CL accounts for full body, TE chunked expects chunk parsing.
    // If back-end uses TE, it parses chunks and may hang on malformed chunk.
    const clte = "1\r\nZ\r\nQ\r\n\r\n"
    const clteRes = await raw(
      origin, "POST", target,
      [
        { name: "Host", value: parsed.host },
        { name: "Content-Type", value: "application/x-www-form-urlencoded" },
        { name: "Content-Length", value: String(clte.length) },
        { name: "Transfer-Encoding", value: "chunked" },
      ],
      encode(clte),
      signal,
    )
    requests++
    const clteTiming = "error" in clteRes ? 15000 : clteRes.timing
    probes.push({ type: "CL.TE", timing: clteTiming, baseline, detected: clteTiming > baseline + 5000 })

    // TE.CL: TE sends valid chunked terminator, CL says body is longer.
    // If back-end uses CL, it waits for more data → timeout.
    const tecl = "0\r\n\r\n"
    const teclRes = await raw(
      origin, "POST", target,
      [
        { name: "Host", value: parsed.host },
        { name: "Content-Type", value: "application/x-www-form-urlencoded" },
        { name: "Transfer-Encoding", value: "chunked" },
        { name: "Content-Length", value: "6" },
      ],
      encode(tecl),
      signal,
    )
    requests++
    const teclTiming = "error" in teclRes ? 15000 : teclRes.timing
    probes.push({ type: "TE.CL", timing: teclTiming, baseline, detected: teclTiming > baseline + 5000 })

    // TE.TE: obfuscated Transfer-Encoding (duplicate header, different case)
    const tete = "1\r\nZ\r\nQ\r\n\r\n"
    const teteRes = await raw(
      origin, "POST", target,
      [
        { name: "Host", value: parsed.host },
        { name: "Content-Type", value: "application/x-www-form-urlencoded" },
        { name: "Content-Length", value: String(tete.length) },
        { name: "Transfer-Encoding", value: "chunked" },
        { name: "Transfer-encoding", value: "x" },
      ],
      encode(tete),
      signal,
    )
    requests++
    const teteTiming = "error" in teteRes ? 15000 : teteRes.timing
    probes.push({ type: "TE.TE", timing: teteTiming, baseline, detected: teteTiming > baseline + 5000 })

    return {
      vulnerable: probes.some((p) => p.detected),
      probes,
      requests,
    }
  }
}

const DESCRIPTION = `HTTP request smuggling detection via timing-based differential probes. Tests for CL.TE, TE.CL, and TE.TE (obfuscated) desync vulnerabilities.

Sends carefully crafted requests with conflicting Content-Length and Transfer-Encoding headers. When front-end and back-end servers disagree on request boundaries, the timing differential (>5s delay) reveals the desync.

**When to use:** On any target behind a reverse proxy, CDN, or load balancer. Especially valuable on multi-tier architectures.
**What it finds:** Request smuggling vulnerabilities that enable cache poisoning, credential hijacking, and access control bypass.
**Output:** Per-probe timing data and detection status for CL.TE, TE.CL, and TE.TE variants.`

export const HttpSmugglingTool = Tool.define("http_smuggling", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("Target URL to test (e.g. https://target.com/api/endpoint)."),
  }),
  async execute(params, ctx) {
    const result = await HttpSmuggling.run(params.url, ctx.abort)
    if (!result.vulnerable)
      return toolResult("http_smuggling", `no desync detected (${result.requests} probes)`, result)
    const found = result.probes.filter((p) => p.detected).map((p) => p.type)
    return toolResult("http_smuggling", `${found.join(" + ")} desync detected`, result)
  },
})
