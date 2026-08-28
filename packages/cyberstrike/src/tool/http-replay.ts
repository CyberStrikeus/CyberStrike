// http_replay / http_replay_raw — the agent-facing tool surface for the replay
// engine (docs/http-replay-engine-design.md §3.14). Thin CS glue over the
// verified engine in ../replay: resolve a captured request, apply mutations (or
// take raw bytes), send it through a governed backend, and hand back FACTS
// (status, timing, reflection, error signatures, a curl-equivalent) — never a
// verdict. Modeled on tool/inject-probe.ts (request resolution + scope guard).
//
// Payloads travel as request DATA through the engine, never a shell — this is
// the whole point: it replaces the curl-in-bash confirm/weaponize path.

import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { Request } from "../session/request"
import { WebCredential, COMMON_AUTH_HEADERS } from "../session/web/web-credential"
import { HttpMessage } from "../replay/message"
import { Apply } from "../replay/apply"
import { Send } from "../replay/send"
import { Governor } from "../replay/governor"
import { BackendFetch } from "../replay/backend-fetch"
import { BackendSocket } from "../replay/backend-socket"
import { ReplayResponse } from "../replay/response"
import { Observe } from "../replay/observe"
import { Mutate } from "../replay/mutate"
import { Batch } from "../replay/batch"

// Encode codecs mirrored as a zod enum for the tool schema (kept in sync with
// Encode.Codec in ../replay/encode.ts).
const CODEC = z.enum([
  "url",
  "url-all",
  "url-double",
  "base64",
  "base64url",
  "hex",
  "html-dec",
  "html-hex",
  "unicode",
  "upper",
  "lower",
])

const MUTATION = z.object({
  op: z.enum([
    "set-query",
    "add-query",
    "remove-query",
    "set-header",
    "add-header",
    "remove-header",
    "set-body",
    "set-method",
    "set-target",
    "body-merge",
    "body-set-field",
    "body-remove-field",
    "set-cookie",
    "remove-cookie",
    "set-path-param",
  ]),
  name: z
    .string()
    .optional()
    .describe(
      "param/header/cookie name, JSON field dot-path (body-set-field/body-remove-field), or path segment position as a 0-based string for set-path-param — the position COUNTS the leading empty segment, so in `/rest/products/1/reviews` the id `1` is position 3 (segments: ['', 'rest', 'products', '1', 'reviews']). To rewrite a path id, prefer `set-target` (full request-target) to avoid position miscounts. Required for query/header/cookie/body-field/path-param ops.",
    ),
  value: z
    .string()
    .optional()
    .describe(
      "new value; the method for set-method, the request-target for set-target, JSON string for body-merge, new path segment value for set-path-param",
    ),
  encode: z
    .array(CODEC)
    .optional()
    .describe('encode pipeline applied to value before it is set (e.g. ["url","url"] for double-encode)'),
})

// Compare side — each side of a compare can independently set credential,
// unauthenticated, and mutations.
const COMPARE_SIDE = z.object({
  credential: z.string().optional().describe("Credential ID to use for this side of the comparison"),
  unauthenticated: z.boolean().optional().describe("Strip all auth headers for this side"),
  mutations: z.array(MUTATION).optional().describe("Mutations specific to this side"),
})

// Derive a sendable origin (scheme://host[:port]) from a captured request.
function originOf(request: Request.Info): string | { error: string } {
  const host = request.host ?? (request.origin ? safeURL(request.origin)?.host : undefined)
  if (!host) return { error: "request has no host/origin — cannot resolve a sendable origin" }
  if (request.origin) return request.origin.replace(/\/+$/, "")
  const scheme = request.scheme ?? "http"
  const port = request.port ? `:${request.port}` : ""
  return `${scheme}://${host}${port}`
}

function safeURL(u: string): URL | undefined {
  try {
    return new URL(u)
  } catch {
    return undefined
  }
}

// Build a base message + origin from a constructed target (the FALLBACK source
// when no captured request_id is given). Message construction lives in
// HttpMessage.build; here we only validate the URL and derive the origin.
function buildFromTarget(t: {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
}): { baseMsg: HttpMessage.Request; origin: string } | { error: string } {
  const url = safeURL(t.url)
  if (!url) return { error: `Invalid target url "${t.url}".` }
  return {
    baseMsg: HttpMessage.build({ method: t.method, url, headers: t.headers, body: t.body }),
    origin: `${url.protocol}//${url.host}`,
  }
}

const BODY_PREVIEW = 4096

