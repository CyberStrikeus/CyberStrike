import z from "zod"
import { Tool } from "../tool"
import { Request } from "../../session/request"
import { Session } from "../../session"
import type { ResolvedRequest, InjPoint, SendBudget, RegisterCanary } from "./types"
import { resolve, resolveFromTarget, enumeratePoints, validatePoints } from "./resolve"
import { SSTI_EXPR, SSTI_PRODUCT } from "./payloads/ssti"
import { TESTED_LABEL, NOT_TESTED_BY_CLASS } from "./payloads/errsig"
import { SEND_TIMEOUT_MS, type HttpSender } from "./send"
import { ReplaySender } from "../webhook/transport"
import { probeXssPoint } from "./probe/xss"
import { probeSstiPoint } from "./probe/ssti"
import { probeCmdPoint } from "./probe/cmd"
import { probeLfiPoint } from "./probe/lfi"
import { probeErrorSigPoint } from "./probe/errsig"
import { probeHppPoint } from "./probe/hpp"
import { createBackoff } from "./probe/base"
import { CanaryRegistry } from "../../session/web/signal/canary"
import { DbCanaryStore, SignalStore } from "../../session/web/signal/store"
import { scanProbeResponse } from "../../session/web/signal/ingest"

const description = `Fire a battery of probes at ONE parameter-bearing request and return RAW OBSERVATIONS.

This tool does NOT find or confirm vulnerabilities and does NOT run a JS engine or a shell — it only reports what the server echoed back. Every observation is a LEAD you must verify yourself, never a verdict. After reading it: craft and send the actual exploit to confirm, and separately cover every class listed under coverage.not_tested (this tool does not test them).

vuln_type:
- "xss"  — reflected tag-survival (which HTML tags reflect un-encoded past a filter).
- "ssti" — server-side template evaluation: fires a fixed arithmetic expression in several engine
           syntaxes and reports which (if any) the server EVALUATED (product present, literal absent).
- "cmd"  — OS command injection: fires benign READ-ONLY probes (id/ver) behind shell separators and
           reports which (if any) produced command output in the response. Read-only DETECTION ONLY —
           it never sends network/file/write commands.

Query-string and form-urlencoded parameters only. You choose WHERE (request_id/target/target_param);
the tool chooses the payloads (you cannot supply a command or template expression).`

