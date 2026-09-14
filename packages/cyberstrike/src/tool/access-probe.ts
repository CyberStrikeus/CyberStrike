// access_probe — deterministic cross-identity access-control probe (WSTG 4.5, IDOR/BOLA/BFLA/missing
// authz). Takes a captured request and replays it under EVERY OTHER session credential (and
// unauthenticated), then judges each swap against the owner's response with a decision-differential:
// a swapped/anon identity that gets a 2xx whose body matches the owner's is Broken Access Control. This
// turns the manual "swap a credential in http_replay and eyeball it" loop into one systematic, deterministic
// pass over the identity matrix — the confirmation channel the authorization agent was missing.
//
// SAFETY: only SAFE (read) methods are auto-replayed — sending a POST/PUT/PATCH/DELETE under another
// identity could mutate/destroy their data. State-changing requests are refused with guidance to confirm
// manually via `http_replay` compare. The classifier (classifyAccess) is a pure, unit-tested core.
import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { Request } from "../session/request"
import { WebCredential } from "../session/web/web-credential"
import { HttpMessage } from "../replay/message"
import { originOf, inScope, applyCredential, stripAuthHeaders, sendGoverned } from "./http-replay"

const SAFE_METHODS = new Set(["GET", "HEAD"])
const MAX_IDENTITIES = 10 // bound the swap matrix

export interface AccessResp {
  status?: number
  body?: string
  error?: string
}
export interface AccessFinding {
  identity: string
  kind: "credential" | "unauthenticated"
  verdict: "broken" | "weak-lead" | "enforced" | "error"
  owner_status?: number
  swapped_status?: number
  similarity: number
  note: string
}

// Token-set Jaccard over whitespace-split bodies — 1.0 when the swapped identity gets the owner's exact
// response (the IDOR/BOLA proof), low when it gets its own/different data or a denial page. Robust to
// ordering; a shared schema with different VALUES lands well below the 0.9 "broken" threshold.
export function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const ta = new Set(a.split(/\s+/).filter(Boolean))
  const tb = new Set(b.split(/\s+/).filter(Boolean))
  if (ta.size === 0 && tb.size === 0) return 1
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

const BROKEN_SIM = 0.9

// Pure decision-differential: compare a swapped/anon response to the owner's legitimate one.
// `stateChanging` = the request is a write (POST/PUT/PATCH/DELETE): the FINDING is that the action was
// AUTHORIZED for the wrong identity (a 2xx), judged on status rather than body — and it means a write
// actually ran under that identity, which the note flags for side-effect verification.
export function classifyAccess(owner: AccessResp, swapped: AccessResp, identity: string, kind: AccessFinding["kind"], stateChanging = false): AccessFinding {
  const base = { identity, kind, owner_status: owner.status, swapped_status: swapped.status }
  if (swapped.error || swapped.status == null) return { ...base, verdict: "error", similarity: 0, note: swapped.error ?? "no response from swapped identity" }
  const ss = swapped.status
  const os = owner.status
  const sim = tokenSimilarity(owner.body ?? "", swapped.body ?? "")
  const ownerOk = os != null && os >= 200 && os < 300
  const swapOk = ss >= 200 && ss < 300
  const who = kind === "unauthenticated" ? "an UNAUTHENTICATED request" : `identity "${identity}"`

  // The server denied the swap — access control is enforced (the safe/expected outcome).
  if (ss === 401 || ss === 403 || (ss >= 300 && ss < 400)) {
    return { ...base, verdict: "enforced", similarity: sim, note: `${who} was denied (status ${ss}) — access control enforced` }
  }

  // Write endpoint: the action being ALLOWED (2xx) for the wrong identity IS the break (BFLA / object
  // write), judged on status — a write demonstrably ran under this identity.
  if (stateChanging) {
    if (swapOk) return { ...base, verdict: "broken", similarity: sim, note: `${who} was ALLOWED to perform this state-changing ${"request"} (status ${ss}) — Broken Access Control / BFLA. A write ran under this identity — verify authorization AND any side effects (created/modified/deleted data).` }
    if (ss === 404) return { ...base, verdict: "weak-lead", similarity: sim, note: `${who} got 404 on a write — possibly object-scoped away, possibly hidden; verify` }
    return { ...base, verdict: "enforced", similarity: sim, note: `${who} status ${ss} on a write — not clearly authorized` }
  }

  // Read endpoint: enforcement often returns 404 (hide-not-found), so treat 404 as enforced here.
  if (ss === 404) return { ...base, verdict: "enforced", similarity: sim, note: `${who} was denied (status 404 — object hidden) — access control enforced` }
  // The swap succeeded AND returned the owner's response — Broken Access Control.
  if (ownerOk && swapOk && sim >= BROKEN_SIM) {
    return { ...base, verdict: "broken", similarity: sim, note: `${who} received the owner's response (status ${ss}, body ${Math.round(sim * 100)}% identical) — Broken Access Control (IDOR/BOLA or missing authz)` }
  }
  // Reached the endpoint but got a different body — accessed, but maybe its own object. A lead to verify.
  if (ownerOk && swapOk) {
    return { ...base, verdict: "weak-lead", similarity: sim, note: `${who} got a 2xx with a DIFFERENT body (${Math.round(sim * 100)}% similar) — reached the endpoint; verify whether it returned the OWNER's object or the swapped identity's own` }
  }
  return { ...base, verdict: "enforced", similarity: sim, note: `${who} status ${ss} (owner ${os ?? "?"}) — not a clear access break` }
}

