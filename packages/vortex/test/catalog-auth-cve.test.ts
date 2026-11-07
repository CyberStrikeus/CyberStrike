import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, authRules, cveRules } from "../src/index"

const rules = [...compileRules(authRules), ...compileRules(cveRules)]
const fired = (t: Transaction) => rules.flatMap((r) => r.evaluate(t)).map((s) => s.ruleId)
function tx(over: { url?: string; reqHeaders?: [string, string][]; status?: number; respHeaders?: [string, string][]; body?: string }): Transaction {
  return {
    id: "t",
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: `https://app.test${over.url ?? "/x"}`, headers: (over.reqHeaders ?? []).map(([n, v]) => ({ name: n, value: v })) },
    response: { status: over.status ?? 200, headers: (over.respHeaders ?? []).map(([n, v]) => ({ name: n, value: v })), body: over.body ?? "" },
  }
}
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
const jwt = (alg: string) => `${b64u({ alg })}.${b64u({ sub: "admin" })}.sig`

describe("auth catalog", () => {
  test("jwt-alg-none fires on an unsigned bearer (None/NONE too), not on a signed one", () => {
    expect(fired(tx({ url: "/api/me", reqHeaders: [["authorization", `Bearer ${jwt("none")}`]] }))).toContain("jwt-alg-none")
    expect(fired(tx({ url: "/api/me", reqHeaders: [["authorization", `Bearer ${jwt("NONE")}`]] }))).toContain("jwt-alg-none")
    expect(fired(tx({ url: "/api/me", reqHeaders: [["authorization", `Bearer ${jwt("HS256")}`]] }))).not.toContain("jwt-alg-none")
    expect(fired(tx({ url: "/api/me" }))).not.toContain("jwt-alg-none")
  })
  test("secret-in-url fires on a token in the query, not on a benign param", () => {
    expect(fired(tx({ url: "/cb?access_token=abc123&state=x" }))).toContain("secret-in-url")
    expect(fired(tx({ url: "/search?q=hello&page=2" }))).not.toContain("secret-in-url")
  })
})

describe("cve / vulnerable-component catalog", () => {
  test("apache-path-traversal-cve fires only inside the 2.4.49–2.4.50 window on an Apache banner", () => {
    expect(fired(tx({ respHeaders: [["server", "Apache/2.4.49 (Unix)"]] }))).toContain("apache-path-traversal-cve-2021-41773")
    expect(fired(tx({ respHeaders: [["server", "Apache/2.4.50"]] }))).toContain("apache-path-traversal-cve-2021-41773")
    expect(fired(tx({ respHeaders: [["server", "Apache/2.4.52"]] }))).not.toContain("apache-path-traversal-cve-2021-41773") // patched
    expect(fired(tx({ respHeaders: [["server", "Apache/2.4.48"]] }))).not.toContain("apache-path-traversal-cve-2021-41773") // below window
    expect(fired(tx({ respHeaders: [["server", "nginx/2.4.49"]] }))).not.toContain("apache-path-traversal-cve-2021-41773") // not Apache
  })
  test("spring-actuator-exposed fires on the actuator JSON shape at 200", () => {
    expect(fired(tx({ url: "/actuator/env", body: '{"activeProfiles":["prod"],"propertySources":[]}' }))).toContain("spring-actuator-exposed")
    expect(fired(tx({ url: "/actuator/health", status: 404, body: "not found" }))).not.toContain("spring-actuator-exposed")
    expect(fired(tx({ url: "/api/x", body: '{"activeProfiles":[]}' }))).not.toContain("spring-actuator-exposed") // not an /actuator path
  })
})

// Outdated client-side library windows (version in the script URL). A browser fetches every
// <script src> as its own transaction, so these fire on req.url — CDN-hosted or self-hosted alike.
function scriptTx(url: string): Transaction {
  return { id: "t", source: "browser", host: "app.test", request: { method: "GET", url, headers: [] }, response: { status: 200, headers: [], body: "" } }
}
const firedUrl = (url: string) => rules.flatMap((r) => r.evaluate(scriptTx(url))).map((s) => s.ruleId)

describe("outdated client-side library CVEs (version in URL)", () => {
  test("jQuery < 3.5.0 flagged, 3.5.0+ and version-less not", () => {
    expect(firedUrl("https://cdn.jsdelivr.net/npm/jquery@3.4.1/dist/jquery.min.js")).toContain("jquery-xss-cve-2020-11022")
    expect(firedUrl("https://code.jquery.com/jquery-1.12.4.min.js")).toContain("jquery-xss-cve-2020-11022")
    expect(firedUrl("https://code.jquery.com/jquery-3.5.1.min.js")).not.toContain("jquery-xss-cve-2020-11022")
    expect(firedUrl("https://code.jquery.com/jquery.min.js")).not.toContain("jquery-xss-cve-2020-11022") // no version ⇒ no claim
  })
  test("Bootstrap 3.x<3.4.1 and 4.x<4.3.1 windows", () => {
    expect(firedUrl("https://cdn.jsdelivr.net/npm/bootstrap@3.3.7/dist/js/bootstrap.min.js")).toContain("bootstrap-xss-3x")
    expect(firedUrl("https://cdn.jsdelivr.net/npm/bootstrap@4.1.3/dist/js/bootstrap.min.js")).toContain("bootstrap-xss-4x")
    expect(firedUrl("https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.min.js")).not.toContain("bootstrap-xss-4x")
  })
  test("Lodash < 4.17.21", () => {
    expect(firedUrl("https://cdn.jsdelivr.net/npm/lodash@4.17.20/lodash.min.js")).toContain("lodash-proto-pollution")
    expect(firedUrl("https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js")).not.toContain("lodash-proto-pollution")
  })
  test("Moment < 2.29.4", () => {
    expect(firedUrl("https://cdn.jsdelivr.net/npm/moment@2.29.1/moment.min.js")).toContain("moment-redos")
    expect(firedUrl("https://cdn.jsdelivr.net/npm/moment@2.29.4/moment.min.js")).not.toContain("moment-redos")
  })
  test("AngularJS 1.x<1.8.3 flagged; modern @angular not", () => {
    expect(firedUrl("https://ajax.googleapis.com/ajax/libs/angularjs/1.7.9/angular.min.js")).toContain("angularjs-eol-vulns")
    expect(firedUrl("https://cdn.jsdelivr.net/npm/@angular/core@17.0.0/bundles/core.umd.js")).not.toContain("angularjs-eol-vulns")
  })
  test("all outdated-library findings are low-severity vulnerable-component", () => {
    const sigs = rules.flatMap((r) => r.evaluate(scriptTx("https://cdn.jsdelivr.net/npm/jquery@3.4.1/dist/jquery.min.js")))
    const jq = sigs.find((s) => s.ruleId === "jquery-xss-cve-2020-11022")
    expect(jq?.severity).toBe("low")
    expect(jq?.category).toBe("vulnerable-component")
  })
})
