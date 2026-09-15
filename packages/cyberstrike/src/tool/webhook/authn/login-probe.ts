// login_probe — default-credential spray (WSTG 4.4.2) + weak-lockout probe (4.4.3).
// The concrete weapon behind web-authentication's 4.4.2/4.4.3 sub-tests: the prompt
// promises "try default creds" and "replay N failed logins for lockout" — this tool
// is what cashes those. The Tool.define is a thin multi-mode shell; the testable
// orchestration is LoginProbe.defaultCreds / LoginProbe.lockout, both taking an
// injected sender (mock in tests, replay engine in production).
import z from "zod"
import { Tool } from "../../tool"
import { webhookContext, toolResult, toolError } from "../define"
import { LoginProbe } from "./login-oracle"
import type { CredPair } from "./login-creds"

const DESCRIPTION = `Probe a captured LOGIN request two ways (WSTG 4.4.2 / 4.4.3). Hands you LEADS, never a verdict — confirm each by logging in for real with http_replay.

mode:
- "default-creds" — spray an embedded battery of common default credentials (admin/admin, root/root, blank passwords, +guesses derived from the captured username) at the login form and report which pairs LOOK like a valid login. Success is judged DIFFERENTIALLY against a known-bad credential (session cookie appears / redirect leaves the login page / error markers vanish / status turns success-ward) with the known-bad as a negative control, so an "always-200" form is not a false positive. Stops immediately if a WAF block or account lockout trips mid-spray (coverage lost is reported, NOT read as safety). A CSRF field is flagged because the captured token is replayed verbatim and may be stale.
- "lockout" — fire N wrong-password logins for ONE account and watch for throttle / lockout / CAPTCHA / latency escalation; stops the moment a lockout appears. No signal across N attempts ⇒ a weak-lockout lead.
- "enumerate" — username/account enumeration. Establishes a "user does not exist" baseline (a random username, wrong password, timing-sampled) and sends each candidate username (from \`usernames\`, else the captured username) with a WRONG password, flagging any whose response DIVERGES from the invalid-user baseline (status / error-marker / body-size / markedly slower = a valid account hitting password hashing). Wrong passwords + one attempt per distinct username ⇒ no account is locked. Leads, not verdicts.

Only the username/password fields are changed; every other field of the captured request (CSRF token, tenant id, redirect target) rides along unchanged. Read-only detection — it never widens scope beyond the login endpoint.`

function parseExtraCreds(raw: string[] | undefined): CredPair[] {
  if (!raw) return []
  const out: CredPair[] = []
  for (const entry of raw) {
    const i = entry.indexOf(":")
    if (i < 0) continue
    out.push({ username: entry.slice(0, i), password: entry.slice(i + 1), note: "caller-supplied" })
  }
  return out
}

export const LoginProbeTool = Tool.define("login_probe", {
  description: DESCRIPTION,
  parameters: z.object({
    mode: z.enum(["default-creds", "lockout", "enumerate"]).describe("Which probe to run."),
    request_id: z.string().describe("Captured LOGIN request (the credential-submit POST) to probe."),
    username_field: z.string().optional().describe("Override the auto-detected username/email field name."),
    password_field: z.string().optional().describe("Override the auto-detected password field name."),
    username: z.string().optional().describe('lockout: the account to hammer (default: the captured request\'s own username value).'),
    usernames: z
      .array(z.string())
      .optional()
      .describe("enumerate: candidate usernames to test for existence (default: the captured request's own username). Each is tried once with a wrong password."),
    attempts: z.number().int().positive().optional().describe("lockout: number of failed logins to fire (default 8, capped 20)."),
    extra_creds: z
      .array(z.string())
      .optional()
      .describe('default-creds: additional "username:password" pairs to append to the embedded battery.'),
    delay_ms: z.number().int().nonnegative().optional().describe("Delay between attempts in milliseconds (gentle spray / avoid self-tripping lockout)."),
  }),
  async execute(params, ctx) {
    const wctx = webhookContext(ctx)
    const NAME = "login_probe"
    const resolved = wctx.resolve(params.request_id)
    if ("error" in resolved) return toolError(NAME, resolved.error)

    if (params.mode === "enumerate") {
      const result = await LoginProbe.enumerate(
        {
          request: resolved,
          usernameField: params.username_field,
          passwordField: params.password_field,
          usernames: params.usernames,
          delayMs: params.delay_ms,
        },
        wctx.sender,
      )
      if ("error" in result) return toolError(NAME, result.error)
      const label = result.leaks.length > 0 ? `${result.leaks.length} username-enumeration lead(s) (verify)` : `no enumeration across ${result.tested} candidate(s)`
      return toolResult(`${NAME} enumerate`, label, result)
    }

    if (params.mode === "lockout") {
      const result = await LoginProbe.lockout(
        {
          request: resolved,
          usernameField: params.username_field,
          passwordField: params.password_field,
          username: params.username,
          attempts: params.attempts,
          delayMs: params.delay_ms,
        },
        wctx.sender,
      )
      if ("error" in result) return toolError(NAME, result.error)
      const label = result.lockoutAt || result.latencyEscalation ? "lockout/throttle observed" : `NO lockout across ${result.attempts} attempts (weak-lockout lead)`
      return toolResult(`${NAME} lockout`, label, result)
    }

    const result = await LoginProbe.defaultCreds(
      {
        request: resolved,
        usernameField: params.username_field,
        passwordField: params.password_field,
        extraCreds: parseExtraCreds(params.extra_creds),
        delayMs: params.delay_ms,
      },
      wctx.sender,
    )
    if ("error" in result) return toolError(NAME, result.error)
    const label = result.hits.length > 0 ? `${result.hits.length} default-cred lead(s) (verify)` : "no default-cred pair looked successful"
    return toolResult(`${NAME} default-creds`, label, result)
  },
})
