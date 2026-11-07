import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, techRules } from "../src/index"

const rules = compileRules(techRules)
function tx(over: { respHeaders?: [string, string][]; body?: string; path?: string }): Transaction {
  return {
    id: "t",
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: `https://app.test${over.path ?? "/"}`, headers: [] },
    response: { status: 200, headers: (over.respHeaders ?? []).map(([n, v]) => ({ name: n, value: v })), body: over.body ?? "" },
  }
}
const fired = (t: Transaction) => rules.flatMap((r) => r.evaluate(t)).map((s) => s.ruleId)

describe("technology fingerprint rules — one signal per stack, slug on the ruleId", () => {
  test("body fingerprints", () => {
    expect(fired(tx({ body: "<link href='/wp-content/themes/x/style.css'>" }))).toContain("tech-wordpress")
    expect(fired(tx({ body: "<script>window.__NUXT__={}</script>" }))).toContain("tech-nuxt")
    expect(fired(tx({ body: "<div id='__NEXT_DATA__'>" }))).toContain("tech-nextjs")
    expect(fired(tx({ body: "Whitelabel Error Page — there was an unexpected error" }))).toContain("tech-spring-boot")
    expect(fired(tx({ body: "<input name='csrfmiddlewaretoken' value='x'>" }))).toContain("tech-django")
  })
  test("header fingerprints", () => {
    expect(fired(tx({ respHeaders: [["x-powered-by", "Express"]] }))).toContain("tech-express")
    expect(fired(tx({ respHeaders: [["server", "Microsoft-IIS/10.0"]] }))).toContain("tech-iis")
    expect(fired(tx({ respHeaders: [["server", "Apache-Coyote/1.1"]] }))).toContain("tech-tomcat")
    expect(fired(tx({ respHeaders: [["x-powered-by", "ASP.NET"]] }))).toContain("tech-aspnet")
    // header existence path (x-aspnet-version present, any value)
    expect(fired(tx({ respHeaders: [["x-aspnet-version", "4.0.30319"]] }))).toContain("tech-aspnet")
    expect(fired(tx({ respHeaders: [["x-generator", "WordPress 6.4"]] }))).toContain("tech-wordpress")
  })
  test("graphql via path or body", () => {
    expect(fired(tx({ path: "/graphql" }))).toContain("tech-graphql")
  })
  test("a plain response fingerprints nothing", () => {
    expect(fired(tx({ body: "<html><body>hello</body></html>", respHeaders: [["server", "nginx"]] }))).toHaveLength(0)
  })
  test("the slug is recoverable from the ruleId (tech-<slug>)", () => {
    const ids = fired(tx({ respHeaders: [["x-powered-by", "Express"]] }))
    expect(ids.every((id) => id.startsWith("tech-"))).toBe(true)
  })
})
