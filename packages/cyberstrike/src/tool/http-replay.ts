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
import { CredentialRecipe, Recipe } from "../session/web/credential-recipe"

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

// Every attack request must target a host the crawl already captured — closes
// the SSRF-shaped hole where a mutated Host/target could aim at an arbitrary
// host. Empty allowlist is refused, not waved through.
function inScope(sessionID: string, host: string): boolean {
  const allowed = new Set(
    Request.get(sessionID)
      .map((r) => r.host)
      .filter((h): h is string => Boolean(h)),
  )
  return allowed.size > 0 && allowed.has(host)
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
    retried: result.retried ?? false,
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

// ── Auto-refresh on 401 ──────────────────────────────────────────────────────

const refreshing = new Map<string, Promise<boolean>>()

async function tryAutoRefresh(
  credentialID: string,
  sessionID: string,
  origin: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const pending = refreshing.get(credentialID)
  if (pending) return pending

  const promise = doRefresh(credentialID, sessionID, origin, signal)
  refreshing.set(credentialID, promise)
  try {
    return await promise
  } finally {
    refreshing.delete(credentialID)
  }
}

async function doRefresh(
  credentialID: string,
  sessionID: string,
  origin: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const raw = WebCredential.getRecipe(credentialID)
  if (!raw) return false

  const parsed = Recipe.safeParse(raw)
  if (!parsed.success) return false

  try {
    const result = await CredentialRecipe.execute(parsed.data, { sessionID, origin, signal })
    if (Object.keys(result.headers).length === 0) return false

    const cred = WebCredential.getById(credentialID)
    const merged = { ...(cred?.headers ?? {}) }
    for (const [name, value] of Object.entries(result.headers)) {
      const lower = name.toLowerCase()
      for (const k of Object.keys(merged)) {
        if (k.toLowerCase() === lower && k !== name) delete merged[k]
      }
      merged[name] = value
    }

    WebCredential.update({
      id: credentialID,
      sessionID,
      headers: merged,
    })
    return true
  } catch {
    return false
  }
}

async function tryProactiveRefresh(
  credentialID: string,
  sessionID: string,
  origin: string,
  signal?: AbortSignal,
): Promise<void> {
  const cred = WebCredential.getById(credentialID)
  if (!cred) return

  const raw = WebCredential.getRecipe(credentialID)
  if (!raw) return

  const parsed = Recipe.safeParse(raw)
  if (!parsed.success) return

  const ttl = parsed.data.ttl_seconds
  if (!ttl) return

  const elapsed = (Date.now() - cred.time.updated) / 1000
  if (elapsed < ttl * 0.8) return

  await tryAutoRefresh(credentialID, sessionID, origin, signal)
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
- **Auto-refresh**: When a credential has a saved recipe (via credential_set_recipe) and the server returns 401, the engine automatically executes the recipe to mint fresh tokens and retries the request once. The response includes retried: true when this happens.

Use for confirm/weaponize instead of building curl in bash. For byte-exact / smuggling / malformed requests use http_replay_raw.`

export const HttpReplayTool = Tool.define("http_replay", {
  description: REPLAY_DESC,
  parameters: z.object({
    request_id: z.string().describe("ID of the captured request to replay (source of URL, headers, body, credential)."),
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
    const request = Request.get(sessionID).find((r) => r.id === params.request_id)
    if (!request) return { title: "http_replay", output: `Request "${params.request_id}" not found.`, metadata: {} }
    if (!request.raw_request) {
      return {
        title: "http_replay",
        output: `Request "${params.request_id}" has no raw_request to replay.`,
        metadata: {},
      }
    }

    const origin = originOf(request)
    if (typeof origin !== "string") return { title: "http_replay", output: origin.error, metadata: {} }

    const originHost = safeURL(origin)?.hostname ?? ""
    if (!inScope(sessionID, originHost)) {
      return {
        title: "http_replay — refused (out of scope)",
        output: `Refusing host "${originHost}": not among this session's captured in-scope hosts.`,
        metadata: {},
      }
    }

    let baseMsg: HttpMessage.Request
    try {
      baseMsg = HttpMessage.parse(request.raw_request)
    } catch (e) {
      return {
        title: "http_replay",
        output: `Could not parse request: ${e instanceof Error ? e.message : String(e)}`,
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

      const compareCredIDs = new Set<string>()
      if (compare.baseline?.credential) compareCredIDs.add(compare.baseline.credential)
      if (compare.exploit.credential) compareCredIDs.add(compare.exploit.credential)
      for (const cid of compareCredIDs) {
        await tryProactiveRefresh(cid, sessionID, origin, ctx.abort)
      }

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

      if (params.credential) {
        await tryProactiveRefresh(params.credential, sessionID, origin, ctx.abort)
      }

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

    if (params.credential) {
      await tryProactiveRefresh(params.credential, sessionID, origin, ctx.abort)
    }

    let result = await sendGoverned(msg, origin, sendOpts)

    // Auto-refresh on 401: if credential has a recipe, mint fresh tokens and retry once
    if (result.response?.status === 401 && params.credential) {
      const refreshed = await tryAutoRefresh(params.credential, sessionID, origin, ctx.abort)
      if (refreshed) {
        let retryMsg = baseMsg
        const retryAuth = applyCredential(retryMsg, params.credential)
        if (typeof retryAuth !== "object" || !("error" in retryAuth)) {
          retryMsg = retryAuth as HttpMessage.Request
          if (params.mutations?.length) retryMsg = Apply.mutations(retryMsg, params.mutations as Apply.Mutation[])
          const retryResult = await sendGoverned(retryMsg, origin, sendOpts)
          result = { ...retryResult, retried: true }
          msg = retryMsg
        }
      }
    }

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

Provide request_id to derive host/port/TLS from a captured request; by default it sends that request's raw bytes, or pass raw to send bytes you crafted. Returns the parsed response (status/headers/body) with timing. Host must be one the crawl already captured.`

export const HttpReplayRawTool = Tool.define("http_replay_raw", {
  description: RAW_DESC,
  parameters: z.object({
    request_id: z
      .string()
      .describe("Captured request whose host/port/TLS to connect to (and whose bytes to send unless `raw` is given)."),
    raw: z
      .string()
      .optional()
      .describe("Exact raw HTTP request bytes to send. Omit to send the captured request's raw bytes unchanged."),
    insecure_tls: z.boolean().optional().describe("Accept invalid/self-signed certs (default true)."),
    total_timeout_ms: z.number().int().positive().optional(),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const request = Request.get(sessionID).find((r) => r.id === params.request_id)
    if (!request) return { title: "http_replay_raw", output: `Request "${params.request_id}" not found.`, metadata: {} }

    const origin = originOf(request)
    if (typeof origin !== "string") return { title: "http_replay_raw", output: origin.error, metadata: {} }
    const url = safeURL(origin)
    if (!url) return { title: "http_replay_raw", output: `Invalid origin "${origin}".`, metadata: {} }

    if (!inScope(sessionID, url.hostname)) {
      return {
        title: "http_replay_raw — refused (out of scope)",
        output: `Refusing host "${url.hostname}": not among this session's captured in-scope hosts.`,
        metadata: {},
      }
    }

    const raw = params.raw ?? request.raw_request
    if (!raw)
      return {
        title: "http_replay_raw",
        output: `No raw bytes to send (request has no raw_request and none provided).`,
        metadata: {},
      }

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
