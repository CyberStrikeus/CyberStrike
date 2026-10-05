import { describe, expect, test } from "bun:test"
import { ImpactOracle } from "../../src/inspection/impact-oracle"
import type { Vulnerability } from "../../src/session/vulnerability"
import type { Request } from "../../src/session/request"

// Minimal finding + evidence-response builders — evaluate() is pure over (finding, reqs), no DB.
const F = (title: string, over: Partial<Vulnerability.Info> = {}): Vulnerability.Info =>
  ({ severity: "high", title, description: over.description ?? "", ...over }) as Vulnerability.Info
const R = (status: number, headers: Record<string, string>, origin = "https://app.test", path = "/x"): Request.Info =>
  ({ response_status: status, response_headers: headers, origin, normalized_path: path }) as Request.Info

describe("ImpactOracle.evaluate — open redirect (realized target, not param acceptance)", () => {
  test("PROVEN when a 3xx realizes a redirect to an off-site attacker host", () => {
    const v = ImpactOracle.evaluate(F("Open redirect on /go"), [R(302, { location: "https://evil.com/x" })])
    expect(v.verdict).toBe("proven")
    expect(v.reason).toContain("evil.com")
  })

  test("DOWNGRADE (the #21 shape): realized 302 goes to the intended IdP — not an open redirect", () => {
    const v = ImpactOracle.evaluate(
      F("OAuth redirect to /support/impersonate activates support mode"),
      [R(302, { location: "https://accounts.google.com/o/oauth2/v2/auth?x=1" }, "https://login.example.test", "/api/auth/signin/google")],
    )
    expect(v.verdict).toBe("downgraded")
    expect(v.severity).toBe("low")
  })

  test("DOWNGRADE when the redirect stays on-site (same registrable domain)", () => {
    const v = ImpactOracle.evaluate(F("Open redirect"), [R(302, { location: "https://app.test/dashboard" })])
    expect(v.verdict).toBe("downgraded")
  })

  test("DOWNGRADE when the param is only accepted/stored (no 3xx realized at all)", () => {
    const v = ImpactOracle.evaluate(F("Open redirect via redirectTo param"), [R(200, {})])
    expect(v.verdict).toBe("downgraded")
    expect(v.severity).toBe("low")
  })
})

describe("ImpactOracle.evaluate — XSS (execution, not reflection)", () => {
  test("DOWNGRADE (the #22 shape): reflection/storage without confirmed execution → improper-input-validation low", () => {
    const v = ImpactOracle.evaluate(F("Reflected XSS in q parameter"), [R(200, { "content-type": "text/html" })])
    expect(v.verdict).toBe("downgraded")
    expect(v.severity).toBe("low")
    expect(v.reason).toContain("execution")
  })
})

describe("ImpactOracle.evaluate — auth/IDOR/JWT (access differential required)", () => {
  test("PROVEN when a forged/other identity got 2xx where a baseline was denied 401/403", () => {
    const v = ImpactOracle.evaluate(F("IDOR on /orders/{id}"), [R(200, {}), R(401, {})])
    expect(v.verdict).toBe("proven")
  })

  test("INSUFFICIENT (the #17/#25 shape): token accepted (2xx) but no baseline denial — enforcement may be downstream", () => {
    const v = ImpactOracle.evaluate(
      F("Bootstrap accepts alg:none JWT and sets it as auth cookie", { description: "no signature verification; alg:none accepted" }),
      [R(200, {}), R(200, {})],
    )
    expect(v.verdict).toBe("insufficient")
    expect(v.severity).toBe("low")
  })
})

describe("ImpactOracle.evaluate — unmodeled classes are left untouched", () => {
  test("a config-class finding has no oracle → unmodeled (never downgraded by the gate)", () => {
    const v = ImpactOracle.evaluate(F("Missing security headers on app.test"), [R(200, {})])
    expect(v.verdict).toBe("unmodeled")
  })
})
