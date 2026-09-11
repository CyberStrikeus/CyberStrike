// login_probe orchestration + oracle (WSTG 4.4.2 default credentials / 4.4.3 weak
// lockout). Socket-free: every send goes through an injected HttpSender (the replay
// engine in production, a mock in tests), so the whole decision logic is unit-tested
// without a socket.
//
// The hard part is the login-SUCCESS oracle. There is no JS engine and no session to
// inspect, so success is judged DIFFERENTIALLY against a KNOWN-BAD baseline (a random
// credential the server must reject): a candidate that moves AWAY from the known-bad
// fingerprint — a session cookie appears, the redirect target diverges off the login
// page, error markers vanish, status turns success-ward — is a LEAD of a valid login,
// never a verdict. This mirrors authn_test's negative-control discipline so a login
// form that "always 200s" cannot become a false positive.
//
// Robustness is first-class: a blocked/timed-out baseline aborts with "NOT evidence of
// safety"; a lockout or WAF signal MID-SPRAY stops the spray (never keep hammering a
// locked account) and is reported as coverage lost, not safety; a CSRF-guarded form is
// flagged rather than silently producing false negatives.
import type { HttpSender, ProbeRequest, ProbeResponse } from "../transport"
import {
  DEFAULT_CREDS,
  deriveFromUsername,
  parseRequest,
  detectFields,
  renderCredentialRequest,
  type CredPair,
  type ParsedRequest,
} from "./login-creds"

// ── block / WAF detection (kept local so the webhook family stays self-contained) ──
const WAF_BODY = /cloudflare|attention required|just a moment|checking your browser|access denied|request unsuccessful|mod_?security|incapsula|sucuri|akamai|captcha|are you a robot|ddos protection/i
const LOCKOUT_BODY = /too many|locked|lockout|temporarily (disabled|blocked|locked)|try again (later|in)|account.{0,20}(disabled|suspended|blocked)|rate.?limit|slow down|please wait|exceeded.{0,20}attempts|captcha/i
const ERROR_BODY = /invalid|incorrect|wrong|failed|denied|not (found|recognized|match)|bad (credentials|username|password)|does not match|unrecognized|hatal[ıi]|geçersiz|yanl[ıi][şs]/i
const SUCCESS_BODY = /log ?out|sign ?out|dashboard|welcome back|my account|profile|logged in|oturumu? kapat|başarıyla giriş/i
const SESSION_COOKIE = /sess|sid\b|auth|token|jwt|login|remember|connect\.sid|phpsessid|jsessionid|asp\.?net|_session|csrf.*session/i

export interface Fingerprint {
  status: number
  bytes: number
  ms: number
  location: string
  sessionCookies: string[] // names of session-ish Set-Cookie entries
  hasErrorMarker: boolean
  hasSuccessMarker: boolean
}

export function blockReason(res: ProbeResponse): string | undefined {
  if (res.status === 403 || res.status === 406 || res.status === 429 || res.status === 503) return `HTTP ${res.status}`
  const server = headerOf(res.headers, "server")
  const body = res.body.slice(0, 4000)
  if ((headerOf(res.headers, "cf-ray") || headerOf(res.headers, "x-sucuri-id") || /cloudflare|sucuri|akamai|incapsula/i.test(server)) && WAF_BODY.test(body))
    return `WAF challenge (${server || "cdn header"})`
  if (WAF_BODY.test(res.body.slice(0, 2000))) return "WAF/challenge page"
  return undefined
}

export function lockoutReason(res: ProbeResponse): string | undefined {
  if (res.status === 429 || res.status === 423) return `HTTP ${res.status}`
  const retry = headerOf(res.headers, "retry-after")
  if (retry) return `Retry-After: ${retry}`
  const m = LOCKOUT_BODY.exec(res.body.slice(0, 8000))
  if (m) return `lockout/throttle marker "${m[0]}"`
  return undefined
}

export function fingerprint(res: ProbeResponse): Fingerprint {
  const body = res.body
  const cookieNames: string[] = []
  for (const k in res.headers) {
    if (k.toLowerCase() !== "set-cookie") continue
    for (const c of splitCookies(res.headers[k])) {
      const name = c.split("=")[0]?.trim() ?? ""
      if (name && SESSION_COOKIE.test(name)) cookieNames.push(name)
    }
  }
  return {
    status: res.status,
    bytes: body.length,
    ms: 0,
    location: headerOf(res.headers, "location"),
    sessionCookies: cookieNames,
    hasErrorMarker: ERROR_BODY.test(body.slice(0, 20000)),
    hasSuccessMarker: SUCCESS_BODY.test(body.slice(0, 20000)),
  }
}

