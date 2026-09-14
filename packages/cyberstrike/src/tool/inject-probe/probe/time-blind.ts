// Time-based BLIND injection probe (WSTG-INPV-05 SQLi / INPV-12 command). Confirms an injection that
// has NO visible output by making the server WAIT, and defeats network-jitter false positives with a
// two-control confirmation: a candidate is reported only if (1) an injected delay of DELAY seconds
// materializes (dose-response), AND (2) the same template with a ZERO delay stays fast, AND (3) the same
// template with a FALSE condition stays fast (conditional). Random latency satisfies none of these.
//
// COST/SAFETY: time-based probing deliberately holds server threads, so it is bounded — a modest DELAY,
// a fast single-send reject for non-vulnerable points, at most 3 delaying sends per confirmed template,
// one confirm per family, and the shared send budget. It never extracts data (that's the agent's job).
import type { ResolvedRequest, InjPoint, SendBudget } from "../types"
import { applyPayload } from "../mutate"
import { send, type HttpSender } from "../send"
import { looksBlocked } from "../detect"
import { repeatBaseline } from "../send"
import { sleep, type BackoffState, recordBlock, recordSuccess } from "./base"
import { TIME_PAYLOADS } from "../payloads/time-blind"

export interface TimeBlindObservation {
  point: string
  base_ms: number
  findings: {
    family: string
    engine: string
    injected_delay_s: number
    observed_delta_ms: number
    conditional_confirmed: boolean
    payload: string
  }[]
  tried: number
  blocked: boolean
  block_signal?: string
  note?: string
}

const DEFAULT_DELAY_S = 5

async function timedSend(
  sender: HttpSender,
  r: ResolvedRequest,
  point: InjPoint,
  payload: string,
  abort: AbortSignal,
  budget: SendBudget,
): Promise<{ ms: number; blocked: boolean } | null> {
  const res = await send(sender, r, applyPayload(r, point, payload), abort, budget)
  if ("error" in res) return null
  return { ms: res.ms, blocked: looksBlocked(res.status) }
}

export async function probeTimeBlindPoint(
  sender: HttpSender,
  r: ResolvedRequest,
  point: InjPoint,
  abort: AbortSignal,
  delayMs: number,
  budget: SendBudget,
  backoff?: BackoffState,
  delaySeconds: number = DEFAULT_DELAY_S,
): Promise<TimeBlindObservation> {
  const obs: TimeBlindObservation = { point: `${point.location}:${point.name}`, base_ms: 0, findings: [], tried: 0, blocked: false }

  // Baseline = the WORST normal latency over a few samples, so ordinary jitter sits under it.
  const bl = await repeatBaseline(sender, r, point, abort, budget, 3)
  if (!bl.ok) {
    obs.blocked = !!bl.block
    obs.block_signal = bl.block
    obs.note = bl.block ? `baseline blocked: ${bl.block} — NOT evidence of safety` : `baseline failed: ${bl.error}`
    return obs
  }
  obs.base_ms = bl.ms
  const target = delaySeconds * 1000
  const HIT = target * 0.6 // the injected delay must materialize to at least 60%
  const FAST = target * 0.4 // the controls (zero-delay, false-condition) must stay under 40%

  const done = new Set<string>() // one confirm per family
  for (const p of TIME_PAYLOADS) {
    if (abort.aborted || budget.sent >= budget.max) break
    if (done.has(p.family)) continue

    // (1) the delaying send — if the delay doesn't materialize, reject in a single request.
    const d = await timedSend(sender, r, point, p.make(true, delaySeconds), abort, budget)
    obs.tried++
    if (!d) continue
    if (d.blocked) {
      obs.blocked = true
      if (backoff && recordBlock(backoff) === "skip-point") break
      continue
    }
    if (d.ms - obs.base_ms < HIT) {
      await sleep(backoff?.delay ?? delayMs)
      continue
    }

    // (2) zero-delay control + (3) false-condition control — both must be FAST for a real, conditional hit.
    const z = await timedSend(sender, r, point, p.make(true, 0), abort, budget)
    if (!z || z.blocked) continue
    const f = await timedSend(sender, r, point, p.make(false, delaySeconds), abort, budget)
    if (!f || f.blocked) continue

    const zeroFast = z.ms - obs.base_ms < FAST
    const falseFast = f.ms - obs.base_ms < FAST
    if (zeroFast && falseFast) {
      done.add(p.family)
      if (backoff) recordSuccess(backoff)
      obs.findings.push({
        family: p.family,
        engine: p.engine,
        injected_delay_s: delaySeconds,
        observed_delta_ms: Math.round(d.ms - obs.base_ms),
        conditional_confirmed: falseFast,
        payload: p.make(true, delaySeconds),
      })
    }
    await sleep(backoff?.delay ?? delayMs)
  }
  return obs
}
