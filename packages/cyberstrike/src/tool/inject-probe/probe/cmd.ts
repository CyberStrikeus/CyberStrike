import type { ResolvedRequest, InjPoint, SendBudget, RegisterCanary } from "../types"
import { CMD_PROBES, CMD_SEPARATORS } from "../payloads/cmd"
import { applyPayload } from "../mutate"
import { nonce, type HttpSender } from "../send"
import { excerptAround } from "../detect"
import { checkBaseline, fireLoop } from "./base"

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
  sender: HttpSender,
  r: ResolvedRequest,
  point: InjPoint,
  abort: AbortSignal,
  delayMs: number,
  budget: SendBudget,
  register?: RegisterCanary,
): Promise<CmdObservation> {
  const obs: CmdObservation = {
    point: `${point.location}:${point.name}`,
    marker_reflected: false,
    baseline: { status: 0, bytes: 0, ms: 0 },
    command_output: [],
    blocked: false,
  }
  const n = nonce()
  register?.(n, "reflect")
  const bl = await checkBaseline(sender, r, applyPayload(r, point, n), abort, budget)
  if (!bl.ok) {
    obs.note = bl.note
    obs.blocked = bl.blocked
    obs.block_signal = bl.block_signal
    return obs
  }
  obs.marker_reflected = bl.res.text.includes(n)
  obs.baseline = { status: bl.res.status, bytes: bl.res.text.length, ms: bl.res.ms }
  for (const probe of CMD_PROBES) {
    if (abort.aborted || budget.sent >= budget.max) break
    const findings = await fireLoop({
      sender, r, abort, delayMs, budget, tracker: obs, statusOnly: true,
      payloads: CMD_SEPARATORS,
      apply: (sep) => applyPayload(r, point, sep.wrap(probe.cmd)),
      match: (res, sep) => {
        const mm = probe.marker.exec(res.text)
        if (mm) return { separator: sep.name, cmd: probe.cmd, snippet: excerptAround(res.text, mm.index, mm[0].length) }
        return null
      },
    })
    obs.command_output.push(...findings)
    if (findings.length > 0) break
  }
  return obs
}
