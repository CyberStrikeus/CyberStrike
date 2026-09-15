import { describe, expect, test } from "bun:test"
import {
  CanaryRegistry,
  MemoryCanaryStore,
  SignalRouter,
  runDetectors,
  DETECTORS,
  FullPathDisclosureDetector,
  StackTraceDetector,
  SqlErrorDetector,
  DirectoryListingDetector,
  SensitiveDataExposureDetector,
  GraphqlIntrospectionDetector,
  JwtLeakDetector,
  ServerBannerDetector,
  MissingSecurityHeadersDetector,
  CorsMisconfigDetector,
  WeakCookieFlagsDetector,
  OpenRedirectDetector,
  ExposedArtifactDetector,
  TechnologyDetector,
  LlmEndpointDetector,
  TechPlaybook,
} from "../../src/session/web/signal"
import type { Header, ObservedResponse, SignalType } from "../../src/session/web/signal"

// Build an ObservedResponse with sensible defaults; each test overrides what it needs.
function res(over: Partial<ObservedResponse> = {}): ObservedResponse {
  return {
    requestId: over.requestId ?? "req_1",
    url: over.url ?? "https://shop.example.com/",
    method: over.method ?? "GET",
    status: over.status ?? 200,
    headers: over.headers ?? [],
    body: over.body ?? "",
  }
}
const H = (name: string, value: string): Header => ({ name, value })

// ── Detectors: each asserted BOTH ways (fires on vuln, silent on clean) ────────

