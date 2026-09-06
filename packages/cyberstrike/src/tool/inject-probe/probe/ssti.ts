import type { ResolvedRequest, InjPoint, SendBudget } from "../types"
import { SSTI_EXPR, SSTI_PRODUCT, SSTI_SYNTAXES, SSTI_ALT } from "../payloads/ssti"
import { applyPayload } from "../mutate"
import { nonce, type HttpSender } from "../send"
import { excerptOf } from "../detect"
import { checkBaseline, fireLoop } from "./base"

export interface SstiObservation {
  point: string
  marker_reflected: boolean
  block_signal?: string
  baseline: { status: number; bytes: number; ms: number }
  evaluated: { syntax: string; snippet: string }[]
  blocked: boolean
  note?: string
}

export async function probeSstiPoint(
  sender: HttpSender,
  r: ResolvedRequest,
  point: InjPoint,
  abort: AbortSignal,
  delayMs: number,
  budget: SendBudget,
): Promise<SstiObservation> {
  const obs: SstiObservation = {
    point: `${point.location}:${point.name}`,
    marker_reflected: false,
    baseline: { status: 0, bytes: 0, ms: 0 },
    evaluated: [],
    blocked: false,
  }
  const n = nonce()
  const bl = await checkBaseline(sender, r, applyPayload(r, point, n), abort, budget)
  if (!bl.ok) {
    obs.note = bl.note
    obs.blocked = bl.blocked
    obs.block_signal = bl.block_signal
    return obs
  }
  obs.marker_reflected = bl.res.text.includes(n)
  obs.baseline = { status: bl.res.status, bytes: bl.res.text.length, ms: bl.res.ms }
  const syntaxFindings = await fireLoop({
    sender, r, abort, delayMs, budget, tracker: obs, statusOnly: true,
    payloads: SSTI_SYNTAXES,
    apply: (s) => applyPayload(r, point, s.wrap(SSTI_EXPR)),
    match: (res, s) => {
      if (res.text.includes(SSTI_PRODUCT) && !res.text.includes(SSTI_EXPR))
        return { syntax: s.name, snippet: excerptOf(res.text, SSTI_PRODUCT) }
      return null
    },
  })
  obs.evaluated.push(...syntaxFindings)
  const altFindings = await fireLoop({
    sender, r, abort, delayMs, budget, tracker: obs, statusOnly: true,
    payloads: SSTI_ALT,
    apply: (a) => applyPayload(r, point, a.payload),
    match: (res, a) => {
      if (res.text.includes(a.product) && !res.text.includes(a.literal))
        return { syntax: a.name, snippet: excerptOf(res.text, a.product) }
      return null
    },
  })
  obs.evaluated.push(...altFindings)
  return obs
}