export interface SuccessJudgement {
  looksSuccessful: boolean
  signals: string[]
  strong: boolean
}

// Compare a candidate response to the known-bad baseline. Success needs a real move
// toward "authenticated": a new session cookie, a redirect that leaves the login/error
// page, disappearance of error markers WITH a status change, or an explicit success
// marker. Byte-delta alone is only corroborating, never sufficient.
export function judge(base: Fingerprint, cand: Fingerprint, jitter: number): SuccessJudgement {
  const signals: string[] = []
  let strong = false

  // Hard negative: a 3xx that lands back on the login/error page is a REJECTION, no
  // matter the status delta or an empty (marker-free) redirect body. Decided first so
  // a bodiless "302 → /login?error=1" can never look success-ward.
  const redirectRejected = cand.status >= 300 && cand.status < 400 && isLoginward(cand.location)
  if (redirectRejected) return { looksSuccessful: false, signals: [`redirect to login/error page "${cand.location}" — rejection`], strong: false }

  const newCookie = cand.sessionCookies.filter((c) => !base.sessionCookies.includes(c))
  if (newCookie.length > 0) {
    signals.push(`session cookie set only on this attempt: ${newCookie.join(", ")}`)
    strong = true
  }

  const redirectDiverged =
    cand.location !== base.location && cand.location.length > 0 && !isLoginward(cand.location) && (isLoginward(base.location) || base.location.length === 0)
  if (redirectDiverged) {
    signals.push(`redirect diverged to non-login target "${cand.location}" (baseline → "${base.location || "none"}")`)
    strong = true
  }

  if (cand.hasSuccessMarker && !base.hasSuccessMarker) {
    signals.push("authenticated-page marker (logout/dashboard/…) present only on this attempt")
    strong = true
  }

  const statusToward = cand.status !== base.status && successWard(base.status, cand.status)
  if (statusToward) signals.push(`status moved success-ward ${base.status}→${cand.status}`)

  const errorGone = base.hasErrorMarker && !cand.hasErrorMarker
  if (errorGone) signals.push("login-error marker present in baseline but gone on this attempt")

  if (Math.abs(cand.bytes - base.bytes) > jitter + 24) signals.push(`body size diverged ${base.bytes}→${cand.bytes}B (jitter ${jitter})`)

  const looksSuccessful = strong || (statusToward && errorGone)
  return { looksSuccessful, signals, strong }
}

function isLoginward(location: string): boolean {
  return /login|signin|sign-in|auth|error|denied|fail|logon|account\/login/i.test(location)
}

// A move from a rejecting status to a serving/redirecting one.
function successWard(base: number, cand: number): boolean {
  const rejecting = (s: number) => s === 401 || s === 403 || s === 400 || s === 422 || s === 200 || s === 409
  const serving = (s: number) => s === 302 || s === 303 || s === 301 || s === 200 || s === 204
  if (base === 200 && cand === 200) return false // identical 200s decided by markers, not status
  return rejecting(base) && serving(cand) && base !== cand
}

function headerOf(headers: Record<string, string>, name: string): string {
  const lower = name.toLowerCase()
  for (const k in headers) if (k.toLowerCase() === lower) return headers[k]
  return ""
}

function splitCookies(raw: string): string[] {
  // A joined Set-Cookie header: split on commas that begin a new "name=" cookie.
  return raw.split(/,(?=[^;=]+=)/g).map((s) => s.trim()).filter(Boolean)
}

export namespace LoginProbe {
  const MAX_SPRAY = 40
  const MAX_LOCKOUT = 20

  export interface DefaultCredsInput {
    request: ProbeRequest
    usernameField?: string
    passwordField?: string
    extraCreds?: CredPair[]
    delayMs?: number
  }

  export interface Attempt {
    username: string
    password: string
    note?: string
    status: number | null
    signals: string[]
    looksSuccessful: boolean
    error?: string
  }

  export interface DefaultCredsReport {
    mode: "default-creds"
    loginField: { username: string; password: string; contentType: string }
    csrfSuspected: boolean
    csrfFields: string[]
    baseline: { status: number; bytes: number; location: string; sessionCookies: string[] } | null
    attempted: number
    total: number
    hits: Attempt[]
    attempts: Attempt[]
    stoppedEarly?: string
    note: string
  }