describe("passive detectors — positive and negative", () => {
  test("full_path_disclosure", () => {
    expect(new FullPathDisclosureDetector().detect(res({ body: "Warning: include(/var/www/html/app/config.php) failed" }))).toHaveLength(1)
    expect(new FullPathDisclosureDetector().detect(res({ body: "GET /var/products ok" }))).toHaveLength(0) // shallow path, not a leak
    expect(new FullPathDisclosureDetector().detect(res({ body: "C:\\inetpub\\wwwroot\\app\\web.config" }))).toHaveLength(1)
  })

  test("stack_trace", () => {
    expect(new StackTraceDetector().detect(res({ body: 'Traceback (most recent call last):\n  File "x.py", line 3' }))).toHaveLength(1)
    expect(new StackTraceDetector().detect(res({ body: "normal page" }))).toHaveLength(0)
  })

  test("sql_error", () => {
    expect(new SqlErrorDetector().detect(res({ body: "You have an error in your SQL syntax; check the manual" }))).toHaveLength(1)
    expect(new SqlErrorDetector().detect(res({ body: "results: 3 rows" }))).toHaveLength(0)
  })

  test("directory_listing", () => {
    expect(new DirectoryListingDetector().detect(res({ body: "<title>Index of /uploads</title>...<a>Parent Directory</a>" }))).toHaveLength(1)
    expect(new DirectoryListingDetector().detect(res({ body: "welcome home" }))).toHaveLength(0)
  })

  test("sensitive_data_exposure", () => {
    expect(new SensitiveDataExposureDetector().detect(res({ body: "key=-----BEGIN RSA PRIVATE KEY-----\nMIIE" }))).toHaveLength(1)
    expect(new SensitiveDataExposureDetector().detect(res({ body: "aws id AKIAIOSFODNN7EXAMPLE here" }))).toHaveLength(1)
    expect(new SensitiveDataExposureDetector().detect(res({ body: "nothing secret" }))).toHaveLength(0)
  })

  test("graphql_introspection", () => {
    const j = [H("content-type", "application/json")]
    expect(new GraphqlIntrospectionDetector().detect(res({ headers: j, body: '{"data":{"__schema":{"queryType":{"name":"Query"}}}}' }))).toHaveLength(1)
    expect(new GraphqlIntrospectionDetector().detect(res({ headers: j, body: '{"data":{"user":1}}' }))).toHaveLength(0)
    // __schema in a non-JSON body must not fire
    expect(new GraphqlIntrospectionDetector().detect(res({ body: "__schema queryType" }))).toHaveLength(0)
  })

  test("jwt_leak", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N"
    expect(new JwtLeakDetector().detect(res({ body: `{"token":"${jwt}"}` }))).toHaveLength(1)
    expect(new JwtLeakDetector().detect(res({ body: '{"token":"abc.def.ghi"}' }))).toHaveLength(0)
  })

  test("server_banner", () => {
    expect(new ServerBannerDetector().detect(res({ headers: [H("Server", "Apache/2.4.49"), H("X-Powered-By", "PHP/8.2.0")] }))).toHaveLength(1)
    expect(new ServerBannerDetector().detect(res({ headers: [H("Content-Type", "text/html")] }))).toHaveLength(0)
  })

  test("missing_security_headers", () => {
    const html = (extra: Header[] = []) => res({ headers: [H("content-type", "text/html"), ...extra], status: 200 })
    expect(new MissingSecurityHeadersDetector().detect(html())).toHaveLength(1)
    const allPresent = html([
      H("content-security-policy", "default-src 'self'"),
      H("strict-transport-security", "max-age=63072000"),
      H("x-frame-options", "DENY"),
      H("x-content-type-options", "nosniff"),
    ])
    expect(new MissingSecurityHeadersDetector().detect(allPresent)).toHaveLength(0)
    // non-HTML response is out of scope
    expect(new MissingSecurityHeadersDetector().detect(res({ headers: [H("content-type", "application/json")] }))).toHaveLength(0)
  })

  test("cors_misconfig", () => {
    expect(new CorsMisconfigDetector().detect(res({ headers: [H("access-control-allow-origin", "*")] }))).toHaveLength(1)
    expect(
      new CorsMisconfigDetector().detect(
        res({ headers: [H("access-control-allow-origin", "https://evil.com"), H("access-control-allow-credentials", "true")] }),
      ),
    ).toHaveLength(1)
    // specific origin without credentials → not flagged
    expect(new CorsMisconfigDetector().detect(res({ headers: [H("access-control-allow-origin", "https://trusted.com")] }))).toHaveLength(0)
    expect(new CorsMisconfigDetector().detect(res({ headers: [] }))).toHaveLength(0)
  })

  test("weak_cookie_flags", () => {
    expect(new WeakCookieFlagsDetector().detect(res({ headers: [H("set-cookie", "SID=abc; Path=/")] }))).toHaveLength(1)
    expect(
      new WeakCookieFlagsDetector().detect(res({ headers: [H("set-cookie", "SID=abc; Path=/; HttpOnly; Secure; SameSite=Lax")] })),
    ).toHaveLength(0)
    expect(new WeakCookieFlagsDetector().detect(res({ headers: [] }))).toHaveLength(0)
  })

  test("open_redirect", () => {
    // 3xx to an off-origin host that is reflected from the request query → fires
    expect(
      new OpenRedirectDetector().detect(
        res({ status: 302, url: "https://shop.example.com/go?next=https://evil.com/x", headers: [H("location", "https://evil.com/x")] }),
      ),
    ).toHaveLength(1)
    // same-origin redirect → not open redirect
    expect(
      new OpenRedirectDetector().detect(
        res({ status: 302, url: "https://shop.example.com/go?next=/home", headers: [H("location", "https://shop.example.com/home")] }),
      ),
    ).toHaveLength(0)
    // off-origin but NOT reflected from the request → not a lead
    expect(
      new OpenRedirectDetector().detect(
        res({ status: 302, url: "https://shop.example.com/logout", headers: [H("location", "https://cdn.other.com/x")] }),
      ),
    ).toHaveLength(0)
  })

  test("exposed_artifact", () => {
    expect(new ExposedArtifactDetector().detect(res({ url: "https://shop.example.com/.git/config", status: 200, body: "[core]" }))).toHaveLength(1)
    expect(new ExposedArtifactDetector().detect(res({ url: "https://shop.example.com/.env", status: 200, body: "SECRET=1" }))).toHaveLength(1)
    // 404 for the artifact → not exposed
    expect(new ExposedArtifactDetector().detect(res({ url: "https://shop.example.com/.env", status: 404, body: "not found" }))).toHaveLength(0)
    // ordinary path → nothing
    expect(new ExposedArtifactDetector().detect(res({ url: "https://shop.example.com/index.html", status: 200, body: "<html>" }))).toHaveLength(0)
  })
})

describe("TechnologyDetector — fingerprint → actionable technology signal", () => {
  const d = new TechnologyDetector()

  test("detects WordPress from body markers, carries the slug in meta.tech", () => {
    const sigs = d.detect(res({ body: '<link href="/wp-content/themes/x/style.css">' }))
    expect(sigs).toHaveLength(1)
    expect(sigs[0].type).toBe("technology")
    expect(sigs[0].owner).toBe("information-gathering")
    expect(sigs[0].meta?.tech).toBe("wordpress")
    expect(sigs[0].meta?.token).toBe("wordpress") // per-tech dedup
  })

  test("detects a stack from a header (X-Powered-By: Express)", () => {
    const sigs = d.detect(res({ headers: [H("X-Powered-By", "Express")] }))
    expect(sigs.map((s) => s.meta?.tech)).toContain("express")
  })

  test("emits one signal per DISTINCT stack on a response", () => {
    const sigs = d.detect(res({ headers: [H("X-AspNet-Version", "4.0.30319")], body: "__NEXT_DATA__ = {}" }))
    const techs = sigs.map((s) => s.meta?.tech).sort()
    expect(techs).toEqual(["aspnet", "nextjs"])
  })

  test("silent on a plain response with no framework markers", () => {
    expect(d.detect(res({ body: "<html><body>hello</body></html>" }))).toHaveLength(0)
  })
})

