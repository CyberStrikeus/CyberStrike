import { describe, test, expect } from "bun:test"
import { ReconProbe } from "../../src/tool/webhook/recon/probe"
import { ReconTest } from "../../src/tool/webhook/recon/recon-test"
import type { HttpSender } from "../../src/tool/webhook/transport"
import { METAFILE_PATHS, FINGERPRINT_PROBES, LEAKAGE_PATTERNS } from "../../src/tool/webhook/recon/wordlists"

function mockSender(responses: Record<string, { status: number; body: string }>): HttpSender {
  return {
    send: async (req) => {
      const path = new URL(req.url).pathname
      const resp = responses[path]
      if (!resp) return { status: 404, headers: {}, body: "Not Found" }
      return { status: resp.status, headers: {}, body: resp.body }
    },
  }
}

describe("wordlists", () => {
  test("METAFILE_PATHS has expected entries", () => {
    expect(METAFILE_PATHS.length).toBeGreaterThanOrEqual(10)
    const paths = METAFILE_PATHS.map((m) => m.path)
    expect(paths).toContain("/robots.txt")
    expect(paths).toContain("/sitemap.xml")
    expect(paths).toContain("/.well-known/security.txt")
    expect(paths).toContain("/openapi.json")
    expect(paths).toContain("/swagger.json")
  })

  test("FINGERPRINT_PROBES covers major technologies", () => {
    const techs = FINGERPRINT_PROBES.map((p) => p.tech)
    expect(techs).toContain("WordPress")
    expect(techs).toContain("Django")
    expect(techs).toContain("Spring Boot")
    expect(techs).toContain("Nginx")
    expect(techs).toContain("Apache")
  })

  test("LEAKAGE_PATTERNS has all expected types", () => {
    expect(LEAKAGE_PATTERNS.html_comment).toBeDefined()
    expect(LEAKAGE_PATTERNS.internal_ip).toBeDefined()
    expect(LEAKAGE_PATTERNS.version_string).toBeDefined()
    expect(LEAKAGE_PATTERNS.todo_fixme).toBeDefined()
    expect(LEAKAGE_PATTERNS.email_address).toBeDefined()
    expect(LEAKAGE_PATTERNS.debug_flag).toBeDefined()
  })
})

