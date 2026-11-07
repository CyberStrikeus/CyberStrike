import type { ResolvedRequest, InjPoint, SendBudget } from "../types"
import { LFI_TARGETS, LFI_TECHNIQUES, LFI_ABSOLUTE } from "../payloads/lfi"
import { applyLfiTarget } from "../mutate"
import type { HttpSender } from "../send"
import { excerptAround } from "../detect"
import { checkBaseline, fireLoop, type BackoffState } from "./base"

export interface LfiObservation {
  point: string
  baseline: { status: number; bytes: number; ms: number }
  findings: { target: string; technique: string; os: string; payload: string; snippet: string }[]
  blocked: boolean
  block_signal?: string
  note?: string
}

export async function probeLfiPoint(
  sender: HttpSender,
  r: ResolvedRequest,
  point: InjPoint,
  abort: AbortSignal,
  delayMs: number,
  budget: SendBudget,
  backoff?: BackoffState,
): Promise<LfiObservation> {
  const obs: LfiObservation = {
    point: `${point.location}:${point.name}`,
    baseline: { status: 0, bytes: 0, ms: 0 },
    findings: [],
    blocked: false,
  }
  const bl = await checkBaseline(sender, r, applyLfiTarget(r, point, "1"), abort, budget)
  if (!bl.ok) {
    obs.note = bl.note
    obs.blocked = bl.blocked
    obs.block_signal = bl.block_signal
    return obs
  }
  obs.baseline = { status: bl.res.status, bytes: bl.res.text.length, ms: bl.res.ms }
  const inert = new Set(LFI_TARGETS.filter((t) => t.sig.test(bl.res.text)).map((t) => t.file))
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
  obs.findings = await fireLoop({
    sender, r, abort, delayMs, budget, tracker: obs, backoff,
    payloads: combos,
    apply: (c) => applyLfiTarget(r, point, c.payload),
    match: (res, c) => {
      if (inert.has(c.target.file)) return null
      const m = c.target.sig.exec(res.text)
      if (m)
        return {
          target: c.target.file,
          technique: c.name,
          os: c.target.os,
          payload: c.payload,
          snippet: excerptAround(res.text, m.index, m[0].length),
        }
      return null
    },
  })
  return obs
}