  // WSTG 4.4.2 — spray the embedded battery (+ username-derived + caller extras) and
  // report which pairs LOOK like a valid login against the known-bad baseline.
  export async function defaultCreds(input: DefaultCredsInput, sender: HttpSender): Promise<DefaultCredsReport | { error: string }> {
    const parsed = parseRequest(input.request)
    if (parsed.parseError) return { error: `${parsed.parseError} — pass a login request whose body this tool can read, or set username_field/password_field.` }
    const detected = detectFields(parsed)
    const userField = input.usernameField ?? detected.usernameField
    const passField = input.passwordField ?? detected.passwordField
    if (!userField || !passField)
      return {
        error:
          `Could not identify the login fields (found: [${Object.keys(parsed.fields).join(", ") || "none"}]). ` +
          `Pass username_field and password_field explicitly.`,
      }

    // Known-bad baseline: a credential the server MUST reject, sent twice to measure
    // body jitter. A blocked/failed baseline aborts — we cannot judge anything from it.
    const badPair: CredPair = { username: `zz_${rand()}`, password: `zz_${rand()}` }
    const b1 = await sendPair(sender, input.request, parsed, userField, passField, badPair)
    if ("error" in b1) return { error: `known-bad baseline failed: ${b1.error} — cannot judge logins (NOT evidence of safety).` }
    const blk = blockReason(b1)
    if (blk) return { error: `known-bad baseline BLOCKED (${blk}) — the login is shielded; default-cred spray suppressed (NOT evidence of safety). Escalate agent-side.` }
    const b2 = await sendPair(sender, input.request, parsed, userField, passField, { username: `zz_${rand()}`, password: `zz_${rand()}` })
    const baseFp = fingerprint(b1)
    const jitter = "error" in b2 ? 0 : Math.abs(fingerprint(b2).bytes - baseFp.bytes)

    const battery: CredPair[] = dedupe([
      ...(detected.capturedUsername ? deriveFromUsername(detected.capturedUsername) : []),
      ...DEFAULT_CREDS,
      ...(input.extraCreds ?? []),
    ]).slice(0, MAX_SPRAY)

    const attempts: Attempt[] = []
    let stoppedEarly: string | undefined
    for (const pair of battery) {
      const res = await sendPair(sender, input.request, parsed, userField, passField, pair)
      if ("error" in res) {
        attempts.push({ username: pair.username, password: pair.password, note: pair.note, status: null, signals: [], looksSuccessful: false, error: res.error })
        continue
      }
      // A block or lockout mid-spray: STOP. Continuing burns the account and every
      // further "reject" is meaningless once shielded/locked — report coverage lost.
      const shield = blockReason(res) ?? lockoutReason(res)
      if (shield) {
        stoppedEarly = `stopped after ${attempts.length + 1} attempt(s): ${shield} — remaining ${battery.length - attempts.length - 1} pair(s) NOT tested (shield/lockout tripped, NOT safety).`
        attempts.push({ username: pair.username, password: pair.password, note: pair.note, status: res.status, signals: [`shielded: ${shield}`], looksSuccessful: false })
        break
      }
      const j = judge(baseFp, fingerprint(res), jitter)
      attempts.push({ username: pair.username, password: pair.password, note: pair.note, status: res.status, signals: j.signals, looksSuccessful: j.looksSuccessful })
      if (input.delayMs && input.delayMs > 0) await sleep(input.delayMs)
    }

    const hits = attempts.filter((a) => a.looksSuccessful)
    return {
      mode: "default-creds",
      loginField: { username: userField, password: passField, contentType: parsed.kind },
      csrfSuspected: detected.csrfFields.length > 0,
      csrfFields: detected.csrfFields,
      baseline: { status: baseFp.status, bytes: baseFp.bytes, location: baseFp.location, sessionCookies: baseFp.sessionCookies },
      attempted: attempts.length,
      total: battery.length,
      hits,
      attempts,
      stoppedEarly,
      note:
        (hits.length > 0
          ? `${hits.length} pair(s) LOOK like a valid login — LEADS, confirm each with http_replay (log in for real and check the authed session). `
          : "no default-credential pair looked successful. ") +
        (detected.csrfFields.length > 0
          ? `⚠️ CSRF field(s) [${detected.csrfFields.join(", ")}] present: the captured token was replayed verbatim and may be single-use/stale, so a real login could be rejected here regardless — confirm with a FRESH token via csrf_extract + http_replay before calling this clean. `
          : "") +
        "Observations, not verdicts — this tool never confirms access.",
    }
  }

