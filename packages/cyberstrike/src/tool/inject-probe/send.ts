import { randomBytes } from "crypto"
import type { ResolvedRequest, SendBudget, SendOk, SendResult, InjPoint } from "./types"
import type { HttpSender, ProbeResponse } from "../webhook/transport"
import { blockSignal } from "./detect"
import { applyPayload } from "./mutate"

export type { HttpSender }

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
  "allow", // advertised methods — HTTP verb-tampering (WSTG-INPV-03)
  "cf-ray",
  "x-sucuri-id",
  "x-akamai-transformed",
  "x-cache",
]

function extractHeaders(h: Record<string, string>): Record<string, string> {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(h)) lower[k.toLowerCase()] = v
  const out: Record<string, string> = {}
  for (const k of KEEP_HEADERS) {
    const v = lower[k]
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
  sender: HttpSender,
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

  const body = r.method !== "GET" && r.method !== "HEAD" ? target.body : undefined

  const t0 = performance.now()
  const result = await sender.send({ method: r.method, url: target.url, headers: sendHeaders, body })
  const ms = Math.round(performance.now() - t0)

  if ("error" in result) {
    const msg = result.error
    const timeout = /timeout|timed ?out|aborted|reset|ECONNRESET|ETIMEDOUT|socket|EOF|closed/i.test(msg)
    return { error: msg, timeout }
  }

  const resp = result as ProbeResponse
  const text = resp.body.slice(0, 200_000)
  return { status: resp.status, text, ms, headers: extractHeaders(resp.headers) }
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
  sender: HttpSender,
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
    const res = await send(sender, r, applyPayload(r, point, n), abort, budget)
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
