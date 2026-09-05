import type { ResolvedRequest, InjPoint, SendBudget } from "../types"
import { CMD_PROBES, CMD_SEPARATORS } from "../payloads/cmd"
import { applyPayload } from "../mutate"
import { send, nonce } from "../send"
import { blockSignal, looksBlocked, excerptAround } from "../detect"

export interface CmdObservation {
  point: string
  marker_reflected: boolean
  block_signal?: string
  baseline: { status: number; bytes: number; ms: number }
  command_output: { separator: string; cmd: string; snippet: string }[]
  blocked: boolean
  note?: string
}

export async function probeCmdPoint(
  r: ResolvedRequest,
  point: InjPoint,
  abort: AbortSignal,
  delayMs: number,
  budget: SendBudget,
): Promise<CmdObservation> {
  const obs: CmdObservation = {
    point: `${point.location}:${point.name}`,
    marker_reflected: false,
    baseline: { status: 0, bytes: 0, ms: 0 },
    command_output: [],
    blocked: false,
  }
  const sleep = (ms: number) => (ms ? new Promise((res) => setTimeout(res, ms)) : Promise.resolve())
  const n = nonce()
  const m = await send(r, applyPayload(r, point, n), abort, budget)
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
  for (const probe of CMD_PROBES) {
    let found = false
    for (const sep of CMD_SEPARATORS) {
      if (abort.aborted || budget.sent >= budget.max) break
      const res = await send(r, applyPayload(r, point, sep.wrap(probe.cmd)), abort, budget)
      if ("error" in res) continue
      if (looksBlocked(res.status)) {
        obs.blocked = true
        continue
      }
      const mm = probe.marker.exec(res.text)
      if (mm) {
        obs.command_output.push({
          separator: sep.name,
          cmd: probe.cmd,
          snippet: excerptAround(res.text, mm.index, mm[0].length),
        })
        found = true
      }
      await sleep(delayMs)
    }
    if (found) break
  }
  return obs
}