describe("TechPlaybook — a detected stack maps to concrete test cases", () => {
  test("known slug returns paths + vuln classes + a directive", () => {
    const e = TechPlaybook.get("spring-boot")!
    expect(e.paths).toContain("/actuator/env")
    expect(e.vulnClasses).toContain("spel-injection")
    expect(e.directive.length).toBeGreaterThan(0)
  })

  test("render produces a prompt block for multiple stacks, skips unknowns", () => {
    const block = TechPlaybook.render(["wordpress", "not-a-real-stack", "graphql"])
    expect(block).toContain("WordPress")
    expect(block).toContain("GraphQL")
    expect(block).not.toContain("not-a-real-stack")
  })

  test("slugForLabel maps recon_test labels to playbook slugs", () => {
    expect(TechPlaybook.slugForLabel("Spring Boot")).toBe("spring-boot")
    expect(TechPlaybook.slugForLabel("ASP.NET")).toBe("aspnet")
    expect(TechPlaybook.slugForLabel("Apache")).toBeUndefined() // bare web server → no playbook
  })
})

  test("llm_endpoint — path signature and response-shape signature; silent otherwise", () => {
    const d = new LlmEndpointDetector()
    // Strong path
    expect(d.detect(res({ url: "https://ai.example.com/v1/chat/completions", method: "POST", body: "{}" }))).toHaveLength(1)
    expect(d.detect(res({ url: "https://ai.example.com/v1/messages", method: "POST" }))).toHaveLength(1)
    // Response shape (OpenAI + Anthropic), even on a nondescript path
    expect(d.detect(res({ url: "https://app.example.com/api/x", body: '{"object":"chat.completion","choices":[{"message":{"role":"assistant","content":"hi"}}]}' }))).toHaveLength(1)
    expect(d.detect(res({ url: "https://app.example.com/api/x", body: '{"type":"message","role":"assistant","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn"}' }))).toHaveLength(1)
    // Not an LLM surface
    expect(d.detect(res({ url: "https://shop.example.com/products?id=1", body: '{"items":[]}' }))).toHaveLength(0)
    expect(d.detect(res({ url: "https://shop.example.com/checkout", body: "<html>ok</html>" }))).toHaveLength(0)
  })

  test("llm_endpoint routes to the llm specialist", () => {
    const sigs = new LlmEndpointDetector().detect(res({ url: "https://ai.example.com/v1/chat/completions", method: "POST", body: "{}" }))
    expect(sigs[0].owner).toBe("llm")
    expect(new SignalRouter().ownerOf("llm_endpoint")).toBe("llm")
  })

// ── runDetectors aggregation ───────────────────────────────────────────────────

describe("runDetectors", () => {
  test("aggregates multiple signals from one response", () => {
    const r = res({
      headers: [H("content-type", "text/html"), H("Server", "nginx/1.18"), H("set-cookie", "SID=x; Path=/")],
      status: 200,
      body: "Traceback (most recent call last):\n  File /var/www/app/main.py line 1",
    })
    const types = runDetectors(r).map((s) => s.type).sort()
    // stack_trace + full_path_disclosure + server_banner + missing_security_headers + weak_cookie_flags
    expect(types).toContain("stack_trace")
    expect(types).toContain("full_path_disclosure")
    expect(types).toContain("server_banner")
    expect(types).toContain("missing_security_headers")
    expect(types).toContain("weak_cookie_flags")
  })

  test("clean response yields no signals", () => {
    const r = res({
      headers: [
        H("content-type", "text/html"),
        H("content-security-policy", "default-src 'self'"),
        H("strict-transport-security", "max-age=1"),
        H("x-frame-options", "DENY"),
        H("x-content-type-options", "nosniff"),
      ],
      body: "<html><body>hello</body></html>",
    })
    expect(runDetectors(r)).toHaveLength(0)
  })
})

// ── Canary correlation (stored / second-order reflection) ──────────────────────

