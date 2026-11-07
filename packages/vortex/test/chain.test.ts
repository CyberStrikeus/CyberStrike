import { describe, expect, test } from "bun:test"
import type { Transaction, ChainRule } from "../src/index"
import { compileChain, parseChains } from "../src/index"

let n = 0
function req(method: string, url: string, resStatus: number, resBody = "", resCT = "application/json", identity?: string): Transaction {
  return {
    id: `t${n++}`,
    source: "browser",
    host: "app.test",
    identity,
    request: { method, url: `https://app.test${url}`, headers: [] },
    response: { status: resStatus, headers: [{ name: "content-type", value: resCT }], body: resBody },
  }
}

// The chained vuln: a password-reset endpoint LEAKS the reset token in its response body (it should
// only go to email); an attacker then REUSES that exact token to complete a reset (200). Two
// transactions, joined by the shared token — exactly what a single per-tx `when` cannot express.
const resetChain: ChainRule = {
  id: "reset-token-leak-reuse",
  category: "auth-session",
  severity: "critical",
  steps: [
    { as: "leak", when: "resp.body.reset_token" }, // a response carrying a reset_token (truthy = present)
    { as: "use", when: "resp.status == 200", link: [{ field: "req.query.token", to: "leak.resp.body.reset_token" }] },
  ],
  message: "Reset token leaked by {leak.endpoint} was reused at {use.endpoint}",
}

describe("chain rule — multi-step correlation via link (HTTPQL per step)", () => {
  test("detects the leak→reuse chain across two transactions joined by the token", () => {
    const corpus: Transaction[] = [
      req("GET", "/dashboard", 200, "<html>"), // noise
      req("POST", "/api/password/reset-request", 200, JSON.stringify({ reset_token: "TOK123", status: "ok" })), // leak
      req("GET", "/api/users/1", 200, "{}"), // noise
      req("POST", "/api/password/reset?token=TOK123", 200, JSON.stringify({ ok: true })), // reuse of the leaked token
    ]
    const sigs = compileChain(resetChain).evaluate(corpus)
    expect(sigs).toHaveLength(1)
    expect(sigs[0].severity).toBe("critical")
    expect(sigs[0].title).toContain("/api/password/reset-request")
    expect(sigs[0].title).toContain("/api/password/reset")
  })

  test("no signal when the reuse request carries a DIFFERENT (non-leaked) token", () => {
    const corpus: Transaction[] = [
      req("POST", "/api/password/reset-request", 200, JSON.stringify({ reset_token: "TOK123" })),
      req("POST", "/api/password/reset?token=OTHER999", 200, "{}"), // unrelated token → no chain
    ]
    expect(compileChain(resetChain).evaluate(corpus)).toHaveLength(0)
  })

  test("no signal when the token was never leaked (reuse alone is not a chain)", () => {
    const corpus: Transaction[] = [req("POST", "/api/password/reset?token=TOK123", 200, "{}")]
    expect(compileChain(resetChain).evaluate(corpus)).toHaveLength(0)
  })

  test("distinctIdentity: an IDOR chain fires only when the two steps are DIFFERENT identities", () => {
    const idorChain: ChainRule = {
      id: "cross-tenant-object-reuse",
      category: "access-control",
      severity: "high",
      distinctIdentity: true,
      steps: [
        { as: "owner", when: "resp.body.account_id" }, // A's response exposes an account_id (truthy = present)
        { as: "attacker", when: "resp.status == 200", link: [{ field: "req.query.account", to: "owner.resp.body.account_id" }] }, // B accesses it
      ],
      message: "{owner.identity}'s account_id reached by {attacker.identity} at {attacker.endpoint}",
    }
    const org1 = req("GET", "/api/me", 200, JSON.stringify({ account_id: "acc-9" }), "application/json", "org1")
    const org2ok = req("GET", "/api/data?account=acc-9", 200, "{}", "application/json", "org2") // different identity → IDOR
    const org1self = req("GET", "/api/data?account=acc-9", 200, "{}", "application/json", "org1") // same identity → legitimate
    expect(compileChain(idorChain).evaluate([org1, org2ok])).toHaveLength(1)
    expect(compileChain(idorChain).evaluate([org1, org1self])).toHaveLength(0)
  })

  test("VALUE-based 'reuses' link finds the chain WITHOUT knowing the field name (3000-request reality)", () => {
    // The token is called different things on each side (resp field 'x', request header/param) and
    // buried among noise. Value correlation finds it regardless of name — a 32-hex token that
    // appears in a response later appears in a request.
    const TOKEN = "9f8c2a1b7e4d40c3a1b2c3d4e5f6a7b8"
    const generic: ChainRule = {
      id: "response-value-reused-in-request",
      category: "auth-session",
      severity: "high",
      steps: [
        { as: "src", when: "resp.status == 200" },
        { as: "sink", when: "resp.status == 200", reuses: "src" },
      ],
      message: "value {shared} from {src.endpoint} reused in request to {sink.endpoint}",
    }
    const corpus: Transaction[] = [
      req("GET", "/a", 200, JSON.stringify({ csrf: 1, misc: "hello" })), // noise (no correlatable value)
      req("POST", "/api/verify", 200, JSON.stringify({ magic: TOKEN, other: "ok" })), // leaks the token under field 'magic'
      req("GET", "/b", 200, "{}"),
      req("POST", `/api/consume?t=${TOKEN}`, 200, "{}"), // reuses it under a DIFFERENT name 't'
    ]
    const sigs = compileChain(generic).evaluate(corpus)
    expect(sigs).toHaveLength(1)
    expect(sigs[0].title).toContain(TOKEN)
    expect(sigs[0].title).toContain("/api/verify")
    expect(sigs[0].title).toContain("/api/consume")
  })

  test("value correlation ignores short/common values (no coincidental chains)", () => {
    const generic: ChainRule = {
      id: "vr",
      category: "x",
      severity: "low",
      steps: [
        { as: "src", when: "resp.status == 200" },
        { as: "sink", when: "resp.status == 200", reuses: "src" },
      ],
    }
    // both share the value "1" and "ok" — too short/common to be a real dataflow signal
    const corpus: Transaction[] = [req("GET", "/a", 200, JSON.stringify({ page: "1", state: "ok" })), req("GET", "/b?page=1&state=ok", 200, "{}")]
    expect(compileChain(generic).evaluate(corpus)).toHaveLength(0)
  })

  test("parseChains validates an agent's JSON chain rule", () => {
    const parsed = parseChains([resetChain])
    expect(parsed).toHaveLength(1)
    expect(() => parseChains([{ id: "x", category: "c", severity: "high", steps: [{ as: "only" }] }])).toThrow() // needs >=2 steps
  })
})
