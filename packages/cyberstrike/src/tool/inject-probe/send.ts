import { randomBytes } from "crypto"
import type { ResolvedRequest, SendBudget, SendOk, SendResult, InjPoint } from "./types"
import { blockSignal } from "./detect"
import { applyPayload } from "./mutate"

export function nonce(): string {
  return "m" + randomBytes(5).toString("hex")
}

const KEEP_HEADERS = [
  "server",
  "x-powered-by",
  "location",
  "www-authenticate",
  "content-type",
  "set-cookie",
  "cf-ray",
  "x-sucuri-id",
  "x-akamai-transformed",
  "x-cache",
]

function extractHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of KEEP_HEADERS) {
    const v = h.get(k)
    if (v) out[k] = v.slice(0, 200)
  }
  return out
}

export function guardHost(r: ResolvedRequest, target: URL): { ok: true } | { ok: false; reason: string } {
  if (target.host !== r.url.host) return { ok: false, reason: `out-of-scope host ${target.host}` }
  return { ok: true }
}

export const SEND_TIMEOUT_MS = Number(process.env.INJECT_PROBE_TIMEOUT_MS) || 15_000

export async function send(
  r: ResolvedRequest,
  target: { url: string; body: string; headers?: Record<string, string> },
  abort: AbortSignal,
  budget?: SendBudget,
): Promise<SendResult> {
  if (budget) {
    if (budget.sent >= budget.max) return { error: "send budget exhausted" }
    budget.sent++
  }
  const u = new URL(target.url)
  const guard = guardHost(r, u)
  if (!guard.ok) return { error: guard.reason }
  const sendHeaders: Record<string, string> = { ...(target.headers ?? r.headers) }
  delete sendHeaders["content-length"]
  delete sendHeaders["host"]
  const signal = AbortSignal.any([abort, AbortSignal.timeout(SEND_TIMEOUT_MS)])
  const init: RequestInit & { tls?: { rejectUnauthorized: boolean } } = {
    method: r.method,
    headers: sendHeaders,
    signal,
    redirect: "manual",
    tls: { rejectUnauthorized: false },
  }
  if (r.method !== "GET" && r.method !== "HEAD") init.body = target.body
  const t0 = performance.now()
  try {
    const resp = await fetch(u.toString(), init as RequestInit)
    const text = (await resp.text()).slice(0, 200_000)
    return { status: resp.status, text, ms: Math.round(performance.now() - t0), headers: extractHeaders(resp.headers) }
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    const timeout = /timeout|timed ?out|aborted|reset|ECONNRESET|ETIMEDOUT|socket|EOF|closed/i.test(msg)
    return { error: msg, timeout }
  }
}

export type Baseline =
  | {
      ok: true
      status: number
      bytes: number
      ms: number
      byteJitter: number
      marker: string
      text: string
      headers: Record<string, string>
    }
  | { ok: false; block?: string; error?: string; timeout?: boolean }

export async function repeatBaseline(
  r: ResolvedRequest,
  point: InjPoint,
  abort: AbortSignal,
  budget: SendBudget,
  times = 2,
): Promise<Baseline> {
  let first: SendOk | undefined
  let minB = Infinity
  let maxB = -Infinity
  let maxMs = 0
  let marker = ""
  for (let i = 0; i < times; i++) {
    if (abort.aborted || budget.sent >= budget.max) break
    const n = nonce()
    const res = await send(r, applyPayload(r, point, n), abort, budget)
    if ("error" in res) return { ok: false, error: res.error, timeout: res.timeout }
    const blk = blockSignal(res)
    if (blk) return { ok: false, block: blk }
    if (!first) {
      first = res
      marker = n
    }
    minB = Math.min(minB, res.text.length)
    maxB = Math.max(maxB, res.text.length)
    maxMs = Math.max(maxMs, res.ms)
  }
  if (!first) return { ok: false, error: "no baseline sample (budget/abort)" }
  return {
    ok: true,
    status: first.status,
    bytes: first.text.length,
    ms: maxMs,
    byteJitter: maxB - minB,
    marker,
    text: first.text,
    headers: first.headers,
  }
}