async function sendDecoded(msg: HttpMessage.Request, origin: string, abort: AbortSignal): Promise<AccessResp> {
  const r = await sendGoverned(msg, origin, { signal: abort })
  if (r.error || !r.response) return { error: r.error?.message ?? "no response (transport error)" }
  return { status: r.response.status, body: new TextDecoder("latin1").decode(r.response.body) }
}

export const AccessProbeTool = Tool.define("access_probe", {
  description:
    "Deterministic cross-identity access-control probe (WSTG 4.5 — IDOR/BOLA/BFLA/missing-authz). Replays a captured request under EVERY OTHER session credential AND unauthenticated, and reports which identities received the owner's response (Broken Access Control) vs were denied (enforced). SAFE methods (GET/HEAD) only — a state-changing request is refused (replaying it under another identity could modify their data; confirm those manually with http_replay compare). Start from vortex_cross_role candidates and pass the transaction's request_id.",
  parameters: z.object({
    request_id: z.string().describe("A captured request to test cross-identity (e.g. an IDOR/BOLA candidate from vortex_cross_role → vortex_inspect)."),
    include_unauthenticated: z.boolean().optional().default(true).describe("Also replay with all auth stripped, to detect missing authorization (default true)."),
    safe_only: z
      .boolean()
      .optional()
      .default(false)
      .describe("If true, refuse state-changing methods (POST/PUT/PATCH/DELETE) instead of testing them. Default false — a write endpoint is where BFLA matters most, so it IS tested; the result flags that a write ran under the swapped identity so you verify side effects. Set true on a production target where a duplicate write is unacceptable."),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const out = (output: string, metadata: Record<string, unknown> = {}) => ({ title: "access_probe", output, metadata })

    const request = Request.get(sessionID).find((r) => r.id === params.request_id)
    if (!request) return out(`Request "${params.request_id}" not found in this session.`)
    if (!request.raw_request) return out(`Request "${params.request_id}" has no raw_request to replay.`)
    const stateChanging = !SAFE_METHODS.has(request.method.toUpperCase())
    if (stateChanging && params.safe_only)
      return out(
        `safe_only is set and this is a ${request.method} (state-changing) request — skipped. Re-run with safe_only=false to test write authorization (a write will then run under each swapped identity), or confirm manually with http_replay.`,
      )

    const o = originOf(request)
    if (typeof o !== "string") return out(o.error)
    const origin = o
    const host = (() => {
      try {
        return new URL(origin).hostname
      } catch {
        return ""
      }
    })()
    if (!inScope(sessionID, host)) return out(`Refusing host "${host}": not among this session's captured in-scope hosts.`)

    let baseMsg: HttpMessage.Request
    try {
      baseMsg = HttpMessage.parse(request.raw_request)
    } catch (e) {
      return out(`Could not parse request: ${e instanceof Error ? e.message : String(e)}`)
    }

    // Owner baseline: the captured request carries the owner's own auth, so this is the legitimate
    // response — but only re-send it for READS. Re-sending a write would duplicate the owner's action;
    // for writes we judge each swap on STATUS alone (was the action authorized for the wrong identity).
    let ownerResp: AccessResp = {}
    if (!stateChanging) {
      ownerResp = await sendDecoded(baseMsg, origin, ctx.abort)
      if (ownerResp.error) return out(`Owner baseline send failed: ${ownerResp.error} — cannot compare.`)
    }

    const ownerCred = request.credential_id
    const others = WebCredential.get(sessionID)
      .filter((c) => c.id !== ownerCred)
      .slice(0, MAX_IDENTITIES)

    const findings: AccessFinding[] = []
    for (const cred of others) {
      if (ctx.abort.aborted) break
      const swapped = applyCredential(baseMsg, cred.id)
      if ("error" in swapped) continue
      const resp = await sendDecoded(swapped, origin, ctx.abort)
      findings.push(classifyAccess(ownerResp, resp, cred.label, "credential", stateChanging))
    }
    if (params.include_unauthenticated && !ctx.abort.aborted) {
      const resp = await sendDecoded(stripAuthHeaders(baseMsg), origin, ctx.abort)
      findings.push(classifyAccess(ownerResp, resp, "unauthenticated", "unauthenticated", stateChanging))
    }

    const broken = findings.filter((f) => f.verdict === "broken")
    const weak = findings.filter((f) => f.verdict === "weak-lead")
    const leads = [
      ...broken.map((f) => `BROKEN ACCESS CONTROL — ${f.note}`),
      ...weak.map((f) => `lead — ${f.note}`),
    ]
    const evidence = {
      note: "OBSERVATIONS ONLY — a 'broken' verdict is a strong deterministic lead (a swapped/anon identity got the owner's response, or a write was authorized for it); confirm before reporting.",
      warning: stateChanging
        ? `STATE-CHANGING (${request.method}): this replayed the request under each swapped identity, so a write may have created/modified/deleted data under them — verify side effects. (owner baseline was NOT re-sent, to avoid duplicating the owner's own write.)`
        : undefined,
      request_id: params.request_id,
      method: request.method,
      owner_status: ownerResp.status,
      identities_tested: findings.length,
      leads: leads.length ? leads : ["no cross-identity access break — the endpoint enforced authorization for every swapped identity (and unauthenticated)"],
      findings,
    }
    const title = broken.length
      ? `access_probe: ${broken.length} BROKEN access-control finding(s) (verify)`
      : weak.length
        ? `access_probe: ${weak.length} lead(s) to verify`
        : `access_probe: authorization enforced across ${findings.length} identities`
    return { title, output: JSON.stringify(evidence, null, 2), metadata: {} }
  },
})