function summarize(result: ReplayResponse.Result, marker?: string): Record<string, unknown> {
  if (result.error) {
    return { sent: true, error: result.error, timing: result.timing, attempts: (result as Send.Result).attempts }
  }
  const res = result.response!
  const bodyText = new TextDecoder("latin1").decode(res.body)
  const out: Record<string, unknown> = {
    status: res.status,
    reason: res.reason,
    timing_ms: Math.round(result.timing.totalMs),
    ttfb_ms: result.timing.ttfbMs !== undefined ? Math.round(result.timing.ttfbMs) : undefined,
    response_headers: res.headers.slice(0, 40),
    body_len: res.body.length,
    body_preview: bodyText.slice(0, BODY_PREVIEW),
    body_truncated: res.body.length > BODY_PREVIEW,
    error_signatures: Observe.errorSignatures(res.body),
    attempts: (result as Send.Result).attempts,
  }
  if (marker) out.reflection = Observe.reflection(res.body, marker)
  return out
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

function stripAuthHeaders(msg: HttpMessage.Request): HttpMessage.Request {
  let out = msg
  for (const h of COMMON_AUTH_HEADERS) {
    out = Mutate.removeHeader(out, h)
  }
  return out
}

function applyCredential(msg: HttpMessage.Request, credentialID: string): HttpMessage.Request | { error: string } {
  const cred = WebCredential.getById(credentialID)
  if (!cred) return { error: `Credential "${credentialID}" not found in this session.` }
  let out = stripAuthHeaders(msg)
  for (const [name, value] of Object.entries(cred.headers)) {
    out = Mutate.setHeader(out, name, value)
  }
  return out
}

function applyAuthParams(
  msg: HttpMessage.Request,
  opts: { credential?: string; unauthenticated?: boolean },
): HttpMessage.Request | { error: string } {
  if (opts.unauthenticated) return stripAuthHeaders(msg)
  if (opts.credential) return applyCredential(msg, opts.credential)
  return msg
}

// ── Governed send wrapper ─────────────────────────────────────────────────────

async function sendGoverned(
  msg: HttpMessage.Request,
  origin: string,
  opts: {
    insecure_tls?: boolean
    total_timeout_ms?: number
    follow_redirects?: boolean
    signal?: AbortSignal
  },
): Promise<Send.Result> {
  const budget = new Governor.GlobalBudget()
  const breaker = new Governor.CircuitBreaker()
  return Send.governed(
    () =>
      BackendFetch.send(msg, {
        origin,
        rejectUnauthorized: opts.insecure_tls === false,
        totalTimeoutMs: opts.total_timeout_ms,
        followRedirects: opts.follow_redirects,
        signal: opts.signal,
      }),
    msg.method,
    { budget, breaker },
    {},
  )
}

// ── Diff builder ──────────────────────────────────────────────────────────────

function buildDiff(baseline: ReplayResponse.Result, exploit: ReplayResponse.Result): Record<string, unknown> {
  const bs = baseline.response
  const ex = exploit.response

  if (!bs || !ex) {
    return {
      comparable: false,
      baseline_error: baseline.error?.message ?? null,
      exploit_error: exploit.error?.message ?? null,
    }
  }

  const baseBody = new TextDecoder("latin1").decode(bs.body)
  const expBody = new TextDecoder("latin1").decode(ex.body)

  return {
    comparable: true,
    status_match: bs.status === ex.status,
    baseline_status: bs.status,
    exploit_status: ex.status,
    body_length_match: bs.body.length === ex.body.length,
    baseline_body_len: bs.body.length,
    exploit_body_len: ex.body.length,
    body_content_match: baseBody === expBody,
    timing_delta_ms: Math.round((exploit.timing.totalMs ?? 0) - (baseline.timing.totalMs ?? 0)),
  }
}

// ── http_replay (structured) ─────────────────────────────────────────────────

const REPLAY_DESC = `Replay a captured request with field-level mutations, sent through the structured (fetch) backend — no shell, so payloads land as request DATA byte-for-byte.

Resolve request_id, apply mutations[] (set/add/remove query & header, set body/method/target, body-merge, body-set-field, body-remove-field, set-cookie, remove-cookie, set-path-param — each value optionally passed through an encode pipeline), then send once (governed: timeout, retry only on transient+idempotent, budget, circuit breaker). Returns FACTS: status, timing, response headers/body preview, error-signature hits, and (if you pass a marker) whether that marker reflected raw vs html-encoded — plus a copy-pasteable curl equivalent for your report. It never decides "vulnerable"; you judge the observations.

Special modes:
- **credential**: Swap auth headers — pass a session credential ID and the engine strips all auth headers from the captured request and injects the credential's headers. Use for cross-credential IDOR testing.
- **unauthenticated**: Strip all auth headers (Cookie, Authorization, etc.) from the request.
- **compare**: Send baseline + exploit in ONE call and get a structured diff (status match, body length, body content, timing delta). Each side independently configures credential/unauthenticated/mutations.
- **sweep**: Test multiple values for one mutation in a single call. Returns an array of results.
- **follow_redirects**: Follow 3xx redirects (default: false — manual redirect for pentest visibility).

Source: usually a captured **request_id** (PRIMARY — carries the real auth, cookies and headers, so prefer it whenever the endpoint was captured). For an endpoint the crawl never captured, pass a constructed **target** {method, url, headers?, body?} instead (FALLBACK) — the same captured-host scope guard applies, so it can reach an un-captured path but not a new host. Give exactly one of request_id / target.

Use for confirm/weaponize instead of building curl in bash. For byte-exact / smuggling / malformed requests use http_replay_raw.`

export const HttpReplayTool = Tool.define("http_replay", {
  description: REPLAY_DESC,
  parameters: z.object({
    request_id: z
      .string()
      .optional()
      .describe(
        "PRIMARY source — ID of a captured request to replay (its real URL, headers, cookies, auth). ALWAYS use this when the endpoint was already captured. Provide EITHER request_id OR target, never both.",
      ),
    target: z
      .object({
        method: z.string().describe("HTTP method, e.g. GET or POST."),
        url: z
          .string()
          .describe(
            "Absolute URL incl. scheme and host, e.g. https://host/api/x?y=1. Host must be one the crawl captured.",
          ),
        headers: z
          .record(z.string(), z.string())
          .optional()
          .describe("Extra request headers (Host is derived from url)."),
        body: z.string().optional().describe("Request body, if any."),
      })
      .optional()
      .describe(
        "FALLBACK source — construct a request from scratch. Use ONLY when the endpoint was NOT captured (e.g. one you inferred by reasoning). NEVER use when a matching captured request_id exists (you would lose the real cookies/headers). mutations/credential/compare/sweep apply to it exactly as to a captured request.",
      ),
    mutations: z
      .array(MUTATION)
      .optional()
      .describe("Ordered field mutations to apply before sending. Omit to replay unchanged."),
    credential: z
      .string()
      .optional()
      .describe(
        "Session credential ID — strips all auth headers from the captured request and injects this credential's headers. Use for cross-credential IDOR testing. Get credential IDs from web_get_session_context.",
      ),
    unauthenticated: z
      .boolean()
      .optional()
      .describe(
        "Strip all auth headers (Cookie, Authorization, x-auth-token, etc.) before sending. Use to test whether endpoints enforce authentication.",
      ),
    compare: z
      .object({
        baseline: COMPARE_SIDE.optional().describe(
          "Baseline request config. Omit to use the captured request with its original auth.",
        ),
        exploit: COMPARE_SIDE.describe("Exploit request config — the modified request to compare against baseline."),
      })
      .optional()
      .describe(
        "Compare mode: sends baseline + exploit and returns both responses with a structured diff. Satisfies the Confirmation Protocol (baseline → exploit → diff) in ONE tool call.",
      ),
    sweep: z
      .object({
        mutation: MUTATION.describe("The mutation to vary — its value is overridden by each sweep value."),
        values: z.array(z.string()).min(1).max(50).describe("Values to test for the mutation."),
      })
      .optional()
      .describe(
        "Sweep mode: test multiple values for one mutation in a single call. Returns an array of {value, status, body_len, ...} for each value.",
      ),
    marker: z
      .string()
      .optional()
      .describe("A unique token you injected via a mutation — reported back as reflected raw / html-encoded / absent."),
    follow_redirects: z
      .boolean()
      .optional()
      .describe("Follow 3xx redirects (default false — manual redirect for pentest visibility)."),
    insecure_tls: z
      .boolean()
      .optional()
      .describe("Accept invalid/self-signed certs (default true — pentest targets often have bad certs)."),
    total_timeout_ms: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Per-send timeout. Raise above your intended SLEEP for time-based tests."),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const err = (output: string) => ({ title: "http_replay", output, metadata: {} })

    // Resolve the request source: a captured request_id (PRIMARY) or a constructed
    // target (FALLBACK, for endpoints the crawl never captured). Exactly one.
    const hasRid = !!params.request_id
    const hasTarget = !!params.target
    if (hasRid && hasTarget) return err("Provide either request_id or target, not both.")
    if (!hasRid && !hasTarget) return err("Provide request_id (a captured request) or target (a constructed request).")

    let baseMsg: HttpMessage.Request
    let origin: string
    if (hasRid) {
      const request = Request.get(sessionID).find((r) => r.id === params.request_id)
      if (!request) return err(`Request "${params.request_id}" not found.`)
      if (!request.raw_request) return err(`Request "${params.request_id}" has no raw_request to replay.`)
      const o = originOf(request)
      if (typeof o !== "string") return err(o.error)
      origin = o
      try {
        baseMsg = HttpMessage.parse(request.raw_request)
      } catch (e) {
        return err(`Could not parse request: ${e instanceof Error ? e.message : String(e)}`)
      }
    } else {
      const built = buildFromTarget(params.target!)
      if ("error" in built) return err(built.error)
      baseMsg = built.baseMsg
      origin = built.origin
    }

    // Scope guard applies to BOTH sources — a constructed target must resolve to a
    // host the crawl already captured (it can reach an un-captured PATH, not a new host).
    const originHost = safeURL(origin)?.hostname ?? ""
    if (!Request.hostInScope(sessionID, originHost)) {
      return {
        title: "http_replay — refused (out of scope)",
        output: `Refusing host "${originHost}": not among this session's captured in-scope hosts.`,
        metadata: {},
      }
    }

    const sendOpts = {
      insecure_tls: params.insecure_tls,
      total_timeout_ms: params.total_timeout_ms,
      follow_redirects: params.follow_redirects,
      signal: ctx.abort,
    }

    // ── Compare mode ──────────────────────────────────────────────────────
    if (params.compare) {
      const { compare } = params

      // Build baseline
      let baselineMsg = baseMsg
      const baseAuth = applyAuthParams(baselineMsg, compare.baseline ?? {})
      if (typeof baseAuth !== "object" || "error" in baseAuth)
        return { title: "http_replay compare", output: (baseAuth as { error: string }).error, metadata: {} }
      baselineMsg = baseAuth
      if (compare.baseline?.mutations)
        baselineMsg = Apply.mutations(baselineMsg, compare.baseline.mutations as Apply.Mutation[])

      // Build exploit
      let exploitMsg = baseMsg
      const expAuth = applyAuthParams(exploitMsg, compare.exploit)
      if (typeof expAuth !== "object" || "error" in expAuth)
        return { title: "http_replay compare", output: (expAuth as { error: string }).error, metadata: {} }
      exploitMsg = expAuth
      if (compare.exploit.mutations)
        exploitMsg = Apply.mutations(exploitMsg, compare.exploit.mutations as Apply.Mutation[])

      const [baselineResult, exploitResult] = await Promise.all([
        sendGoverned(baselineMsg, origin, sendOpts),
        sendGoverned(exploitMsg, origin, sendOpts),
      ])

      const output = {
        baseline: { ...summarize(baselineResult, params.marker), curl: Apply.toCurl(baselineMsg, origin) },
        exploit: { ...summarize(exploitResult, params.marker), curl: Apply.toCurl(exploitMsg, origin) },
        diff: buildDiff(baselineResult, exploitResult),
      }

      return {
        title: `http_replay compare ${originHost}`,
        output: JSON.stringify(output, null, 2),
        metadata: {},
      }
    }

    // ── Sweep mode ────────────────────────────────────────────────────────
    if (params.sweep) {
      const { sweep } = params

      // Apply auth + shared mutations to base
      let sharedMsg = baseMsg
      const authResult = applyAuthParams(sharedMsg, params)
      if (typeof authResult !== "object" || "error" in authResult)
        return { title: "http_replay sweep", output: (authResult as { error: string }).error, metadata: {} }
      sharedMsg = authResult
      if (params.mutations) sharedMsg = Apply.mutations(sharedMsg, params.mutations as Apply.Mutation[])

      const results = await Batch.run(
        sweep.values,
        async (value) => {
          try {
            const mut = { ...sweep.mutation, value } as Apply.Mutation
            const varMsg = Apply.mutations(sharedMsg, [mut])
            const result = await sendGoverned(varMsg, origin, sendOpts)
            return { value, ...summarize(result, params.marker) }
          } catch (e) {
            return { value, error: e instanceof Error ? e.message : String(e) }
          }
        },
        { concurrency: 3 },
      )

      return {
        title: `http_replay sweep (${sweep.values.length} values) ${originHost}`,
        output: JSON.stringify(results.filter(Boolean), null, 2),
        metadata: {},
      }
    }

    // ── Single send mode ──────────────────────────────────────────────────
    let msg = baseMsg
    try {
      const authResult = applyAuthParams(msg, params)
      if (typeof authResult !== "object" || "error" in authResult)
        return { title: "http_replay", output: (authResult as { error: string }).error, metadata: {} }
      msg = authResult
      if (params.mutations?.length) msg = Apply.mutations(msg, params.mutations as Apply.Mutation[])
    } catch (e) {
      return {
        title: "http_replay",
        output: `Could not build request: ${e instanceof Error ? e.message : String(e)}`,
        metadata: {},
      }
    }

    const result = await sendGoverned(msg, origin, sendOpts)

    const output = {
      target: { method: msg.method, origin, request_target: msg.target },
      ...summarize(result, params.marker),
      curl: Apply.toCurl(msg, origin),
    }
    return { title: `http_replay ${msg.method} ${originHost}`, output: JSON.stringify(output, null, 2), metadata: {} }
  },
})

// ── http_replay_raw (byte-exact) ─────────────────────────────────────────────

const RAW_DESC = `Send an EXACT byte sequence over a raw TCP/TLS socket — no normalization. This is the byte-exact backend for request smuggling / desync, intentionally-malformed messages, duplicate/odd-case headers, and Host-header overrides that http_replay (fetch) would normalize away.

Provide request_id (PRIMARY) to derive host/port/TLS from a captured request; by default it sends that request's raw bytes, or pass raw to send bytes you crafted. For an endpoint the crawl never captured, pass target_url (FALLBACK) together with raw instead. Give exactly one of request_id / target_url. Returns the parsed response (status/headers/body) with timing. Host must be one the crawl already captured.`

export const HttpReplayRawTool = Tool.define("http_replay_raw", {
  description: RAW_DESC,
  parameters: z.object({
    request_id: z
      .string()
      .optional()
      .describe(
        "PRIMARY source — a captured request whose host/port/TLS to connect to (and whose bytes to send unless `raw` is given). Provide EITHER request_id OR target_url, never both.",
      ),
    target_url: z
      .string()
      .optional()
      .describe(
        "FALLBACK — connect to this absolute URL's host/port/TLS instead of a captured request. Use ONLY for an endpoint the crawl never captured; requires `raw` (no captured bytes to fall back on). Host must be one the crawl captured.",
      ),
    raw: z
      .string()
      .optional()
      .describe(
        "Exact raw HTTP request bytes to send. Omit to send the captured request's raw bytes unchanged (required when using target_url).",
      ),
    insecure_tls: z.boolean().optional().describe("Accept invalid/self-signed certs (default true)."),
    total_timeout_ms: z.number().int().positive().optional(),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const err = (output: string) => ({ title: "http_replay_raw", output, metadata: {} })

    // Source: a captured request_id (PRIMARY) or a constructed target_url (FALLBACK). Exactly one.
    const hasRid = !!params.request_id
    const hasTarget = !!params.target_url
    if (hasRid && hasTarget) return err("Provide either request_id or target_url, not both.")
    if (!hasRid && !hasTarget) return err("Provide request_id or target_url.")

    let url: URL
    let raw: string | undefined
    if (hasRid) {
      const request = Request.get(sessionID).find((r) => r.id === params.request_id)
      if (!request) return err(`Request "${params.request_id}" not found.`)
      const o = originOf(request)
      if (typeof o !== "string") return err(o.error)
      const u = safeURL(o)
      if (!u) return err(`Invalid origin "${o}".`)
      url = u
      raw = params.raw ?? request.raw_request
    } else {
      const u = safeURL(params.target_url!)
      if (!u) return err(`Invalid target_url "${params.target_url}".`)
      url = u
      raw = params.raw
    }

    // Scope guard applies to BOTH sources — a constructed target_url must resolve to
    // a host the crawl already captured.
    if (!Request.hostInScope(sessionID, url.hostname)) {
      return {
        title: "http_replay_raw — refused (out of scope)",
        output: `Refusing host "${url.hostname}": not among this session's captured in-scope hosts.`,
        metadata: {},
      }
    }

    if (!raw)
      return err(
        hasTarget
          ? "target_url requires raw (the exact bytes to send)."
          : "No raw bytes to send (request has no raw_request and none provided).",
      )

    const useTls = url.protocol === "https:"
    const port = url.port ? Number.parseInt(url.port, 10) : useTls ? 443 : 80

    const result = await BackendSocket.send(new TextEncoder().encode(raw), {
      host: url.hostname,
      port,
      tls: useTls,
      rejectUnauthorized: params.insecure_tls === false,
      totalTimeoutMs: params.total_timeout_ms,
      signal: ctx.abort,
    })

    const output = { target: { host: url.hostname, port, tls: useTls }, ...summarize(result) }
    return {
      title: `http_replay_raw ${url.hostname}:${port}`,
      output: JSON.stringify(output, null, 2),
      metadata: {},
    }
  },
})
