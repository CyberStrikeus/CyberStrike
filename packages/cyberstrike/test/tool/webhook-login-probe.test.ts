import { describe, expect, test } from "bun:test"
import { LoginProbe, judge, fingerprint, blockReason, lockoutReason } from "../../src/tool/webhook/authn/login-oracle"
import { parseRequest, detectFields, renderCredentialRequest, DEFAULT_CREDS } from "../../src/tool/webhook/authn/login-creds"
import type { HttpSender, ProbeRequest, ProbeResponse } from "../../src/tool/webhook/authn/probe"

const loginReq = (body = "username=alice&password=x&csrf_token=abc"): ProbeRequest => ({
  method: "POST",
  url: "https://app.example.com/login",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body,
})

function fieldOf(body: string | undefined, name: string): string {
  return new URLSearchParams(body ?? "").get(name) ?? ""
}

describe("login-creds", () => {
  test("parses form fields and detects username/password/csrf", () => {
    const parsed = parseRequest(loginReq())
    expect(parsed.kind).toBe("form")
    const d = detectFields(parsed)
    expect(d.usernameField).toBe("username")
    expect(d.passwordField).toBe("password")
    expect(d.csrfFields).toContain("csrf_token")
    expect(d.capturedUsername).toBe("alice")
  })

  test("renders a credential body preserving other fields (csrf rides along)", () => {
    const parsed = parseRequest(loginReq())
    const req = renderCredentialRequest(loginReq(), parsed, "username", "password", { username: "admin", password: "admin" })
    expect(fieldOf(req.body, "username")).toBe("admin")
    expect(fieldOf(req.body, "password")).toBe("admin")
    expect(fieldOf(req.body, "csrf_token")).toBe("abc") // untouched
  })

  test("json login body: only username/password overwritten, nested fields survive", () => {
    const jsonReq: ProbeRequest = {
      method: "POST",
      url: "https://app.example.com/api/login",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.com", pwd: "x", tenant: "acme" }),
    }
    const parsed = parseRequest(jsonReq)
    expect(parsed.kind).toBe("json")
    const d = detectFields(parsed)
    expect(d.usernameField).toBe("email")
    expect(d.passwordField).toBe("pwd")
    const rendered = renderCredentialRequest(jsonReq, parsed, "email", "pwd", { username: "admin", password: "admin" })
    const obj = JSON.parse(rendered.body ?? "{}")
    expect(obj.email).toBe("admin")
    expect(obj.pwd).toBe("admin")
    expect(obj.tenant).toBe("acme") // preserved
  })
})

describe("oracle unit — judge", () => {
  const base = fingerprint({ status: 200, headers: {}, body: "Invalid username or password" })
  test("a new session cookie is a strong success signal", () => {
    const cand = fingerprint({ status: 302, headers: { "set-cookie": "SESSIONID=abc; HttpOnly", location: "/dashboard" }, body: "" })
    const j = judge(base, cand, 0)
    expect(j.looksSuccessful).toBe(true)
    expect(j.strong).toBe(true)
  })
  test("identical rejecting response is not a success", () => {
    const cand = fingerprint({ status: 200, headers: {}, body: "Invalid username or password" })
    const j = judge(base, cand, 0)
    expect(j.looksSuccessful).toBe(false)
  })
  test("redirect back to /login is NOT a success", () => {
    const cand = fingerprint({ status: 302, headers: { location: "/login?error=1" }, body: "" })
    const j = judge(base, cand, 0)
    expect(j.looksSuccessful).toBe(false)
  })
})

describe("block / lockout detectors", () => {
  test("blockReason flags 403/429 and WAF pages", () => {
    expect(blockReason({ status: 403, headers: {}, body: "" })).toBeDefined()
    expect(blockReason({ status: 200, headers: {}, body: "Attention Required! Cloudflare" })).toBeDefined()
    expect(blockReason({ status: 200, headers: {}, body: "ok" })).toBeUndefined()
  })
  test("lockoutReason flags 429, Retry-After and lockout markers", () => {
    expect(lockoutReason({ status: 429, headers: {}, body: "" })).toBeDefined()
    expect(lockoutReason({ status: 200, headers: { "retry-after": "60" }, body: "" })).toBeDefined()
    expect(lockoutReason({ status: 200, headers: {}, body: "Too many failed attempts, try again later" })).toBeDefined()
    expect(lockoutReason({ status: 200, headers: {}, body: "welcome" })).toBeUndefined()
  })
})

