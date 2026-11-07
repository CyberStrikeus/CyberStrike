import { describe, expect, test } from "bun:test"
import { MisconfigProbe } from "../../src/tool/webhook/misconfig/probe"
import { MisconfigTest } from "../../src/tool/webhook/misconfig/misconfig-test"
import type { HttpSender, ProbeRequest } from "../../src/tool/webhook/transport"

const baseReq = (): ProbeRequest => ({
  method: "GET",
  url: "https://app.example.com/api/users",
  headers: {},
})

// A server where /.env returns 200 and /admin returns 403 (both "interesting"),
// everything else returns 404.
function leakyServer(): HttpSender {
  return {
    async send(req) {
      const path = new URL(req.url).pathname
      if (path === "/.env") return { status: 200, headers: {}, body: "DB_PASSWORD=secret123\nAPI_KEY=sk-abc" }
      if (path === "/admin" || path === "/admin/") return { status: 403, headers: {}, body: "Forbidden" }
      if (path === "/phpinfo.php") return { status: 200, headers: {}, body: "<html>phpinfo()</html>" }
      return { status: 404, headers: {}, body: "Not Found" }
    },
  }
}

// A server that allows TRACE and PUT.
function methodServer(): HttpSender {
  return {
    async send(req) {
      const h: Record<string, string> = {}
      if (req.method === "TRACE") return { status: 200, headers: h, body: `TRACE / HTTP/1.1\r\nHost: ${new URL(req.url).host}` }
      if (req.method === "PUT") return { status: 200, headers: h, body: '{"updated":true}' }
      if (req.method === "DELETE") return { status: 200, headers: h, body: '{"deleted":true}' }
      if (req.method === "OPTIONS") return { status: 200, headers: { Allow: "GET,POST,PUT,DELETE,TRACE,OPTIONS" } as Record<string, string>, body: "" }
      return { status: 405, headers: h, body: "Method Not Allowed" }
    },
  }
}

// A server with a vulnerable CORS config: reflects any Origin + credentials.
function corsServer(): HttpSender {
  return {
    async send(req) {
      const origin = req.headers["Origin"] ?? req.headers["origin"]
      const headers: Record<string, string> = {}
      if (origin && origin !== "null") {
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
      }
      return { status: 200, headers, body: '{"data":"sensitive"}' }
    },
  }
}

// A server with safe CORS: no reflection.
function safeCorsServer(): HttpSender {
  return {
    async send() {
      return { status: 200, headers: {}, body: '{"ok":true}' }
    },
  }
}

describe("MisconfigProbe.paths", () => {
  test("flags .env (200) and /admin (403) as interesting, ignores 404s", async () => {
    const probe = new MisconfigProbe(leakyServer())
    // No limit — scan all categories to ensure both admin and sensitive_file are hit.
    const report = await probe.paths({ origin: "https://app.example.com" })

    expect(report.baselineStatus).toBe(404)
    const found = report.interesting.map((r) => r.path)
    expect(found).toContain("/.env")
    expect(found).toContain("/admin")
    expect(found).toContain("/phpinfo.php")
    // 404 paths should NOT appear in interesting
    expect(report.results.filter((r) => r.status === 404).every((r) => !r.interesting)).toBe(true)
  })

  test("categories filter restricts the probe set", async () => {
    const probe = new MisconfigProbe(leakyServer())
    const report = await probe.paths({ origin: "https://app.example.com", categories: ["sensitive_file"], limit: 10 })

    expect(report.results.every((r) => r.category === "sensitive_file")).toBe(true)
  })

  test("transport error on a path is captured, not thrown", async () => {
    const flaky: HttpSender = {
      async send(req) {
        return new URL(req.url).pathname === "/.env" ? { error: "reset" } : { status: 404, headers: {}, body: "nf" }
      },
    }
    const report = await new MisconfigProbe(flaky).paths({ origin: "https://x.com", categories: ["sensitive_file"], limit: 5 })
    const errResult = report.results.find((r) => r.error === "reset")
    expect(errResult).toBeDefined()
    expect(errResult!.interesting).toBe(false)
  })
})

describe("MisconfigProbe.methods", () => {
  test("flags TRACE, PUT, DELETE as allowed; 405 methods as not", async () => {
    const probe = new MisconfigProbe(methodServer())
    const report = await probe.methods({ request: baseReq() })

    expect(report.allowedMethods).toContain("TRACE")
    expect(report.allowedMethods).toContain("PUT")
    expect(report.allowedMethods).toContain("DELETE")
    expect(report.allowedMethods).toContain("OPTIONS")
    expect(report.allowedMethods).not.toContain("PROPFIND")
    expect(report.results.find((r) => r.method === "PROPFIND")!.allowed).toBe(false)
  })

  test("handles transport error on a method", async () => {
    const flaky: HttpSender = {
      async send(req) {
        return req.method === "TRACE" ? { error: "blocked" } : { status: 405, headers: {}, body: "" }
      },
    }
    const report = await new MisconfigProbe(flaky).methods({ request: baseReq() })
    expect(report.results.find((r) => r.method === "TRACE")!.error).toBe("blocked")
    expect(report.allowedMethods).not.toContain("TRACE")
  })
})

