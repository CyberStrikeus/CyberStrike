import { describe, expect, test } from "bun:test"
import type { Transaction, TokenRef } from "../src/index"
import { replaySafety, isAuthStale, ReplayUnsafeError, send, Engine } from "../src/index"

const enc = new TextEncoder()
// Echo transport: reflect the serialized request back, so mutations are observable end-to-end.
const echo = async (req: Engine.HttpMessage.Request): Promise<Engine.ReplayResponse.Result> => ({
  response: { version: "HTTP/1.1", status: 200, reason: "OK", headers: [], body: enc.encode(new TextDecoder().decode(Engine.HttpMessage.serialize(req))) },
  timing: { totalMs: 1 },
})

function tx(over: Partial<Transaction["request"]> & { method?: string }, response?: Transaction["response"]): Transaction {
  return { id: "t", source: "browser", host: "app.test", request: { method: over.method ?? "GET", url: over.url ?? "https://app.test/x", headers: over.headers ?? [], body: over.body }, response }
}

describe("replaySafety — the do-not-replay guard (don't burn the live session)", () => {
  test("auth-exchange endpoints are unsafe", () => {
    expect(replaySafety(tx({ method: "POST", url: "https://app.test/oauth/token" })).safe).toBe(false)
    expect(replaySafety(tx({ url: "https://app.test/api/login" })).safe).toBe(false)
    expect(replaySafety(tx({ url: "https://app.test/auth/refresh" })).safe).toBe(false)
  })
  test("a response that minted a session cookie is unsafe", () => {
    const rs = replaySafety(tx({ method: "POST", url: "https://app.test/api/do" }, { status: 200, headers: [{ name: "set-cookie", value: "JSESSIONID=abc; HttpOnly" }], body: "" }))
    expect(rs.safe).toBe(false)
    expect(rs.reason).toContain("session cookie")
  })
  test("OAuth code on a callback is a hard single-use token", () => {
    const rs = replaySafety(tx({ url: "https://app.test/callback?code=abc123&state=xyz" }))
    expect(rs.safe).toBe(false)
    expect(rs.singleUse.map((s) => s.kind)).toContain("oauth-code")
  })
  test("bare 'code' off an auth endpoint is NOT treated as an OAuth code (coupon/product code)", () => {
    const rs = replaySafety(tx({ url: "https://app.test/api/coupons?code=SUMMER" }))
    expect(rs.safe).toBe(true)
    expect(rs.singleUse).toHaveLength(0)
  })
  test("a CSRF token is advisory: safe to replay, but listed for fresh substitution", () => {
    const rs = replaySafety(tx({ method: "POST", url: "https://app.test/api/orders", headers: [{ name: "content-type", value: "application/json" }], body: JSON.stringify({ _csrf: "OLD", qty: 1 }) }))
    expect(rs.safe).toBe(true) // no auth endpoint, no session mint
    expect(rs.singleUse).toEqual([{ name: "_csrf", in: "body", kind: "csrf" }])
  })
  test("a plain read is safe with no single-use tokens", () => {
    expect(replaySafety(tx({ url: "https://app.test/api/users/42" }))).toEqual({ safe: true, reason: undefined, singleUse: [] })
  })
})

describe("send() honours the guard + fresh-token resolver", () => {
  test("refuses to replay an unsafe captured request, unless allowUnsafeReplay", async () => {
    const t = tx({ method: "POST", url: "https://app.test/oauth/token", body: "grant_type=authorization_code" }, { status: 200, headers: [], body: "" })
    await expect(send(t, { transport: echo })).rejects.toBeInstanceOf(ReplayUnsafeError)
    const r = await send(t, { allowUnsafeReplay: true, transport: echo })
    expect(r.result.response?.status).toBe(200)
  })
  test("resolveToken substitutes a FRESH value for the stale captured token", async () => {
    const t = tx({ method: "POST", url: "https://app.test/api/orders", headers: [{ name: "content-type", value: "application/json" }], body: JSON.stringify({ _csrf: "OLD", qty: 1 }) })
    const r = await send(t, { resolveToken: (tok: TokenRef) => (tok.name === "_csrf" ? "FRESH" : undefined), transport: echo })
    expect(r.transaction.request.body).toContain("FRESH")
    expect(r.transaction.request.body).not.toContain("OLD")
  })
  test("a freshly-built request (no capture) is never guarded", async () => {
    const r = await send({ method: "POST", url: "https://app.test/oauth/token" }, { transport: echo }) // spec, not a captured tx
    expect(r.result.response?.status).toBe(200)
  })
})

describe("isAuthStale — the benign 'session expired, refresh me' signal", () => {
  test("401 and login-redirects are stale; 200 is not", () => {
    expect(isAuthStale(tx({}, { status: 401, headers: [], body: "" }))).toBe(true)
    expect(isAuthStale(tx({}, { status: 302, headers: [{ name: "location", value: "https://app.test/login?next=/x" }], body: "" }))).toBe(true)
    expect(isAuthStale(tx({}, { status: 200, headers: [], body: "ok" }))).toBe(false)
  })
})
