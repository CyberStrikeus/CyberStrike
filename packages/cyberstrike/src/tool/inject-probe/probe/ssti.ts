import type { ResolvedRequest, InjPoint, SendBudget } from "../types"
import { SSTI_EXPR, SSTI_PRODUCT, SSTI_SYNTAXES, SSTI_ALT } from "../payloads/ssti"
import { applyPayload } from "../mutate"
import { send, nonce, type HttpSender } from "../send"
import { blockSignal, looksBlocked, excerptOf } from "../detect"

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
  const sleep = (ms: number) => (ms ? new Promise((res) => setTimeout(res, ms)) : Promise.resolve())
  const n = nonce()
  const m = await send(sender, r, applyPayload(r, point, n), abort, budget)
  if ("error" in m) {
    obs.note = `send failed: ${m.error}`
    return obs
  }
  const bsig = blockSignal(m)
  if (bsig) {
    obs.blocked = true
    obs.block_signal = bsig
    obs.note = `baseline ${bsig} — NOT evidence of safety`
    return obs
  }
  obs.marker_reflected = m.text.includes(n)
  obs.baseline = { status: m.status, bytes: m.text.length, ms: m.ms }
  for (const s of SSTI_SYNTAXES) {
    if (abort.aborted || budget.sent >= budget.max) break
    const res = await send(sender, r, applyPayload(r, point, s.wrap(SSTI_EXPR)), abort, budget)
    if ("error" in res) continue
    if (looksBlocked(res.status)) {
      obs.blocked = true
      continue
    }
    if (res.text.includes(SSTI_PRODUCT) && !res.text.includes(SSTI_EXPR))
      obs.evaluated.push({ syntax: s.name, snippet: excerptOf(res.text, SSTI_PRODUCT) })
    await sleep(delayMs)
  }
  for (const a of SSTI_ALT) {
    if (abort.aborted || budget.sent >= budget.max) break
    const res = await send(sender, r, applyPayload(r, point, a.payload), abort, budget)
    if ("error" in res) continue
    if (looksBlocked(res.status)) {
      obs.blocked = true
      continue
    }
    if (res.text.includes(a.product) && !res.text.includes(a.literal))
      obs.evaluated.push({ syntax: a.name, snippet: excerptOf(res.text, a.product) })
    await sleep(delayMs)
  }
  return obs
}