describe("ReconProbe.metafiles", () => {
  test("parses robots.txt Disallow paths", async () => {
    const sender = mockSender({
      "/robots.txt": {
        status: 200,
        body: "User-agent: *\nDisallow: /admin/\nDisallow: /api/internal/\nAllow: /public/\nSitemap: https://example.com/sitemap.xml",
      },
    })
    const probe = new ReconProbe(sender)
    const report = await probe.metafiles({ origin: "https://example.com" })

    const robots = report.results.find((r) => r.path === "/robots.txt")
    expect(robots).toBeDefined()
    expect(robots!.found).toBe(true)
    expect(robots!.extractedUrls).toContain("https://example.com/admin/")
    expect(robots!.extractedUrls).toContain("https://example.com/api/internal/")
    expect(robots!.extractedUrls).toContain("https://example.com/sitemap.xml")
  })

  test("parses sitemap.xml loc URLs", async () => {
    const sender = mockSender({
      "/sitemap.xml": {
        status: 200,
        body: `<?xml version="1.0"?><urlset><url><loc>https://example.com/page1</loc></url><url><loc>https://example.com/page2</loc></url></urlset>`,
      },
    })
    const probe = new ReconProbe(sender)
    const report = await probe.metafiles({ origin: "https://example.com" })

    const sitemap = report.results.find((r) => r.path === "/sitemap.xml")
    expect(sitemap!.found).toBe(true)
    expect(sitemap!.extractedUrls).toContain("https://example.com/page1")
    expect(sitemap!.extractedUrls).toContain("https://example.com/page2")
  })

  test("parses JSON URLs from openapi.json", async () => {
    const sender = mockSender({
      "/openapi.json": {
        status: 200,
        body: `{"servers":[{"url":"https://api.example.com/v1"}],"paths":{"/users":{}}}`,
      },
    })
    const probe = new ReconProbe(sender)
    const report = await probe.metafiles({ origin: "https://example.com" })

    const openapi = report.results.find((r) => r.path === "/openapi.json")
    expect(openapi!.found).toBe(true)
    expect(openapi!.extractedUrls).toContain("https://api.example.com/v1")
  })

  test("marks 404 as not found", async () => {
    const sender = mockSender({})
    const probe = new ReconProbe(sender)
    const report = await probe.metafiles({ origin: "https://example.com" })

    for (const r of report.results) {
      expect(r.found).toBe(false)
      expect(r.extractedUrls).toEqual([])
    }
  })

  test("respects limit parameter", async () => {
    const sender = mockSender({})
    const probe = new ReconProbe(sender)
    const report = await probe.metafiles({ origin: "https://example.com", limit: 3 })
    expect(report.results.length).toBe(3)
  })

  test("allUrls deduplicates across files", async () => {
    const sender = mockSender({
      "/robots.txt": { status: 200, body: "Sitemap: https://example.com/sitemap.xml" },
      "/sitemap.xml": { status: 200, body: `<urlset><url><loc>https://example.com/sitemap.xml</loc></url></urlset>` },
    })
    const probe = new ReconProbe(sender)
    const report = await probe.metafiles({ origin: "https://example.com" })
    const dupes = report.allUrls.filter((u) => u === "https://example.com/sitemap.xml")
    expect(dupes.length).toBe(1)
  })

  test("handles transport errors gracefully", async () => {
    const sender: HttpSender = {
      send: async () => ({ error: "ECONNREFUSED" }),
    }
    const probe = new ReconProbe(sender)
    const report = await probe.metafiles({ origin: "https://example.com", limit: 2 })
    for (const r of report.results) {
      expect(r.found).toBe(false)
      expect(r.error).toBe("ECONNREFUSED")
    }
  })
})

describe("ReconProbe.fingerprint", () => {
  test("detects WordPress via wp-login.php", async () => {
    const sender = mockSender({
      "/wp-login.php": { status: 200, body: '<form id="loginform" action="wp-login.php">' },
    })
    const probe = new ReconProbe(sender)
    const report = await probe.fingerprint({ origin: "https://example.com" })
    expect(report.detectedTech).toContain("WordPress")
  })

  test("detects Spring Boot via /actuator/info", async () => {
    const sender = mockSender({
      "/actuator/info": { status: 200, body: '{"app":{"name":"myservice"},"build":{"version":"1.0"}}' },
    })
    const probe = new ReconProbe(sender)
    const report = await probe.fingerprint({ origin: "https://example.com" })
    expect(report.detectedTech).toContain("Spring Boot")
  })

  test("no false positives on 404 pages", async () => {
    const sender = mockSender({})
    const probe = new ReconProbe(sender)
    const report = await probe.fingerprint({ origin: "https://example.com" })
    expect(report.detectedTech).toEqual([])
    for (const r of report.results) {
      expect(r.detected).toBe(false)
    }
  })

  test("no detection when status is 200 but evidence doesn't match", async () => {
    const sender = mockSender({
      "/wp-login.php": { status: 200, body: "Generic custom error page" },
    })
    const probe = new ReconProbe(sender)
    const report = await probe.fingerprint({ origin: "https://example.com" })
    expect(report.detectedTech).not.toContain("WordPress")
  })

  test("respects limit parameter", async () => {
    const sender = mockSender({})
    const probe = new ReconProbe(sender)
    const report = await probe.fingerprint({ origin: "https://example.com", limit: 2 })
    expect(report.results.length).toBe(2)
  })
})

