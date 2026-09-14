// Mass Assignment probe (WSTG-INPV-20). Adds each curated privileged field to a WRITE body with a
// unique marker value and checks whether the server ACCEPTED it — the marker echoed back in the
// response proves the field bound (the app let a client set a field it shouldn't). Deterministic LEAD
// only: the agent escalates a confirmed binding with the real value (role=admin) to prove impact.
// Body-level (not point-based), JSON or form-urlencoded, write methods only. Budget/backoff aware.
import type { ResolvedRequest, SendBudget } from "../types"
import { setJsonField } from "../mutate"
import { send, nonce, type HttpSender } from "../send"
import { looksBlocked, excerptOf } from "../detect"
import { sleep, type BackoffState, recordBlock, recordSuccess } from "./base"
import { MASS_ASSIGN_FIELDS } from "../payloads/mass-assign"

export interface MassAssignObservation {
  point: string // "body:json" | "body:form" | "body:unsupported"
  content_type: "json" | "form" | "unsupported"
  bound: { field: string; evidence: string }[] // server accepted + echoed the injected field (strong)
  reflected_keys: string[] // the field key newly appeared in the response (weaker)
  tried: number
  blocked: boolean
  block_signal?: string
  note?: string
}

function bodyKind(r: ResolvedRequest): "json" | "form" | "unsupported" {
  const ct = (r.contentType || "").toLowerCase()
  if (ct.includes("json")) return "json"
  if (ct.includes("x-www-form-urlencoded")) return "form"
  const t = (r.body || "").trim()
  if (t.startsWith("{") || t.startsWith("[")) return "json"
  if (t && /^[^=&\s]+=[^&]*(?:&[^=&\s]+=[^&]*)*$/.test(t)) return "form"
  return "unsupported"
}

function withField(kind: "json" | "form", body: string, field: string, value: string): string {
  if (kind === "json") return setJsonField(body, field, value)
  const f = new URLSearchParams(body)
  f.set(field, value)
  return f.toString()
}

const MAX_FIELDS = 24 // bound how many privileged fields one pass tries

export async function probeMassAssign(
  sender: HttpSender,
  r: ResolvedRequest,
  abort: AbortSignal,
  delayMs: number,
  budget: SendBudget,
  backoff?: BackoffState,
): Promise<MassAssignObservation> {
  const kind = bodyKind(r)
  const obs: MassAssignObservation = { point: `body:${kind}`, content_type: kind, bound: [], reflected_keys: [], tried: 0, blocked: false }
  const method = (r.method || "GET").toUpperCase()
  if (method === "GET" || method === "HEAD") {
    obs.note = "mass-assignment needs a write body (POST/PUT/PATCH) — this request has none"
    return obs
  }
  if (kind === "unsupported") {
    obs.note = "body is neither JSON nor form-urlencoded — cannot add fields deterministically"
    return obs
  }

  // Baseline (original body) so a NEW echo/key is distinguishable from what the response already held.
  const base = await send(sender, r, { url: r.url.toString(), body: r.body, headers: r.headers }, abort, budget)
  if ("error" in base) {
    obs.note = `baseline send failed: ${base.error}`
    return obs
  }
  if (looksBlocked(base.status)) {
    obs.blocked = true
    obs.block_signal = `baseline blocked (status ${base.status})`
    return obs
  }
  const baseText = base.text

  for (const field of MASS_ASSIGN_FIELDS.slice(0, MAX_FIELDS)) {
    if (abort.aborted || budget.sent >= budget.max) break
    const marker = "ma" + nonce()
    const res = await send(sender, r, { url: r.url.toString(), body: withField(kind, r.body, field, marker), headers: r.headers }, abort, budget)
    obs.tried++
    if ("error" in res) continue
    if (looksBlocked(res.status)) {
      obs.blocked = true
      if (backoff && recordBlock(backoff) === "skip-point") break
      continue
    }
    if (backoff) recordSuccess(backoff)
    if (res.text.includes(marker)) obs.bound.push({ field, evidence: excerptOf(res.text, marker) })
    else if (res.text.includes(`"${field}"`) && !baseText.includes(`"${field}"`)) obs.reflected_keys.push(field)
    await sleep(backoff?.delay ?? delayMs)
  }
  return obs
}
