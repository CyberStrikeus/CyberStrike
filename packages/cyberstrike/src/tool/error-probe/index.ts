// error_probe — deterministic error-handling probe (WSTG-ERRH-01/02). Two layers:
//   • READ-ONLY (always): classify the endpoint's ALREADY-CAPTURED response for leaked diagnostics
//     (framework debug pages, stack traces, path/host disclosure, verbose DB/runtime errors). Sends
//     nothing — zero risk.
//   • ACTIVE (optional): replay a few STRUCTURAL malformations (broken JSON, type confusion, wrong
//     content-type, invalid %-escape) to try to elicit a verbose error, and report any disclosure the
//     normal response did not have. Not injection payloads — just malformed input to trip the parser.
// SAFETY: mirrors access/session probes — a write is malformed+replayed by default (flagged) unless
// safe_only=true. The classifier is pure + unit-tested.
import z from "zod"
import { Tool } from "../tool"
import { Session } from "../../session"
import { Request } from "../../session/request"
import { HttpMessage } from "../../replay/message"
import { originOf, inScope, sendGoverned } from "../http-replay"
import { classifyErrorDisclosure } from "./signatures"
import { errorVariants } from "./mutate"
import { runErrorProbe, type ErrResp, type ErrFinding } from "./probe"

const SAFE_METHODS = new Set(["GET", "HEAD"])

async function sendDecoded(msg: HttpMessage.Request, origin: string, abort: AbortSignal): Promise<ErrResp> {
  const r = await sendGoverned(msg, origin, { signal: abort })
  if (r.error || !r.response) return { error: r.error?.message ?? "no response (transport error)" }
  return { status: r.response.status, body: new TextDecoder("latin1").decode(r.response.body) }
}

export const ErrorProbeTool = Tool.define("error_probe", {
  description:
    "Deterministic error-handling probe (WSTG-ERRH). READ-ONLY layer (always, sends nothing): classifies the endpoint's already-captured response for leaked diagnostics — framework debug pages (Werkzeug/Django/Rails/Symfony/ASP.NET/Spring/Express), stack traces, filesystem-path and internal-address disclosure, and verbose DB/runtime errors. ACTIVE layer (optional): replays structural malformations (broken JSON, object↔array type confusion, wrong content-type, invalid %-escape — NOT injection payloads) and reports any disclosure the normal response lacked. Safe methods are replayed freely; a write is malformed+replayed too (flagged) unless safe_only=true.",
  parameters: z.object({
    request_id: z.string().describe("A captured request whose endpoint to test for verbose/improper error handling."),
    active: z.boolean().optional().default(true).describe("Also send structural malformations to try to elicit an error (default true). Set false for a pure read-only classification of the captured response."),
    safe_only: z.boolean().optional().default(false).describe("If true, skip the active malformation replay on state-changing methods (POST/PUT/PATCH/DELETE). Default false — malformations are structural (not injection) and rarely destructive, but a write still runs; the read-only classification always runs regardless."),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const out = (output: string, metadata: Record<string, unknown> = {}) => ({ title: "error_probe", output, metadata })

    const request = Request.get(sessionID).find((r) => r.id === params.request_id)
    if (!request) return out(`Request "${params.request_id}" not found in this session.`)

    // ── READ-ONLY: classify the captured response (zero risk) ─────────────────────
    const captured = request.processed_response ? classifyErrorDisclosure(request.processed_response) : []

    // ── ACTIVE: elicit errors with structural malformations (gated) ───────────────
    const stateChanging = !SAFE_METHODS.has(request.method.toUpperCase())
    let active: unknown = "active probing disabled (active=false) — read-only classification only"
    let warning: string | undefined
    if (params.active) {
      if (!request.raw_request) active = "no raw_request to replay — read-only classification only"
      else if (stateChanging && params.safe_only) active = `safe_only is set and this is a ${request.method} (state-changing) request — active malformation skipped; read-only classification still ran.`
      else {
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
        const run = await runErrorProbe({ baselineMsg: baseMsg, variants: errorVariants(baseMsg) }, (msg) => sendDecoded(msg, origin, ctx.abort))
        active = { baseline_status: run.baseline.status, findings: run.findings }
        if (stateChanging) warning = `STATE-CHANGING (${request.method}): the malformations were replayed, so a (malformed) write may have run — verify side effects.`
      }
    }

    const triggered = params.active && typeof active === "object" && active !== null && "findings" in active
      ? (active as { findings: ErrFinding[] }).findings.filter((f) => f.triggered)
      : []
    const highCaptured = captured.filter((d) => d.severity === "high")
    const total = captured.length + triggered.length

    const evidence = {
      note: "OBSERVATIONS ONLY — a debug page / stack trace / path disclosure is a WSTG-ERRH finding; confirm and report with the leaked snippet as evidence. 'triggered' = the malformation produced a leak the normal response did not.",
      warning,
      request_id: params.request_id,
      method: request.method,
      captured_response_disclosures: captured.length ? captured : ["captured response leaked no diagnostics"],
      active_probe: active,
    }
    const title =
      highCaptured.length || triggered.some((f) => f.disclosures.some((d) => d.severity === "high"))
        ? `error_probe: verbose/debug error disclosure (HIGH) — verify`
        : total > 0
          ? `error_probe: ${total} error-handling disclosure(s) to verify`
          : `error_probe: no error-handling disclosure found`
    return { title, output: JSON.stringify(evidence, null, 2), metadata: {} }
  },
})