describe("MisconfigProbe.cors", () => {
  test("flags reflected origin + credentials as vulnerable", async () => {
    const probe = new MisconfigProbe(corsServer())
    const report = await probe.cors({ request: baseReq() })

    expect(report.vulnerable.length).toBeGreaterThan(0)
    const evil = report.results.find((r) => r.origin === "https://evil.com")!
    expect(evil.reflected).toBe(true)
    expect(evil.acac).toBe(true)
  })

  test("no false positive on safe CORS", async () => {
    const probe = new MisconfigProbe(safeCorsServer())
    const report = await probe.cors({ request: baseReq() })

    expect(report.vulnerable).toHaveLength(0)
    for (const r of report.results) {
      expect(r.reflected).toBe(false)
    }
  })

  test("uses custom origins when provided", async () => {
    const probe = new MisconfigProbe(corsServer())
    const report = await probe.cors({ request: baseReq(), origins: ["https://attacker.test"] })

    expect(report.results).toHaveLength(1)
    expect(report.results[0].origin).toBe("https://attacker.test")
  })
})

// A server that only sets HSTS (short, no includeSubDomains) and discloses its stack; missing
// CSP / X-Frame-Options / nosniff / Referrer-Policy / Permissions-Policy.
function weakHeaderServer(): HttpSender {
  return {
    async send() {
      return {
        status: 200,
        headers: {
          "Strict-Transport-Security": "max-age=3600",
          Server: "nginx/1.18.0",
          "X-Powered-By": "PHP/8.1.2",
        },
        body: "ok",
      }
    },
  }
}

// A fully-hardened server: all headers present and strong, no disclosure.
function hardenedServer(): HttpSender {
  return {
    async send() {
      return {
        status: 200,
        headers: {
          "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
          "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Permissions-Policy": "geolocation=()",
        },
        body: "ok",
      }
    },
  }
}

describe("MisconfigProbe.headers", () => {
  test("flags weak HSTS, missing CSP/XFO/nosniff/referrer/permissions, and version disclosure", async () => {
    const report = await new MisconfigProbe(weakHeaderServer()).headers({ request: baseReq() })
    const headers = report.issues.map((i) => i.header)
    // HSTS present but weak (short max-age + no includeSubDomains)
    expect(report.issues.filter((i) => i.header === "Strict-Transport-Security" && i.issue === "weak").length).toBe(2)
    expect(headers).toContain("Content-Security-Policy")
    expect(headers).toContain("X-Frame-Options")
    expect(headers).toContain("X-Content-Type-Options")
    expect(headers).toContain("Referrer-Policy")
    expect(headers).toContain("Permissions-Policy")
    // version disclosure
    expect(report.issues.some((i) => i.header === "Server" && i.issue === "disclosure")).toBe(true)
    expect(report.issues.some((i) => i.header === "X-Powered-By" && i.issue === "disclosure")).toBe(true)
  })

  test("a fully-hardened response yields no issues", async () => {
    const report = await new MisconfigProbe(hardenedServer()).headers({ request: baseReq() })
    expect(report.issues).toEqual([])
  })

  test("transport error yields an empty, non-throwing report", async () => {
    const flaky: HttpSender = { async send() { return { error: "connection refused" } } }
    const report = await new MisconfigProbe(flaky).headers({ request: baseReq() })
    expect(report.status).toBeNull()
    expect(report.issues).toEqual([])
  })
})

describe("MisconfigTest.run", () => {
  test("paths mode dispatches correctly", async () => {
    const result = await MisconfigTest.run(
      { mode: "paths", origin: "https://app.example.com", categories: ["sensitive_file"], limit: 10 },
      leakyServer(),
    )
    expect(result.mode).toBe("paths")
    if (result.mode !== "paths") throw new Error("expected paths mode")
    expect(result.report.results.length).toBe(10)
    expect(result.report.interesting.some((r) => r.path === "/.env")).toBe(true)
  })

  test("methods mode dispatches correctly", async () => {
    const result = await MisconfigTest.run(
      { mode: "methods", request: baseReq() },
      methodServer(),
    )
    expect(result.mode).toBe("methods")
    if (result.mode !== "methods") throw new Error("expected methods mode")
    expect(result.report.allowedMethods).toContain("TRACE")
  })

  test("cors mode dispatches correctly", async () => {
    const result = await MisconfigTest.run(
      { mode: "cors", request: baseReq() },
      corsServer(),
    )
    expect(result.mode).toBe("cors")
    if (result.mode !== "cors") throw new Error("expected cors mode")
    expect(result.report.vulnerable.length).toBeGreaterThan(0)
  })
})
