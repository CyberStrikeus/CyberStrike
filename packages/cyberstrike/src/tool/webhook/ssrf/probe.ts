// SSRF probe orchestrator (plan §05 ssrf_test). Sets a URL-bearing query parameter
// to each internal target (SsrfPayloads), sends via the injected HttpSender (the
// shared ReplaySender in production, a mock in tests), and classifies each response
// with SsrfOracle — flagging targets that elicited internal-resource evidence the
// benign baseline did not. Facts + leads; the agent confirms and weaponizes.
//
// Scope: QUERY-parameter SSRF (the dominant vector). Body/header vectors and blind
// (OOB) SSRF — where nothing reflects in the response — are out of scope here; the
// latter needs the callback listener, not a response oracle.
import type { HttpSender, ProbeRequest } from "../transport"
import { SsrfPayloads, type SsrfTarget } from "./payloads"
import { SsrfOracle, type SsrfFinding } from "./oracle"

// Common names of parameters that carry a URL the server will fetch.
const URL_PARAM_RE =
  /^(url|uri|link|src|source|dest|destination|redirect|redirect_uri|redirecturl|return|returnurl|next|continue|callback|webhook|fetch|proxy|remote|target|to|out|view|domain|host|site|feed|image|img|import|load|open|file|path|resource|data|reference|ref|window)$/i

/** Query-param names on a URL that look like SSRF sinks. Pure. */
export function detectUrlParams(rawUrl: string): string[] {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return []
  }
  const out: string[] = []
  for (const name of u.searchParams.keys()) if (URL_PARAM_RE.test(name) && !out.includes(name)) out.push(name)
  return out
}

// Set (or add) a query parameter, percent-encoding the value. NOTE: pre-encoded
// protocol-smuggling payloads (gopher %0d%0a) get double-encoded here and may not
// trigger smuggling — the URL/metadata/IP-bypass targets (the high-value ones) are
// sent correctly; smuggling is better pursued via the OOB path.
function setQueryParam(rawUrl: string, name: string, value: string): string | null {
  try {
    const u = new URL(rawUrl)
    u.searchParams.set(name, value)
    return u.toString()
  } catch {
    return null
  }
}

export interface SsrfTargetResult {
  target: string
  category: string
  provider?: string
  status: number | null
  finding: SsrfFinding
  newVsBaseline: boolean // internal evidence the benign baseline did NOT show
  requiresHeader?: Record<string, string> // metadata header this target needs (informational)
  error?: string
}

export interface SsrfProbeReport {
  param: string
  baselineStatus: number | null
  results: SsrfTargetResult[]
  hits: string[] // targets whose response newly showed internal evidence
}

export class SsrfProbe {
  constructor(private readonly sender: HttpSender) {}

  async run(input: { request: ProbeRequest; param: string; targets?: SsrfTarget[] }): Promise<SsrfProbeReport> {
    const targets = input.targets ?? SsrfPayloads.select()
    const req = input.request

    // Baseline: the request unchanged (benign param value).
    const baseline = await this.sender.send(req)
    const baselineStatus = "error" in baseline ? null : baseline.status
    const baselineFinding = "error" in baseline ? { signals: [], reachedInternal: false } : SsrfOracle.assess(baseline.body)

    const results: SsrfTargetResult[] = []
    for (const t of targets) {
      const url = setQueryParam(req.url, input.param, t.value)
      if (url === null) {
        results.push({ target: t.value, category: t.category, provider: t.provider, status: null, finding: { signals: [], reachedInternal: false }, newVsBaseline: false, error: "could not build request URL" })
        continue
      }
      const resp = await this.sender.send({ ...req, url })
      if ("error" in resp) {
        results.push({ target: t.value, category: t.category, provider: t.provider, status: null, finding: { signals: [], reachedInternal: false }, newVsBaseline: false, requiresHeader: t.headers, error: resp.error })
        continue
      }
      const finding = SsrfOracle.assess(resp.body)
      results.push({
        target: t.value,
        category: t.category,
        provider: t.provider,
        status: resp.status,
        finding,
        // A hit only counts if the SSRF payload surfaced internal evidence the benign
        // baseline did not — avoids flagging content already present without the attack.
        newVsBaseline: finding.reachedInternal && !baselineFinding.reachedInternal,
        requiresHeader: t.headers,
      })
    }

    return {
      param: input.param,
      baselineStatus,
      results,
      hits: results.filter((r) => r.newVsBaseline).map((r) => r.target),
    }
  }
}
