import type { ResolvedRequest, SendBudget, SendOk } from "../types"
import type { HttpSender } from "../send"
import { send } from "../send"
import { blockSignal, looksBlocked } from "../detect"

export const sleep = (ms: number): Promise<void> =>
  ms ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()

export interface BlockTracker {
  blocked: boolean
  block_signal?: string
}

export interface BackoffState {
  delay: number
  consecutiveBlocks: number
  totalBlocks: number
  escalations: string[]
}

export function createBackoff(initialDelay: number): BackoffState {
  return { delay: initialDelay, consecutiveBlocks: 0, totalBlocks: 0, escalations: [] }
}

export function recordBlock(state: BackoffState): "continue" | "skip-point" {
  state.consecutiveBlocks++
  state.totalBlocks++
  if (state.totalBlocks >= 5 && state.delay < 2000) {
    state.delay = 2000
    state.escalations.push(`delay→2000ms after ${state.totalBlocks} blocks`)
  } else if (state.totalBlocks >= 1 && state.delay < 500) {
    state.delay = 500
    state.escalations.push(`delay→500ms after first block`)
  }
  return state.consecutiveBlocks >= 3 ? "skip-point" : "continue"
}

export function recordSuccess(state: BackoffState): void {
  state.consecutiveBlocks = 0
}

export interface BaselineOk {
  ok: true
  res: SendOk
}

export interface BaselineFail {
  ok: false
  note: string
  blocked: boolean
  block_signal?: string
}

export type BaselineResult = BaselineOk | BaselineFail

export async function checkBaseline(
  sender: HttpSender,
  r: ResolvedRequest,
  target: { url: string; body: string; headers?: Record<string, string> },
  abort: AbortSignal,
  budget: SendBudget,
): Promise<BaselineResult> {
  const res = await send(sender, r, target, abort, budget)
  if ("error" in res) {
    return {
      ok: false,
      note: `baseline failed: ${res.error}`,
      blocked: false,
      block_signal: res.timeout ? "timeout/reset (possible WAF)" : undefined,
    }
  }
  const blk = blockSignal(res)
  if (blk) {
    return {
      ok: false,
      note: `baseline ${blk} — NOT evidence of safety`,
      blocked: true,
      block_signal: blk,
    }
  }
  return { ok: true, res }
}

export async function fireLoop<P, T>(opts: {
  sender: HttpSender
  r: ResolvedRequest
  payloads: readonly P[]
  apply: (p: P) => { url: string; body: string; headers?: Record<string, string> }
  match: (res: SendOk, p: P) => T | null
  abort: AbortSignal
  delayMs: number
  budget: SendBudget
  tracker: BlockTracker
  statusOnly?: boolean
  backoff?: BackoffState
}): Promise<T[]> {
  const findings: T[] = []
  for (const p of opts.payloads) {
    if (opts.abort.aborted || opts.budget.sent >= opts.budget.max) break
    const res = await send(opts.sender, opts.r, opts.apply(p), opts.abort, opts.budget)
    if ("error" in res) {
      if (res.timeout) opts.tracker.block_signal ??= "timeout/reset (possible WAF)"
      continue
    }
    let blocked = false
    if (opts.statusOnly) {
      if (looksBlocked(res.status)) {
        opts.tracker.blocked = true
        blocked = true
      }
    } else {
      const blk = blockSignal(res)
      if (blk) {
        opts.tracker.blocked = true
        opts.tracker.block_signal ??= blk
        blocked = true
      }
    }
    if (blocked) {
      if (opts.backoff && recordBlock(opts.backoff) === "skip-point") break
      continue
    }
    if (opts.backoff) recordSuccess(opts.backoff)
    const finding = opts.match(res, p)
    if (finding) findings.push(finding)
    await sleep(opts.backoff?.delay ?? opts.delayMs)
  }
  return findings
}