describe("ReconProbe.leakage", () => {
  test("finds HTML comments with content", () => {
    const probe = new ReconProbe(mockSender({}))
    const report = probe.leakage({
      url: "https://example.com",
      body: '<html><!-- TODO: remove debug endpoint /admin/debug --><body>Hello</body></html>',
    })
    expect(report.comments.length).toBe(1)
    expect(report.comments[0]).toContain("debug endpoint")
  })

  test("skips empty HTML comments", () => {
    const probe = new ReconProbe(mockSender({}))
    const report = probe.leakage({
      url: "https://example.com",
      body: "<html><!-- --><body></body></html>",
    })
    expect(report.comments.length).toBe(0)
  })

  test("detects internal IP addresses", () => {
    const probe = new ReconProbe(mockSender({}))
    const report = probe.leakage({
      url: "https://example.com",
      body: "<html><body>Backend: 10.0.1.42 and 192.168.1.100</body></html>",
    })
    const ips = report.findings.filter((f) => f.type === "internal_ip")
    expect(ips.length).toBe(2)
    expect(ips.map((f) => f.value)).toContain("10.0.1.42")
    expect(ips.map((f) => f.value)).toContain("192.168.1.100")
  })

  test("detects version strings", () => {
    const probe = new ReconProbe(mockSender({}))
    const report = probe.leakage({
      url: "https://example.com",
      body: "<html><body>Powered by version 3.2.1</body></html>",
    })
    const versions = report.findings.filter((f) => f.type === "version_string")
    expect(versions.length).toBeGreaterThan(0)
  })

  test("detects email addresses", () => {
    const probe = new ReconProbe(mockSender({}))
    const report = probe.leakage({
      url: "https://example.com",
      body: "<html><body>Contact admin@internal.corp for support</body></html>",
    })
    const emails = report.findings.filter((f) => f.type === "email_address")
    expect(emails.length).toBe(1)
    expect(emails[0]!.value).toContain("admin@internal.corp")
  })

  test("detects debug flags", () => {
    const probe = new ReconProbe(mockSender({}))
    const report = probe.leakage({
      url: "https://example.com",
      body: '<html><body><script>var debug = true;</script></body></html>',
    })
    const flags = report.findings.filter((f) => f.type === "debug_flag")
    expect(flags.length).toBe(1)
  })

  test("detects TODO/FIXME comments in body", () => {
    const probe = new ReconProbe(mockSender({}))
    const report = probe.leakage({
      url: "https://example.com",
      body: "<p>TODO: fix auth bypass on /admin endpoint</p>\n<p>FIXME: remove hardcoded password</p>",
    })
    const todos = report.findings.filter((f) => f.type === "todo_fixme")
    expect(todos.length).toBe(2)
  })

  test("limits findings to 50", () => {
    const probe = new ReconProbe(mockSender({}))
    const ips = Array.from({ length: 60 }, (_, i) => `10.0.0.${i + 1}`).join(" ")
    const report = probe.leakage({ url: "https://example.com", body: ips })
    expect(report.findings.length).toBeLessThanOrEqual(50)
  })
})

describe("ReconTest.run integration", () => {
  test("metafiles mode returns structured result", async () => {
    const sender = mockSender({
      "/robots.txt": { status: 200, body: "Disallow: /secret/" },
    })
    const result = await ReconTest.run({ mode: "metafiles", origin: "https://example.com" }, sender)
    expect(result.mode).toBe("metafiles")
    const r = result as ReconTest.MetafilesResult
    expect(r.report.origin).toBe("https://example.com")
    expect(r.report.results.length).toBeGreaterThan(0)
  })

  test("fingerprint mode returns structured result", async () => {
    const sender = mockSender({})
    const result = await ReconTest.run({ mode: "fingerprint", origin: "https://example.com" }, sender)
    expect(result.mode).toBe("fingerprint")
    const r = result as ReconTest.FingerprintResult
    expect(r.report.origin).toBe("https://example.com")
  })

  test("leakage mode returns structured result", async () => {
    const sender = mockSender({})
    const result = await ReconTest.run(
      { mode: "leakage", url: "https://example.com", body: "<!-- secret: admin123 -->" },
      sender,
    )
    expect(result.mode).toBe("leakage")
    const r = result as ReconTest.LeakageResult
    expect(r.report.comments.length).toBe(1)
  })
})