  export interface LockoutInput {
    request: ProbeRequest
    usernameField?: string
    passwordField?: string
    username?: string
    attempts?: number
    delayMs?: number
  }

  export interface LockoutReport {
    mode: "lockout"
    username: string
    attempts: number
    lockoutAt: number | null // 1-based attempt index where a lockout/throttle first appeared
    lockoutReason?: string
    perAttempt: { n: number; status: number | null; ms: number; reason?: string; error?: string }[]
    latencyEscalation: boolean
    note: string
  }

  // WSTG 4.4.3 — fire N wrong-password logins for ONE account and watch for throttle /
  // lockout / CAPTCHA / latency escalation. Stops the moment a lockout appears (no point
  // hammering a locked account). No signal across N attempts ⇒ weak-lockout LEAD.
  export async function lockout(input: LockoutInput, sender: HttpSender): Promise<LockoutReport | { error: string }> {
    const parsed = parseRequest(input.request)
    if (parsed.parseError) return { error: parsed.parseError }
    const detected = detectFields(parsed)
    const userField = input.usernameField ?? detected.usernameField
    const passField = input.passwordField ?? detected.passwordField
    if (!userField || !passField)
      return { error: `Could not identify login fields (found: [${Object.keys(parsed.fields).join(", ") || "none"}]). Pass username_field and password_field.` }
    const username = input.username ?? detected.capturedUsername
    if (!username) return { error: "No username to test lockout against — pass `username` or use a captured request whose username field is populated." }

    const n = Math.min(Math.max(input.attempts ?? 8, 3), MAX_LOCKOUT)
    const perAttempt: LockoutReport["perAttempt"] = []
    const latencies: number[] = []
    let lockoutAt: number | null = null
    let reason: string | undefined
    for (let i = 1; i <= n; i++) {
      const pair: CredPair = { username, password: `wrong_${rand()}` }
      const t0 = performance.now()
      const res = await sendPair(sender, input.request, parsed, userField, passField, pair)
      const ms = Math.round(performance.now() - t0)
      if ("error" in res) {
        perAttempt.push({ n: i, status: null, ms, error: res.error })
        // A transport drop can itself be a WAF/lockout tarpit — record and stop.
        reason = `transport error on attempt ${i}: ${res.error} (possible tarpit/drop, NOT confirmed safety)`
        lockoutAt = i
        break
      }
      latencies.push(ms)
      const lr = lockoutReason(res) ?? blockReason(res)
      perAttempt.push({ n: i, status: res.status, ms, reason: lr })
      if (lr) {
        lockoutAt = i
        reason = lr
        break
      }
      if (input.delayMs && input.delayMs > 0 && i < n) await sleep(input.delayMs)
    }

    // Latency escalation: the last recorded attempt is >3× the median of the first two.
    const latencyEscalation = latencies.length >= 3 && latencies[latencies.length - 1] > 3 * median(latencies.slice(0, 2))
    const observed = lockoutAt !== null || latencyEscalation
    return {
      mode: "lockout",
      username,
      attempts: perAttempt.length,
      lockoutAt,
      lockoutReason: reason,
      perAttempt,
      latencyEscalation,
      note: observed
        ? `lockout/throttle observed${lockoutAt ? ` at attempt ${lockoutAt}` : ""}${latencyEscalation ? " (latency escalation)" : ""}${reason ? `: ${reason}` : ""} — the control exists; confirm its threshold/duration.`
        : `NO lockout, throttle, CAPTCHA or latency escalation across ${perAttempt.length} failed logins — WSTG 4.4.3 weak-lockout LEAD. Confirm with a larger burst via http_replay, and check for silent IP/device throttling.`,
    }
  }

  async function sendPair(
    sender: HttpSender,
    req: ProbeRequest,
    parsed: ParsedRequest,
    userField: string,
    passField: string,
    pair: CredPair,
  ): Promise<ProbeResponse | { error: string }> {
    return sender.send(renderCredentialRequest(req, parsed, userField, passField, pair))
  }
}

function rand(): string {
  return Math.random().toString(36).slice(2, 10)
}

function dedupe(pairs: CredPair[]): CredPair[] {
  const seen = new Set<string>()
  const out: CredPair[] = []
  for (const p of pairs) {
    const key = `${p.username} ${p.password}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