// ── default-creds mode ────────────────────────────────────────────────────────────
describe("LoginProbe.defaultCreds", () => {
  // Vulnerable server: admin/admin logs in (302 + session cookie), everything else 200 with an error.
  function vulnLogin(): HttpSender {
    return {
      async send(req: ProbeRequest): Promise<ProbeResponse> {
        const pw = fieldOf(req.body, "password")
        const user = fieldOf(req.body, "username")
        if (user === "admin" && pw === "admin")
          return { status: 302, headers: { "set-cookie": "SESSIONID=win; Path=/; HttpOnly", location: "/dashboard" }, body: "" }
        return { status: 200, headers: {}, body: "Invalid username or password" }
      },
    }
  }

  test("detects the admin/admin default and reports it as a hit", async () => {
    const report = await LoginProbe.defaultCreds({ request: loginReq() }, vulnLogin())
    if ("error" in report) throw new Error(report.error)
    expect(report.hits.length).toBeGreaterThanOrEqual(1)
    expect(report.hits.some((h) => h.username === "admin" && h.password === "admin")).toBe(true)
    expect(report.csrfSuspected).toBe(true) // csrf_token present → flagged
  })

  test("an always-200 form yields NO false positives (negative control)", async () => {
    const alwaysOk: HttpSender = { async send() { return { status: 200, headers: {}, body: "Login page" } } }
    const report = await LoginProbe.defaultCreds({ request: loginReq() }, alwaysOk)
    if ("error" in report) throw new Error(report.error)
    expect(report.hits).toHaveLength(0)
  })

  test("a blocked baseline aborts with a not-safe message (no silent clean)", async () => {
    const wafd: HttpSender = { async send() { return { status: 403, headers: {}, body: "Access denied" } } }
    const report = await LoginProbe.defaultCreds({ request: loginReq() }, wafd)
    expect("error" in report).toBe(true)
    if ("error" in report) expect(report.error).toMatch(/BLOCKED|NOT evidence of safety/i)
  })

  test("stops the spray the moment a lockout trips mid-run", async () => {
    let n = 0
    const locksAfter2: HttpSender = {
      async send(): Promise<ProbeResponse> {
        n++
        // first two calls are the known-bad baseline pair; then the battery begins
        if (n <= 3) return { status: 200, headers: {}, body: "Invalid" }
        return { status: 429, headers: { "retry-after": "120" }, body: "Too many attempts" }
      },
    }
    const report = await LoginProbe.defaultCreds({ request: loginReq() }, locksAfter2)
    if ("error" in report) throw new Error(report.error)
    expect(report.stoppedEarly).toBeDefined()
    expect(report.attempted).toBeLessThan(report.total)
  })

  test("errors when login fields cannot be identified", async () => {
    const noFields: ProbeRequest = { method: "POST", url: "https://app.example.com/x", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "a=1&b=2" }
    const report = await LoginProbe.defaultCreds({ request: noFields }, { async send() { return { status: 200, headers: {}, body: "" } } })
    expect("error" in report).toBe(true)
  })

  test("battery stays bounded", () => {
    expect(DEFAULT_CREDS.length).toBeLessThanOrEqual(40)
  })
})

// ── lockout mode ──────────────────────────────────────────────────────────────────
describe("LoginProbe.lockout", () => {
  test("no lockout across N attempts ⇒ weak-lockout lead", async () => {
    const noLock: HttpSender = { async send() { return { status: 200, headers: {}, body: "Invalid password" } } }
    const report = await LoginProbe.lockout({ request: loginReq(), attempts: 5 }, noLock)
    if ("error" in report) throw new Error(report.error)
    expect(report.lockoutAt).toBeNull()
    expect(report.attempts).toBe(5)
    expect(report.note).toMatch(/weak-lockout/i)
  })

  test("lockout observed stops early and records the attempt index", async () => {
    let n = 0
    const locks: HttpSender = {
      async send(): Promise<ProbeResponse> {
        n++
        return n >= 3 ? { status: 429, headers: {}, body: "locked" } : { status: 200, headers: {}, body: "Invalid" }
      },
    }
    const report = await LoginProbe.lockout({ request: loginReq(), attempts: 8 }, locks)
    if ("error" in report) throw new Error(report.error)
    expect(report.lockoutAt).toBe(3)
    expect(report.attempts).toBe(3) // stopped early
  })

  test("errors without a username to test", async () => {
    const noUser: ProbeRequest = { method: "POST", url: "https://app.example.com/login", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "username=&password=x" }
    const report = await LoginProbe.lockout({ request: noUser }, { async send() { return { status: 200, headers: {}, body: "" } } })
    expect("error" in report).toBe(true)
  })
})
