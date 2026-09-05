import type { ResolvedRequest, InjPoint, SendBudget } from "../types"
import { LFI_TARGETS, LFI_TECHNIQUES, LFI_ABSOLUTE } from "../payloads/lfi"
import { applyLfiTarget } from "../mutate"
import { send } from "../send"
import { blockSignal, excerptAround } from "../detect"

export interface LfiObservation {
  point: string
  baseline: { status: number; bytes: number; ms: number }
  findings: { target: string; technique: string; os: string; payload: string; snippet: string }[]
  blocked: boolean
  block_signal?: string
  note?: string
}

export async function probeLfiPoint(
  r: ResolvedRequest,
  point: InjPoint,
  abort: AbortSignal,
  delayMs: number,
  budget: SendBudget,
): Promise<LfiObservation> {
  const obs: LfiObservation = {
    point: `${point.location}:${point.name}`,
    baseline: { status: 0, bytes: 0, ms: 0 },
    findings: [],
    blocked: false,
  }
  const sleep = (ms: number) => (ms ? new Promise((res) => setTimeout(res, ms)) : Promise.resolve())
  const bl = await send(r, applyLfiTarget(r, point, "1"), abort, budget)
  if ("error" in bl) {
    obs.note = `baseline failed: ${bl.error}`
    if (bl.timeout) obs.block_signal = "timeout/reset (possible WAF)"
    return obs
  }
  const bsig = blockSignal(bl)
  if (bsig) {
    obs.blocked = true
    obs.block_signal = bsig
    obs.note = `baseline ${bsig} — NOT evidence of safety`
    return obs
  }
  obs.baseline = { status: bl.status, bytes: bl.text.length, ms: bl.ms }
  const inert = new Set(LFI_TARGETS.filter((t) => t.sig.test(bl.text)).map((t) => t.file))
  if (inert.size)
    obs.note = `baseline already contains ${[...inert].join(", ")} signature(s) — those targets suppressed (can't tell an echo from a read)`
  const combos: { target: (typeof LFI_TARGETS)[number]; name: string; payload: string }[] = []
  for (const target of LFI_TARGETS) {
    for (const tech of LFI_TECHNIQUES) {
      if (target.os === "unix" && tech.slash === "back") continue
      combos.push({ target, name: tech.name, payload: tech.make(target.file) })
    }
    for (const abs of LFI_ABSOLUTE)
      if (abs.os === target.os) combos.push({ target, name: abs.name, payload: abs.make(target.file) })
  }
  for (const c of combos) {
    if (abort.aborted || budget.sent >= budget.max) break
    const res = await send(r, applyLfiTarget(r, point, c.payload), abort, budget)
    if ("error" in res) {
      if (res.timeout && !obs.block_signal) obs.block_signal = "timeout/reset (possible WAF)"
      continue
    }
    const blk = blockSignal(res)
    if (blk) {
      obs.blocked = true
      obs.block_signal ??= blk
      continue
    }
    if (inert.has(c.target.file)) continue
    const m = c.target.sig.exec(res.text)
    if (m)
      obs.findings.push({
        target: c.target.file,
        technique: c.name,
        os: c.target.os,
        payload: c.payload,
        snippet: excerptAround(res.text, m.index, m[0].length),
      })
    await sleep(delayMs)
  }
  return obs
}
