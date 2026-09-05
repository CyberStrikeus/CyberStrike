import type { ResolvedRequest, InjPoint, SendBudget } from "../types"
import { ERRSIG } from "../payloads/errsig"
import { applyPayload, applyOperatorTarget } from "../mutate"
import { send, repeatBaseline, type HttpSender } from "../send"
import { blockSignal, excerptAround } from "../detect"

export interface ErrSigObservation {
  point: string
  class: string
  baseline: { status: number; bytes: number; ms: number; byte_jitter: number }
  block_signal?: string
  error_findings: { payload: string; status: number; bytes: number; ms: number; server?: string; snippet: string }[]
  bool_findings: {
    pair: string
    base_bytes: number
    true: { status: number; bytes: number; ms: number; location?: string; set_cookie: boolean }
    false: { status: number; bytes: number; ms: number; location?: string; set_cookie: boolean }
    differential: boolean
    signals: string[]
  }[]
  blocked: boolean
  note?: string
}

export async function probeErrorSigPoint(
  sender: HttpSender,
  r: ResolvedRequest,
  point: InjPoint,
  cls: "sqli" | "nosql" | "ldap" | "xpath",
  abort: AbortSignal,
  delayMs: number,
  budget: SendBudget,
): Promise<ErrSigObservation> {
  const spec = ERRSIG[cls]
  const obs: ErrSigObservation = {
    point: `${point.location}:${point.name}`,
    class: cls,
    baseline: { status: 0, bytes: 0, ms: 0, byte_jitter: 0 },
    error_findings: [],
    bool_findings: [],
    blocked: false,
  }
  const sleep = (ms: number) => (ms ? new Promise((res) => setTimeout(res, ms)) : Promise.resolve())
  const bl = await repeatBaseline(sender, r, point, abort, budget)
  if (!bl.ok) {
    obs.blocked = !!bl.block
    obs.block_signal = bl.block
    obs.note = bl.block
      ? `baseline blocked: ${bl.block} — NOT evidence of safety`
      : `baseline failed: ${bl.error}${bl.timeout ? " (timeout/reset — possible WAF drop, NOT safety)" : ""}`
    if (bl.timeout) obs.block_signal = "timeout/reset (possible WAF)"
    return obs
  }
  obs.baseline = { status: bl.status, bytes: bl.bytes, ms: bl.ms, byte_jitter: bl.byteJitter }
  const floor = Math.max(16, bl.byteJitter + 8)
  for (const p of spec.payloads) {
    if (abort.aborted || budget.sent >= budget.max) break
    const res = await send(sender, r, applyPayload(r, point, p), abort, budget)
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
    const m = spec.signatures.exec(res.text)
    if (m)
      obs.error_findings.push({
        payload: p,
        status: res.status,
        bytes: res.text.length,
        ms: res.ms,
        server: res.headers["server"] ?? res.headers["x-powered-by"],
        snippet: excerptAround(res.text, m.index, m[0].length),
      })
    await sleep(delayMs)
  }
  for (const pair of spec.boolPairs ?? []) {
    if (abort.aborted || budget.sent >= budget.max) break
    const t = await send(sender, r, applyPayload(r, point, pair.t), abort, budget)
    const fr = await send(sender, r, applyPayload(r, point, pair.f), abort, budget)
    if ("error" in t || "error" in fr) continue
    if (blockSignal(t) || blockSignal(fr)) {
      obs.block_signal ??= "boolean pair blocked (WAF/rate-limit) — differential unreliable"
      continue
    }
    const near = (a: number, b: number) => Math.abs(a - b) <= floor
    const signals: string[] = []
    if (Math.abs(t.text.length - fr.text.length) > floor) signals.push("bytes")
    if (t.status !== fr.status) signals.push("status")
    if ((t.headers["location"] ?? "") !== (fr.headers["location"] ?? "")) signals.push("location")
    if (!!t.headers["set-cookie"] !== !!fr.headers["set-cookie"]) signals.push("set-cookie")
    if (near(t.text.length, bl.bytes) && !near(fr.text.length, bl.bytes)) signals.push("true≈base,false≠base")
    obs.bool_findings.push({
      pair: `${pair.t}  vs  ${pair.f}`,
      base_bytes: bl.bytes,
      true: {
        status: t.status,
        bytes: t.text.length,
        ms: t.ms,
        location: t.headers["location"],
        set_cookie: !!t.headers["set-cookie"],
      },
      false: {
        status: fr.status,
        bytes: fr.text.length,
        ms: fr.ms,
        location: fr.headers["location"],
        set_cookie: !!fr.headers["set-cookie"],
      },
      differential: signals.length > 0,
      signals,
    })
    await sleep(delayMs)
  }
  if (cls === "nosql") {
    const opPairs: { t: [string, any]; f: [string, any] }[] = [
      { t: ["$ne", "zzNoMatch"], f: ["$eq", "zzNoMatch"] },
      { t: ["$regex", ".*"], f: ["$regex", "^zzNoMatch$"] },
      { t: ["$gt", ""], f: ["$lt", ""] },
    ]
    for (const op of opPairs) {
      if (abort.aborted || budget.sent >= budget.max) break
      const tTgt = applyOperatorTarget(r, point, op.t[0], op.t[1])
      const fTgt = applyOperatorTarget(r, point, op.f[0], op.f[1])
      if (!tTgt || !fTgt) break
      const t = await send(sender, r, tTgt, abort, budget)
      const fr = await send(sender, r, fTgt, abort, budget)
      if ("error" in t || "error" in fr) continue
      if (blockSignal(t) || blockSignal(fr)) {
        obs.block_signal ??= "operator pair blocked (WAF/rate-limit) — differential unreliable"
        continue
      }
      const signals: string[] = []
      if (Math.abs(t.text.length - fr.text.length) > floor) signals.push("bytes")
      if (t.status !== fr.status) signals.push("status")
      if (!!t.headers["set-cookie"] !== !!fr.headers["set-cookie"]) signals.push("set-cookie")
      obs.bool_findings.push({
        pair: `${point.name}[${op.t[0]}]=${op.t[1]}  vs  ${point.name}[${op.f[0]}]=${op.f[1]}`,
        base_bytes: bl.bytes,
        true: {
          status: t.status,
          bytes: t.text.length,
          ms: t.ms,
          location: t.headers["location"],
          set_cookie: !!t.headers["set-cookie"],
        },
        false: {
          status: fr.status,
          bytes: fr.text.length,
          ms: fr.ms,
          location: fr.headers["location"],
          set_cookie: !!fr.headers["set-cookie"],
        },
        differential: signals.length > 0,
        signals,
      })
      await sleep(delayMs)
    }
  }
  return obs
}
