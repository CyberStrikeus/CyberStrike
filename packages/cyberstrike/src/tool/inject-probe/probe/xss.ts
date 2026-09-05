import type { ResolvedRequest, InjPoint, SendBudget } from "../types"
import { XSS_TAGS, XSS_WEAPONS, XSS_WEAPONS_BAREARG, XSS_WEAPONS_ENCODED, XSS_BREAKOUT } from "../payloads/xss"
import { applyPayload } from "../mutate"
import { send, nonce } from "../send"
import { blockSignal, looksBlocked, excerptOf, classifyXssContext, xssWeaponFires } from "../detect"

export interface PointObservation {
  point: string
  marker_reflected: boolean
  marker_html_encoded: boolean | null
  reflection_snippet?: string
  context?: string
  surviving_tags: string[]
  weaponized: string[]
  breakout?: string
  block_signal?: string
  blocked: boolean
  note?: string
}

export async function probeXssPoint(
  r: ResolvedRequest,
  point: InjPoint,
  abort: AbortSignal,
  delayMs: number,
  budget: SendBudget,
): Promise<PointObservation> {
  const obs: PointObservation = {
    point: `${point.location}:${point.name}`,
    marker_reflected: false,
    marker_html_encoded: null,
    surviving_tags: [],
    weaponized: [],
    blocked: false,
  }
  const sleep = (ms: number) => (ms ? new Promise((res) => setTimeout(res, ms)) : Promise.resolve())
  const n = nonce()
  const m = await send(r, applyPayload(r, point, n), abort, budget)
  if ("error" in m) {
    obs.note = `send failed: ${m.error}`
    return obs
  }
  const bblk = blockSignal(m)
  if (bblk) {
    obs.blocked = true
    obs.block_signal = bblk
    obs.note = `baseline ${bblk} — NOT evidence of safety`
    return obs
  }
  obs.marker_reflected = m.text.includes(n)
  if (!obs.marker_reflected) return obs
  obs.reflection_snippet = excerptOf(m.text, n)
  obs.context = classifyXssContext(m.text, n)

  for (const tag of XSS_TAGS) {
    if (abort.aborted || budget.sent >= budget.max) break
    const tn = nonce()
    const res = await send(r, applyPayload(r, point, `<${tag}/data-p=${tn}>`), abort, budget)
    if ("error" in res) continue
    if (looksBlocked(res.status)) {
      obs.blocked = true
      continue
    }
    const rawTag = new RegExp(`<${tag}/data-p=${tn}`, "i").test(res.text)
    const encoded = res.text.includes(`&lt;${tag}`) || res.text.includes(`&lt;${tag.toUpperCase()}`)
    if (rawTag) obs.surviving_tags.push(tag)
    if (obs.marker_html_encoded === null) obs.marker_html_encoded = encoded && !rawTag
    await sleep(delayMs)
  }

  const mk = obs.context && XSS_BREAKOUT[obs.context]
  if (mk && !abort.aborted && budget.sent < budget.max) {
    const tn = nonce()
    const res = await send(r, applyPayload(r, point, mk(tn)), abort, budget)
    if (!("error" in res) && !looksBlocked(res.status) && new RegExp(`<svg\\b[^>]*${tn}`, "i").test(res.text))
      obs.breakout = mk(tn)
  }

  const survived = obs.surviving_tags.length > 0
  const ctx = obs.context ?? ""
  const attrCtx = /attribute|javascript|rcdata/.test(ctx)
  if (survived || attrCtx) {
    for (const make of XSS_WEAPONS) {
      if (abort.aborted || budget.sent >= budget.max) break
      const wn = nonce()
      const { payload, sig } = make(wn)
      if (!xssWeaponFires(payload, survived, ctx)) continue
      const res = await send(r, applyPayload(r, point, payload), abort, budget)
      if ("error" in res || looksBlocked(res.status)) continue
      if (sig.test(res.text)) {
        obs.weaponized.push(payload.replace(wn, '"XSS"'))
        obs.weaponized.push(payload.replace(wn, "'XSS'"))
      }
      await sleep(delayMs)
    }
    for (const make of XSS_WEAPONS_BAREARG) {
      if (abort.aborted || budget.sent >= budget.max) break
      const wn = nonce()
      const { payload, sig } = make(wn)
      if (!xssWeaponFires(payload, survived, ctx)) continue
      const res = await send(r, applyPayload(r, point, payload), abort, budget)
      if ("error" in res || looksBlocked(res.status)) continue
      if (sig.test(res.text)) obs.weaponized.push(payload.replace(wn, "XSS"))
      await sleep(delayMs)
    }
    for (const w of XSS_WEAPONS_ENCODED) {
      if (abort.aborted || budget.sent >= budget.max) break
      const wn = nonce()
      const { payload, sig } = w.probe(wn)
      if (!xssWeaponFires(payload, survived, ctx)) continue
      const res = await send(r, applyPayload(r, point, payload), abort, budget)
      if ("error" in res || looksBlocked(res.status)) continue
      if (sig.test(res.text)) obs.weaponized.push(w.ready)
      await sleep(delayMs)
    }
  }
  return obs
}
