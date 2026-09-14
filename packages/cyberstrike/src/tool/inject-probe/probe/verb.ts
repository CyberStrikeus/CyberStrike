// HTTP Verb Tampering probe (WSTG-INPV-03). Replays the request with a SAFE method matrix and reads
// the Allow header, looking for a method-based access-control bypass — e.g. the endpoint returns
// 401/403 to its normal method but 2xx to HEAD/GET/an unknown verb, or the server accepts an arbitrary
// verb (mapping unknown methods to a handler). Request-level.
//
// SAFETY: this NEVER fires state-changing methods (PUT/DELETE/PATCH) — they could mutate/destroy data.
// It only sends HEAD/OPTIONS/GET and one arbitrary read-shaped verb (no body), and SURFACES any
// dangerous methods from the Allow header as a manual lead for the agent to confirm deliberately.
import type { ResolvedRequest, SendBudget } from "../types"
import { send, type HttpSender } from "../send"
import { looksBlocked } from "../detect"
import { sleep, type BackoffState, recordSuccess } from "./base"

export interface VerbObservation {
  point: string // "http-method"
  baseline: { method: string; status: number }
  matrix: { method: string; status: number }[]
  allow?: string // the Allow response header (OPTIONS)
  bypass: { method: string; from: number; to: number }[] // control returned deny to the base method, allow to this one
  arbitrary_verb_accepted: boolean // an unknown verb returned 2xx — server maps unknown methods to a handler
  dangerous_methods_allowed: string[] // PUT/DELETE/PATCH advertised by Allow — surfaced, NOT fired
  blocked: boolean
  block_signal?: string
  note?: string
}

const SAFE_MATRIX = ["HEAD", "OPTIONS", "GET"] // never a state-changing verb
const ARBITRARY_VERB = "CSPROBE" // read-shaped unknown method (no body) — an ACL-bypass canary
const DANGEROUS = ["PUT", "DELETE", "PATCH"]
const isDeny = (s: number) => s === 401 || s === 403 || s === 405
const is2xx = (s: number) => s >= 200 && s < 300

export const VERB_NOT_TESTED =
  "verb-tampering: state-changing methods (PUT/DELETE/PATCH) are surfaced from Allow but NOT fired (destructive — confirm manually); X-HTTP-Method-Override / _method smuggling; per-verb body semantics"

export async function probeVerbTampering(
  sender: HttpSender,
  r: ResolvedRequest,
  abort: AbortSignal,
  delayMs: number,
  budget: SendBudget,
  backoff?: BackoffState,
): Promise<VerbObservation> {
  const obs: VerbObservation = {
    point: "http-method",
    baseline: { method: (r.method || "GET").toUpperCase(), status: 0 },
    matrix: [],
    bypass: [],
    arbitrary_verb_accepted: false,
    dangerous_methods_allowed: [],
    blocked: false,
  }

  // Baseline: the request's own method.
  const base = await send(sender, r, { url: r.url.toString(), body: r.body, headers: r.headers }, abort, budget)
  if ("error" in base) {
    obs.note = `baseline send failed: ${base.error}`
    return obs
  }
  obs.baseline.status = base.status

  const methods = [...SAFE_MATRIX.filter((m) => m !== obs.baseline.method), ARBITRARY_VERB]
  for (const method of methods) {
    if (abort.aborted || budget.sent >= budget.max) break
    const res = await send(sender, { ...r, method }, { url: r.url.toString(), body: "", headers: r.headers }, abort, budget)
    if ("error" in res) continue
    if (backoff) recordSuccess(backoff)
    obs.matrix.push({ method, status: res.status })
    if (method === "OPTIONS" && res.headers["allow"]) {
      obs.allow = res.headers["allow"]
      const adv = obs.allow.toUpperCase()
      obs.dangerous_methods_allowed = DANGEROUS.filter((d) => adv.includes(d))
    }
    // A method-based control bypass: the base method was denied, this one is allowed.
    if (isDeny(obs.baseline.status) && is2xx(res.status)) obs.bypass.push({ method, from: obs.baseline.status, to: res.status })
    if (method === ARBITRARY_VERB && is2xx(res.status)) obs.arbitrary_verb_accepted = true
    if (looksBlocked(res.status)) obs.blocked = true
    await sleep(backoff?.delay ?? delayMs)
  }
  return obs
}