describe("CanaryRegistry — stored reflection correlation", () => {
  test("token injected at A, rendered at B → stored_reflection", () => {
    const reg = new CanaryRegistry(new MemoryCanaryStore())
    const c = reg.register({ originRequestId: "req_A", endpoint: "POST /comment", field: "body", agent: "injection", vulnClass: "xss" })
    const signals = reg.scan({ requestId: "req_B", url: "https://shop.example.com/feed", body: `<div>${c.token}</div>` })
    expect(signals).toHaveLength(1)
    expect(signals[0].type).toBe("stored_reflection")
    expect(signals[0].meta?.injectSite).toBe("req_A")
    expect(signals[0].meta?.renderSite).toBe("req_B")
  })

  test("same-site reflection is NOT stored_reflection", () => {
    const reg = new CanaryRegistry(new MemoryCanaryStore())
    const c = reg.register({ originRequestId: "req_A", endpoint: "POST /echo", field: "q", agent: "injection", vulnClass: "xss" })
    expect(reg.scan({ requestId: "req_A", body: `echo: ${c.token}` })).toHaveLength(0)
  })

  test("no hit when token absent; empty body safe", () => {
    const reg = new CanaryRegistry(new MemoryCanaryStore())
    reg.register({ originRequestId: "req_A", endpoint: "x", field: "y", agent: "injection", vulnClass: "xss" })
    expect(reg.scan({ requestId: "req_B", body: "unrelated content" })).toHaveLength(0)
    expect(reg.scan({ requestId: "req_B", body: "" })).toHaveLength(0)
  })

  test("multiple canaries: only the matching non-same-site ones fire", () => {
    const reg = new CanaryRegistry(new MemoryCanaryStore())
    const a = reg.register({ originRequestId: "req_A", endpoint: "e1", field: "f1", agent: "injection", vulnClass: "xss" })
    const b = reg.register({ originRequestId: "req_B", endpoint: "e2", field: "f2", agent: "injection", vulnClass: "xss" })
    const signals = reg.scan({ requestId: "req_C", body: `${a.token} and ${b.token}` })
    expect(signals).toHaveLength(2)
  })

  test("minted tokens are unique and duplicate registration is deduped", () => {
    const store = new MemoryCanaryStore()
    const reg = new CanaryRegistry(store)
    const t1 = reg.register({ originRequestId: "a", endpoint: "e", field: "f", agent: "x", vulnClass: "xss" }).token
    const t2 = reg.register({ originRequestId: "a", endpoint: "e", field: "f", agent: "x", vulnClass: "xss" }).token
    expect(t1).not.toBe(t2)
    // re-registering the SAME explicit token does not duplicate
    reg.register({ token: "csFIXED", originRequestId: "a", endpoint: "e", field: "f", agent: "x", vulnClass: "xss" })
    reg.register({ token: "csFIXED", originRequestId: "b", endpoint: "e", field: "f", agent: "x", vulnClass: "xss" })
    expect(store.all().filter((c) => c.token === "csFIXED")).toHaveLength(1)
  })
})

// ── Router — deterministic + total over SignalType ─────────────────────────────

describe("SignalRouter", () => {
  test("every emittable signal type has exactly one owner", () => {
    const router = new SignalRouter()
    // The union of detector signal types + canary's stored_reflection + reflected_input.
    const emittable: SignalType[] = [...new Set(DETECTORS.map((d) => d.signalType))]
    for (const t of emittable) expect(() => router.ownerOf(t)).not.toThrow()
    // Router table itself is total and self-consistent.
    for (const t of SignalRouter.signalTypes()) expect(typeof router.ownerOf(t)).toBe("string")
  })

  test("route() returns the table owner for a signal", () => {
    const router = new SignalRouter()
    expect(router.route({ type: "sql_error", owner: "input-validation", requestId: "r", evidence: "x" }).specialist).toBe("input-validation")
    expect(router.route({ type: "cors_misconfig", owner: "client-side", requestId: "r", evidence: "x" }).specialist).toBe("client-side")
    expect(router.route({ type: "weak_cookie_flags", owner: "session-management", requestId: "r", evidence: "x" }).specialist).toBe("session-management")
  })

  test("unknown signal type throws (no silent drop)", () => {
    const router = new SignalRouter()
    expect(() => router.ownerOf("does_not_exist" as SignalType)).toThrow()
  })

  test("detector-declared owner agrees with the routing table", () => {
    const router = new SignalRouter()
    for (const d of DETECTORS) expect(router.ownerOf(d.signalType)).toBe(d.owner)
  })

  test("priorityOf is total over every signal type and returns a valid level", () => {
    const router = new SignalRouter()
    const levels = new Set(["high", "medium", "low"])
    for (const t of SignalRouter.signalTypes()) expect(levels.has(router.priorityOf(t))).toBe(true)
    expect(router.priorityOf("sql_error")).toBe("high")
    expect(router.priorityOf("server_banner")).toBe("low")
  })

  test("priorityOf throws on an unknown type", () => {
    expect(() => new SignalRouter().priorityOf("nope" as SignalType)).toThrow()
  })
})
