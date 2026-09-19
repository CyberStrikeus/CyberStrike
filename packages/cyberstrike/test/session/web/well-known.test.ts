import { beforeEach, describe, expect, test } from "bun:test"
import { WellKnown } from "../../../src/session/web/well-known"
import { DataCollector } from "../../../src/session/web/data-collector"
import { WebScope } from "../../../src/session/web/scope"
import { Crawl } from "../../../src/session/web/crawl"

beforeEach(() => {
  WellKnown._reset()
  DataCollector._reset()
  WebScope._reset()
  Crawl._reset()
})

const TARGET = "https://demo.h.test/"
const SPEC = JSON.stringify({ openapi: "3.0.0", paths: { "/api/users": { get: {} }, "/api/orders/{id}": { get: {} } } })
const ROBOTS = "User-agent: *\nDisallow: /admin/\nDisallow: /private\nDisallow: /\nAllow: /public"
const SITEMAP = "<urlset><url><loc>https://demo.h.test/about</loc></url><url><loc>https://evil.com/x</loc></url></urlset>"

function stub() {
  const pages: Record<string, string> = {
    "https://demo.h.test/swagger/properties.json": SPEC,
    "https://demo.h.test/robots.txt": ROBOTS,
    "https://demo.h.test/sitemap.xml": SITEMAP,
  }
  const emitted: string[] = []
  return {
    emitted,
    fetch: async (u: string) => (u in pages ? pages[u] : null),
    emit: async (_sid: string, method: string, url: string, source: string) => void emitted.push(`${method} ${url} <${source}>`),
  }
}

describe("WellKnown.probe", () => {
  test("discovers spec routes (emitted) + robots/sitemap pages (frontier) + feeds DataCollector; once", async () => {
    const sid = "s"
    WebScope.ensure(sid, TARGET)
    const s = stub()
    const n = await WellKnown.probe(sid, TARGET, { fetch: s.fetch, emit: s.emit })

    // The spec doc itself + its two routes were emitted to ingest.
    expect(n).toBe(3)
    expect(s.emitted).toContain("GET https://demo.h.test/swagger/properties.json <well-known-spec>")
    expect(s.emitted).toContain("GET https://demo.h.test/api/users <openapi>")
    expect(s.emitted).toContain("GET https://demo.h.test/api/orders/{id} <openapi>")

    // Routes also feed the navigator context.
    expect(DataCollector.latest(sid).minedRoutes.map((r) => r.url)).toContain("https://demo.h.test/api/users")

    // robots + sitemap pages went to the frontier (in-scope only — evil.com dropped, "/" skipped).
    const frontier = new Set<string>()
    let u: string | undefined
    while ((u = Crawl.takeFrontier(sid))) frontier.add(u)
    expect(frontier).toContain("https://demo.h.test/about")
    expect(frontier).toContain("https://demo.h.test/admin/")
    expect([...frontier].some((f) => f.includes("evil.com"))).toBe(false)
    expect(frontier).not.toContain("https://demo.h.test/") // Disallow: / is skipped

    // Probed once — a second call is a no-op.
    expect(await WellKnown.probe(sid, TARGET, { fetch: s.fetch, emit: s.emit })).toBe(0)
  })

  test("no specs served → nothing emitted, does not throw", async () => {
    const sid = "s"
    WebScope.ensure(sid, TARGET)
    const n = await WellKnown.probe(sid, TARGET, { fetch: async () => null, emit: async () => {} })
    expect(n).toBe(0)
  })
})

describe("WellKnown.ingestSpec (deterministic correlation of a CAPTURED spec)", () => {
  test("a spec seen in traffic → its routes are enumerated + emitted for scanning (not just flagged)", async () => {
    const sid = "s"
    WebScope.ensure(sid, TARGET)
    const s = stub()
    // The spec came in as a captured/found response — enumerate WITHOUT any agent following up.
    const n = await WellKnown.ingestSpec(sid, "https://demo.h.test/swagger.json", SPEC, { emit: s.emit })
    expect(n).toBe(2)
    expect(s.emitted).toContain("GET https://demo.h.test/api/users <openapi-captured>")
    expect(s.emitted).toContain("GET https://demo.h.test/api/orders/{id} <openapi-captured>")
    expect(DataCollector.latest(sid).minedRoutes.map((r) => r.url)).toContain("https://demo.h.test/api/users")

    // Deduped per spec — the same spec captured again does not re-fan-out.
    expect(await WellKnown.ingestSpec(sid, "https://demo.h.test/swagger.json", SPEC, { emit: s.emit })).toBe(0)
  })

  test("a non-spec response body → no-op (cheap reject, never throws)", async () => {
    const sid = "s"
    WebScope.ensure(sid, TARGET)
    const s = stub()
    expect(await WellKnown.ingestSpec(sid, "https://demo.h.test/app.js", "console.log(1)", { emit: s.emit })).toBe(0)
    expect(s.emitted).toHaveLength(0)
  })
})
