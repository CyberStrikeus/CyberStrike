import type { ResolvedRequest, InjPoint, SendBudget, RegisterCanary } from "../types"
import { duplicatePayload, applyPayload } from "../mutate"
import { send, nonce, type HttpSender } from "../send"
import { blockSignal } from "../detect"
import { sleep, checkBaseline, type BackoffState, recordBlock, recordSuccess } from "./base"

export interface HppObservation {
  point: string
  baseline: { status: number; bytes: number; ms: number }
  parser_behavior: "first-wins" | "last-wins" | "both" | "inconclusive"
  append_reflected: boolean
  prepend_reflected: boolean
  blocked: boolean
  block_signal?: string
  note?: string
}

export async function probeHppPoint(
  sender: HttpSender,
  r: ResolvedRequest,
  point: InjPoint,
  abort: AbortSignal,
  delayMs: number,
  budget: SendBudget,
  register?: RegisterCanary,
  backoff?: BackoffState,
): Promise<HppObservation> {
  const obs: HppObservation = {
    point: `${point.location}:${point.name}`,
    baseline: { status: 0, bytes: 0, ms: 0 },
    parser_behavior: "inconclusive",
    append_reflected: false,
    prepend_reflected: false,
    blocked: false,
  }

  if (point.location !== "query" && point.location !== "form_field") {
    obs.note = `HPP not applicable to ${point.location} — duplicate parameters only work for query string and form-urlencoded body`
    return obs
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
  obs.baseline = { status: bl.res.status, bytes: bl.res.text.length, ms: bl.res.ms }

  const delay = backoff?.delay ?? delayMs

  const appendN = nonce()
  register?.(appendN, "reflect")
  const appendTarget = duplicatePayload(r, point, appendN, "last")
  if (!appendTarget) {
    obs.note = "HPP: original parameter value not found — cannot construct duplicate"
    return obs
  }
  if (abort.aborted || budget.sent >= budget.max) return obs
  const appendRes = await send(sender, r, appendTarget, abort, budget)
  if ("error" in appendRes) {
    obs.note = `HPP append failed: ${appendRes.error}`
    return obs
  }
  const appendBlk = blockSignal(appendRes)
  if (appendBlk) {
    obs.blocked = true
    obs.block_signal = appendBlk
    if (backoff) recordBlock(backoff)
  } else {
    obs.append_reflected = appendRes.text.includes(appendN)
    if (backoff) recordSuccess(backoff)
  }
  await sleep(delay)

  const prependN = nonce()
  register?.(prependN, "reflect")
  const prependTarget = duplicatePayload(r, point, prependN, "first")
  if (!prependTarget) return obs
  if (abort.aborted || budget.sent >= budget.max) return obs
  const prependRes = await send(sender, r, prependTarget, abort, budget)
  if ("error" in prependRes) {
    obs.note = `HPP prepend failed: ${prependRes.error}`
    return obs
  }
  const prependBlk = blockSignal(prependRes)
  if (prependBlk) {
    obs.blocked = true
    obs.block_signal ??= prependBlk
    if (backoff) recordBlock(backoff)
  } else {
    obs.prepend_reflected = prependRes.text.includes(prependN)
    if (backoff) recordSuccess(backoff)
  }

  if (obs.append_reflected && obs.prepend_reflected) {
    obs.parser_behavior = "both"
  } else if (obs.append_reflected) {
    obs.parser_behavior = "last-wins"
  } else if (obs.prepend_reflected) {
    obs.parser_behavior = "first-wins"
  } else if (!obs.blocked) {
    obs.note =
      "neither duplicate position reflected the nonce — parameter may not be user-visible, or server merges/ignores duplicates"
  }

  return obs
}

export const HPP_NOT_TESTED = [
  "injection payloads via duplicate parameters (this probe only detects parser behavior — fire injection payloads at the duplicate position yourself)",
  "server-side HPP (parameter received by backend may differ from what the reverse proxy/load balancer passes)",
  "JSON body, header, cookie, path duplicate parameters (only query string and form-urlencoded body tested)",
]
