import z from "zod"
import { Tool } from "./tool"
import { WebCredential } from "../session/web/web-credential"
import { WebRole } from "../session/web/web-role"
import { WebObject } from "../session/web/web-object"
import { WebFunction } from "../session/web/web-function"
import { WebRetest } from "../session/web/web-retest"
import { Request } from "../session/request"
import { Observation } from "../session/observation"
import { Session } from "../session"
import { Vulnerability } from "../session/vulnerability"

const description = `Get the bounded web-application context for this session — scoped to the endpoint you are testing, so it stays small no matter how large the session grows.

It returns:
- recent: the objects + functions the analyzer just extracted for the CURRENT endpoint, WITH their schema and observed values (the IDs each credential saw — your IDOR/mass-assignment substrate). This is everything you normally need; you do NOT have to fetch anything.
- catalog: the NAMES of every object/function/role discovered app-wide (no schemas/values). For any name you want full detail on, call web_get_detail(kind, id).
- credentials: auth credentials (tracking-cookie noise stripped).
- vulnerabilities: last 30 confirmed findings (dedup awareness).
- recent_requests: the last 5 analyzed endpoints (id + method + path). For a request's full headers/body/response, call web_get_request_detail(id).
- observations: the cross-credential IDOR shortlist (endpoints reached by 2+ credentials).

Add 'retest_queue' to include the pending re-test queue.`

export const WebGetSessionContextTool = Tool.define("web_get_session_context", {
  description,
  parameters: z.object({
    include: z
      .array(z.enum(["retest_queue"]))
      .optional()
      .describe(
        "Optional extra sections. The core (recent, catalog, credentials, vulnerabilities, recent_requests, observations) is always returned.",
      ),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const include = params.include ?? []
    const context: Record<string, unknown> = {}

    const allRequests = Request.get(sessionID)
    // The endpoint being tested now = the single request in 'processing' (serial queue).
    const currentReq = allRequests.find((r) => r.status === "processing") ?? allRequests.at(-1)

    // 1. RECENT (inline): objects + functions linked to THIS request — bounded per-request,
    //    constant in session size. The substrate (schema + cross-credential values) inline so
    //    a weak model never has to fetch for the common case.
    if (currentReq) {
      const allValues = WebObject.getAllValues(sessionID)
      const recentObjects = WebObject.touchedByRequest(sessionID, currentReq.id)
      context.recent = {
        request: { id: currentReq.id, method: currentReq.method, path: currentReq.normalized_path },
        objects: recentObjects.map((o) => ({
          name: o.name,
          fields: o.fields,
          sensitive_fields: o.sensitive_fields,
          id_fields: o.id_fields,
          values: allValues
            .filter((v) => v.object_id === o.id)
            .map((v) => ({ field: v.field_name, value: v.value, credential_id: v.credential_id })),
        })),
        functions: WebFunction.get(sessionID)
          .filter((f) => f.request_id === currentReq.id)
          .map((f) => ({ name: f.name, action_type: f.action_type, objects: f.objects })),
      }
    }

    // 2. CATALOG: all NAMES (vocabulary-bounded). Full detail on demand via web_get_detail.
    context.catalog = {
      objects: WebObject.get(sessionID).map((o) => o.name),
      functions: WebFunction.get(sessionID).map((f) => f.name),
      roles: WebRole.get(sessionID).map((r) => r.name),
    }

    // 3. credentials — strip 3rd-party tracking-cookie noise (keep auth/session).
    const credentials = WebCredential.get(sessionID)
    context.credentials = {
      count: credentials.length,
      items: credentials.map((c) => ({
        id: c.id,
        label: c.label,
        headers: stripHeaderNoise(c.headers),
        container_id: c.container_id,
        role_id: c.role_id,
      })),
    }

    // 4. vulnerabilities — last 30 confirmed (capped already).
    const vulns = Vulnerability.confirmed(sessionID)
    context.vulnerabilities = {
      count: vulns.length,
      items: vulns.slice(-30).map((v) => ({
        id: v.id,
        severity: v.severity,
        title: v.title,
        endpoint: v.endpoint,
        status: v.status,
      })),
    }

    // 5. recent_requests — last 5, id+method+path only (no response; fetch via web_get_request_detail).
    context.recent_requests = {
      total: allRequests.length,
      items: allRequests.slice(-5).map((r) => ({
        id: r.id,
        method: r.method,
        path: r.normalized_path,
        status: r.status,
      })),
    }

    // 6. observations — cross-credential IDOR shortlist (bounded by multi-cred endpoints).
    const summary = Observation.sessionSummary(sessionID)
    const reqByKey = new Map<string, { id: string; method: string; path: string }>()
    for (const r of allRequests) {
      if (r.key_hash && !reqByKey.has(r.key_hash)) {
        reqByKey.set(r.key_hash, { id: r.id, method: r.method, path: r.normalized_path })
      }
    }
    const multiCred = summary
      .filter((s) => s.credentialIDs.length >= 2)
      .map((s) => {
        const r = reqByKey.get(s.keyHash)
        return { request_id: r?.id ?? null, method: r?.method ?? null, path: r?.path ?? null, params: s.paramNames }
      })
    context.observations = { multi_credential_count: multiCred.length, multi_credential_endpoints: multiCred }

    if (include.includes("retest_queue")) {
      const counts = WebRetest.count(sessionID)
      context.retest_queue = {
        pending: counts.pending,
        processing: counts.processing,
        completed: counts.completed,
        items: WebRetest.getPending(sessionID)
          .slice(0, 10)
          .map((r) => ({ id: r.id, request_id: r.request_id, trigger_type: r.trigger_type, priority: r.priority })),
      }
    }

    return {
      title: "Web Session Context",
      output: JSON.stringify(context, null, 2),
      metadata: { context },
    }
  },
})

// 3rd-party analytics/tracking cookies carry zero security signal but bloat every credential
// in every context injection. Drop them; keep auth/session/csrf cookies.
const NOISE_COOKIE =
  /^(_ga|_gid|_gcl|_gat|_fbp|_fbc|_hj|hubspotutk|__hs|__hstc|__hssrc|__hssc|mixpanel|_uet|ir_|_pin|_scid|ajs_|amplitude|optimizely|intercom)/i
function stripHeaderNoise(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === "cookie" && typeof v === "string") {
      const kept = v
        .split(";")
        .map((s) => s.trim())
        .filter((c) => {
          const name = c.split("=")[0]?.trim() ?? ""
          return name.length > 0 && !NOISE_COOKIE.test(name)
        })
      out[k] = kept.join("; ")
    } else {
      out[k] = v
    }
  }
  return out
}
