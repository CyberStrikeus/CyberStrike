// session_probe orchestration core (WSTG-SESS). Pure/testable decision layer + a generic acceptance
// runner driven by an injected sender, mirroring access-probe's runAccessMatrix. The tool (index.ts)
// wires real HttpMessage requests + the governed sender; tests drive a fake multi-token app.
import { tokenSimilarity } from "../access-probe"

export interface SessResp {
  status?: number
  body?: string
  error?: string
}

export interface JwtAcceptance {
  variant: string // "alg:none" | "tampered-claim" | "weak-secret-resign"
  verdict: "broken" | "weak-lead" | "enforced" | "inconclusive" | "error"
  forged_status?: number
  similarity: number
  note: string
}

const ACCEPT_SIM = 0.9

// Decide whether a forged token was ACCEPTED as the owner's session. The no-token control is the crux:
// a forged token "working" only means something if the SAME request WITHOUT a session is denied. If the
// endpoint serves anonymous requests too, acceptance proves nothing (and we say so).
export function classifyJwtAcceptance(
  owner: SessResp,
  control: SessResp,
  forged: SessResp,
  variant: string,
): JwtAcceptance {
  const base = { variant, forged_status: forged.status }
  if (forged.error || forged.status == null) return { ...base, verdict: "error", similarity: 0, note: forged.error ?? "no response for forged token" }
  const ownerOk = owner.status != null && owner.status >= 200 && owner.status < 300
  const forgedOk = forged.status >= 200 && forged.status < 300
  const controlOk = control.status != null && control.status >= 200 && control.status < 300
  const sim = tokenSimilarity(owner.body ?? "", forged.body ?? "")

  if (!ownerOk) return { ...base, verdict: "inconclusive", similarity: sim, note: `owner's own token did not return 2xx (status ${owner.status ?? "?"}) — cannot baseline acceptance` }
  if (controlOk) return { ...base, verdict: "inconclusive", similarity: sim, note: `the endpoint also served a request with NO session (status ${control.status}) — it is not session-gated, so token acceptance here proves nothing; retest on a gated endpoint` }
  if (!forgedOk) return { ...base, verdict: "enforced", similarity: sim, note: `forged token (${variant}) was rejected (status ${forged.status}) — signature/validation enforced` }
  if (sim >= ACCEPT_SIM) return { ...base, verdict: "broken", similarity: sim, note: `forged token (${variant}) was ACCEPTED — 2xx and ${Math.round(sim * 100)}% identical to the owner's authenticated response. The server accepts this forged session. BROKEN session/JWT validation.` }
  return { ...base, verdict: "weak-lead", similarity: sim, note: `forged token (${variant}) got 2xx but a ${Math.round(sim * 100)}%-similar body — reached an authenticated area; verify whose session it resolved to` }
}

// Generic acceptance runner: owner baseline + no-token control + each forged variant through one sender.
export async function runJwtAcceptance<T>(
  input: { ownerMsg: T; controlMsg: T; variants: { name: string; msg: T }[] },
  send: (msg: T) => Promise<SessResp>,
): Promise<{ owner: SessResp; control: SessResp; results: JwtAcceptance[] }> {
  const owner = await send(input.ownerMsg)
  const control = await send(input.controlMsg)
  const results: JwtAcceptance[] = []
  for (const v of input.variants) results.push(classifyJwtAcceptance(owner, control, await send(v.msg), v.name))
  return { owner, control, results }
}
