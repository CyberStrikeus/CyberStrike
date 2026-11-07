// error_probe orchestration (WSTG-ERRH). Generic over message type + injected sender (mirrors
// access/session probes). Classifies the baseline response and each malformed variant, then marks a
// disclosure as TRIGGERED when the malformation produced a leak the normal response did not — the
// strongest signal of improper error handling. Pure decision layer (set difference over disclosure kinds).
import { classifyErrorDisclosure, type Disclosure } from "./signatures"

export interface ErrResp {
  status?: number
  body?: string
  error?: string
}

export interface ErrFinding {
  variant: string
  status?: number
  triggered: boolean // produced a disclosure the baseline did NOT have
  disclosures: Disclosure[]
  error?: string
}

export async function runErrorProbe<T>(
  input: { baselineMsg: T; variants: { name: string; msg: T }[] },
  send: (msg: T) => Promise<ErrResp>,
): Promise<{ baseline: ErrResp; baselineDisclosures: Disclosure[]; findings: ErrFinding[] }> {
  const baseline = await send(input.baselineMsg)
  const baselineDisclosures = baseline.body ? classifyErrorDisclosure(baseline.body) : []
  const baseKinds = new Set(baselineDisclosures.map((d) => d.kind))
  const findings: ErrFinding[] = []
  for (const v of input.variants) {
    const r = await send(v.msg)
    if (r.error || r.status == null) {
      findings.push({ variant: v.name, status: r.status, triggered: false, disclosures: [], error: r.error ?? "no response" })
      continue
    }
    const disclosures = classifyErrorDisclosure(r.body ?? "")
    findings.push({ variant: v.name, status: r.status, triggered: disclosures.some((d) => !baseKinds.has(d.kind)), disclosures })
  }
  return { baseline, baselineDisclosures, findings }
}