export const InjectProbeTool = Tool.define("inject_probe", {
  description,
  parameters: z.object({
    request_id: z
      .string()
      .optional()
      .describe("ID of a captured request to probe (PREFERRED — resolves URL, headers, body, credential)."),
    target: z
      .object({
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
        url: z.string().describe("Absolute URL including query string, e.g. http://host/page?name=x"),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.string().optional(),
        content_type: z.string().optional(),
      })
      .optional()
      .describe(
        "Fallback when the target is NOT a stored request (a new/unseen endpoint). Provide EITHER request_id OR target.",
      ),
    vuln_type: z
      .array(z.enum(["xss", "ssti", "cmd", "sqli", "nosql", "ldap", "xpath", "lfi", "hpp"]))
      .min(1)
      .describe(
        "Injection classes to probe — YOU pick the set that fits THIS endpoint (don't run every class everywhere; e.g. no xpath on a plain REST/JSON API). xss/ssti/cmd return execution-facts; sqli/nosql/ldap/xpath return error-signature (sqli also a safe AND-based boolean-differential) facts; hpp detects HTTP Parameter Pollution parser behavior (first-wins vs last-wins). The tool never exploits — it hands you leads.",
      ),
    points: z
      .array(
        z.object({
          location: z.enum(["query", "form_field", "json_body", "header", "cookie", "path"]),
          name: z
            .string()
            .describe(
              "query/form param name · JSON field path (a.b.c) · header name · cookie name · 0-based path-segment index",
            ),
        }),
      )
      .optional()
      .describe("WHERE to inject — YOU choose the points. Omit to auto-enumerate query + form-urlencoded params."),
    target_param: z
      .string()
      .optional()
      .describe(
        "Convenience filter for the auto-enumerate path (probe only this query/form param). Ignored when `points` is given.",
      ),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    let resolved: ResolvedRequest | { error: string }
    if (params.request_id) {
      const request = Request.get(sessionID).find((r) => r.id === params.request_id)
      if (!request) {
        return { title: "inject_probe", output: `Request "${params.request_id}" not found.`, metadata: {} }
      }
      resolved = resolve(request)
    } else if (params.target) {
      const allowedHosts = new Set(
        Request.get(sessionID)
          .map((r) => r.host)
          .filter(Boolean),
      )
      let targetHost = ""
      try {
        targetHost = new URL(params.target.url).hostname
      } catch {}
      if (!targetHost || allowedHosts.size === 0 || !allowedHosts.has(targetHost)) {
        return {
          title: "inject_probe — refused (out of scope)",
          output: `Refusing target host "${targetHost || params.target.url}": not among this session's in-scope hosts [${[...allowedHosts].join(", ") || "none captured"}]. inject_probe only reaches hosts the crawl already captured.`,
          metadata: {},
        }
      }
      resolved = resolveFromTarget(params.target)
    } else {
      return {
        title: "inject_probe",
        output: "Provide either request_id (a stored request) or target (a direct {method,url} spec).",
        metadata: {},
      }
    }
    if ("error" in resolved) {
      return { title: "inject_probe", output: `Could not resolve request: ${resolved.error}`, metadata: {} }
    }
    const DELAY = 120
    const budget: SendBudget = { sent: 0, max: 120 }
    const originRequestId = params.request_id ?? `target:${resolved.url.toString()}`
    const sourceIsCaptured = !!params.request_id
    const canaries = new CanaryRegistry(new DbCanaryStore(sessionID))
    const signalStore = new SignalStore(sessionID)

    const rawSender = new ReplaySender({
      totalTimeoutMs: SEND_TIMEOUT_MS,
      insecureTls: true,
      followRedirects: false,
      signal: ctx.abort,
    })
    const sender: HttpSender = {
      send: async (req) => {
        const result = await rawSender.send(req)
        if (!("error" in result)) {
          scanProbeResponse({
            sessionID,
            requestId: originRequestId,
            method: req.method,
            url: req.url,
            status: result.status,
            headers: result.headers,
            body: result.body,
            sourceIsCaptured,
          })
        }
        return result
      },
    }

    const targetInfo = {
      method: resolved.method,
      url: resolved.url.toString(),
      auth: resolved.auth,
      provenance: resolved.provenance,
    }

    let points: InjPoint[]
    let rejected: { point: string; reason: string }[] = []
    if (params.points && params.points.length > 0) {
      const v = validatePoints(params.points as InjPoint[])
      points = v.points
      rejected = v.rejected
    } else {
      points = enumeratePoints(resolved, params.target_param)
    }

    if (points.length === 0) {
      return {
        title: "inject_probe",
        output: JSON.stringify(
          {
            note: "No injection points to probe (no query/form params auto-found and no explicit `points` given). Pass `points` (json_body/header/cookie/path/…) to target other locations. This tool did NOT test any injection point.",
            target: targetInfo,
            rejected_points: rejected.length ? rejected : undefined,
          },
          null,
          2,
        ),
        metadata: {},
      }
    }

    const backoff = createBackoff(DELAY)
    const results: { class: string; observations: unknown[] }[] = []
    const leads: string[] = []
    const testedLabels: string[] = []
    const notTested = new Set<string>()
    const blockSignals = new Set<string>()
    const markBlocked = (o: { point: string; blocked?: boolean; block_signal?: string }, cls: string) => {
      if (o.block_signal) blockSignals.add(`${cls} @ ${o.point}: ${o.block_signal}`)
      else if (o.blocked) blockSignals.add(`${cls} @ ${o.point}: blocked (WAF/rate-limit)`)
    }
    for (const cls of params.vuln_type) {
      const classObs: unknown[] = []
      for (const point of points) {
        if (ctx.abort.aborted || budget.sent >= budget.max) break
        const field = `${point.location}:${point.name}`
        const reg: RegisterCanary = (token, kind) => {
          canaries.register({
            token,
            kind,
            originRequestId,
            endpoint: resolved.url.toString(),
            field,
            agent: ctx.agent,
            vulnClass: cls,
          })
        }
        if (cls === "xss") {
          const o = await probeXssPoint(sender, resolved, point, ctx.abort, DELAY, budget, reg, backoff)
          classObs.push(o)
          markBlocked(o, cls)
          if (o.marker_reflected) {
            signalStore.record({
              type: "reflected_input",
              owner: "input-validation",
              requestId: originRequestId,
              evidence: `marker reflected raw at ${field}${o.context ? ` (${o.context} context)` : ""}${o.marker_html_encoded ? " [HTML-encoded]" : ""}`,
              meta: { field, context: o.context, html_encoded: o.marker_html_encoded, tags: o.surviving_tags.length },
            })
          }
          if (o.weaponized.length > 0)
            leads.push(
              `xss @ ${o.point}: READY payload(s) reflected un-encoded (copy & fire, filter-bypass already applied): ${o.weaponized.slice(0, 4).join("  |  ")} — confirm execution.`,
            )
          else if (o.surviving_tags.length > 0)
            leads.push(
              `xss @ ${o.point}: tag(s) [${o.surviving_tags.join(", ")}] reflected un-encoded${o.context ? ` in ${o.context} context` : ""} — weaponize one (event handler) and confirm.`,
            )
        } else if (cls === "ssti") {
          const o = await probeSstiPoint(sender, resolved, point, ctx.abort, DELAY, budget, reg, backoff)
          classObs.push(o)
          markBlocked(o, cls)
          if (o.evaluated.length > 0)
            leads.push(
              `ssti @ ${o.point}: syntax [${o.evaluated.map((e) => e.syntax).join(", ")}] evaluated ${SSTI_EXPR}→${SSTI_PRODUCT} server-side (snippet in evaluated) — confirm engine + weaponize.`,
            )
        } else if (cls === "cmd") {
          const o = await probeCmdPoint(sender, resolved, point, ctx.abort, DELAY, budget, reg, backoff)
          classObs.push(o)
          markBlocked(o, cls)
          if (o.command_output.length > 0)
            leads.push(
              `cmd @ ${o.point}: separator(s) [${o.command_output.map((c) => c.separator).join(", ")}] returned command output (snippet in command_output) — confirm + enumerate.`,
            )
        } else if (cls === "lfi") {
          const o = await probeLfiPoint(sender, resolved, point, ctx.abort, DELAY, budget, backoff)
          classObs.push(o)
          markBlocked(o, cls)
          if (o.findings.length > 0)
            leads.push(
              `lfi @ ${o.point}: READY traversal(s) disclosed a known OS file — technique [${[...new Set(o.findings.map((x) => x.technique))].join(", ")}] read ${[...new Set(o.findings.map((x) => x.target))].join(", ")}. Payload: ${o.findings[0]!.payload} — this SHAPE beat the filter; swap in the app target (FLAG.php/config).`,
            )
        } else if (cls === "hpp") {
          const o = await probeHppPoint(sender, resolved, point, ctx.abort, DELAY, budget, reg, backoff)
          classObs.push(o)
          markBlocked(o, cls)
          if (o.append_reflected || o.prepend_reflected) {
            signalStore.record({
              type: "reflected_input",
              owner: "input-validation",
              requestId: originRequestId,
              evidence: `HPP duplicate-param reflected at ${field} (parser: ${o.parser_behavior})`,
              meta: { field, parser_behavior: o.parser_behavior, append: o.append_reflected, prepend: o.prepend_reflected },
            })
          }
          if (o.parser_behavior !== "inconclusive")
            leads.push(
              `hpp @ ${o.point}: parser behavior = ${o.parser_behavior} (append_reflected=${o.append_reflected}, prepend_reflected=${o.prepend_reflected}) — fire injection payloads at the duplicate position to exploit.`,
            )
        } else {
          const o = await probeErrorSigPoint(sender, resolved, point, cls, ctx.abort, DELAY, budget, backoff)
          classObs.push(o)
          markBlocked(o, cls)
          if (o.error_findings.length > 0)
            leads.push(
              `${cls} @ ${o.point}: payload(s) [${o.error_findings.map((e) => e.payload).join(" ")}] tripped a ${cls} error signature (snippet in error_findings) — investigate (exploitation is YOURS).`,
            )
          const diffs = o.bool_findings.filter((b) => b.differential)
          if (diffs.length > 0)
            leads.push(
              `${cls} @ ${o.point}: boolean-differential on [${diffs.map((b) => `${b.pair} {${b.signals.join(",")}}`).join(" ; ")}] (baseline=${o.baseline.bytes}B±${o.baseline.byte_jitter}; true/false detail in bool_findings) — boolean-injection lead; verify.`,
            )
        }
      }
      results.push({ class: cls, observations: classObs })
      testedLabels.push(TESTED_LABEL[cls]!)
      for (const n of NOT_TESTED_BY_CLASS[cls]!) notTested.add(n)
    }

    const truncated = budget.sent >= budget.max
    if (truncated)
      notTested.add(
        `send cap (${budget.max}) reached — some class×point combinations were NOT probed; narrow points/vuln_type and re-run.`,
      )

    const blocked = [...blockSignals]
    const evidence = {
      note:
        "OBSERVATIONS ONLY — inject_probe does NOT confirm vulnerabilities and never exploits. Every entry is a LEAD you must verify yourself, never a verdict. Exploitation — UNION, OR-bypass, auth-bypass, blind extraction, weaponization — is YOUR job, not the probe's." +
        (leads.length === 0 && blocked.length > 0
          ? " ⚠️ NO LEADS but payloads were WAF/challenge-BLOCKED at some points — this is NOT evidence the endpoint is safe; the app was shielded. Escalate with encoding/evasion (agent-side) or a different vantage."
          : ""),
      target: targetInfo,
      probed: `classes [${params.vuln_type.join(", ")}] × ${points.length} point(s)`,
      results,
      verification_required: true,
      leads,
      block_signals: blocked.length ? blocked : undefined,
      coverage: { tested: testedLabels, not_tested: [...notTested] },
      sends: { used: budget.sent, cap: budget.max, truncated },
      backoff: backoff.totalBlocks > 0
        ? { delay_ms: backoff.delay, total_blocks: backoff.totalBlocks, escalations: backoff.escalations }
        : undefined,
      rejected_points: rejected.length ? rejected : undefined,
      aborted: ctx.abort.aborted || undefined,
    }
    const title = leads.length
      ? `inject_probe: ${leads.length} lead(s) across [${params.vuln_type.join(",")}] (verify)`
      : blocked.length
        ? `inject_probe: no leads but ${blocked.length} WAF-block(s) — NOT proof of safety`
        : `inject_probe: no leads across [${params.vuln_type.join(",")}]`
    return { title, output: JSON.stringify(evidence, null, 2), metadata: {} }
  },
})
