import { beforeEach, describe, expect, test } from "bun:test"
import { JsMiner } from "../../../src/session/web/js-miner"
import { DataCollector } from "../../../src/session/web/data-collector"
import { WebScope } from "../../../src/session/web/scope"

beforeEach(() => {
  JsMiner._reset()
  DataCollector._reset()
  WebScope._reset()
})

const ORIGIN = "https://app.test"
// Register a collected JS url the way ingest would (content-type → js → jsUrls).
function collectJs(sid: string, origin: string, path: string) {
  DataCollector.record(sid, { method: "GET", origin, path, contentType: "application/javascript" })
}
const minedKeys = (sid: string) => DataCollector.latest(sid).minedRoutes.map((r) => `${r.method} ${r.url}`)
const secretTypes = (sid: string) => DataCollector.latest(sid).secrets.map((s) => s.type)
// A stub fetcher backed by a url→text map, counting how many times each url is fetched.
function fetcherFor(pages: Record<string, string>): { fetch: (url: string) => Promise<string | null>; calls: Record<string, number> } {
  const calls: Record<string, number> = {}
  return {
    calls,
    fetch: async (url: string) => {
      calls[url] = (calls[url] ?? 0) + 1
      return url in pages ? pages[url] : null
    },
  }
}
const AWS_KEY = "AKIA" + "A".repeat(16) // synthetic, format-only

describe("JsMiner.mineNew", () => {
  test("fetches collected JS, mines routes, records them into DataCollector", async () => {
    const sid = "s"
    WebScope.ensure(sid, ORIGIN + "/")
    collectJs(sid, ORIGIN, "/static/app.js")
    const fetcher = async (url: string) => (url.endsWith("app.js") ? `api.get("/api/users"); fetch("/api/orders")` : null)

    const n = await JsMiner.mineNew(sid, fetcher)
    expect(n).toBe(2)
    expect(minedKeys(sid).sort()).toEqual(["GET https://app.test/api/orders", "GET https://app.test/api/users"])
  })

  test("fetch-once: a second pass does not re-fetch an already-mined bundle", async () => {
    const sid = "s"
    WebScope.ensure(sid, ORIGIN + "/")
    collectJs(sid, ORIGIN, "/app.js")
    let fetches = 0
    const fetcher = async () => {
      fetches++
      return `fetch("/api/x")`
    }
    await JsMiner.mineNew(sid, fetcher)
    const second = await JsMiner.mineNew(sid, fetcher)
    expect(fetches).toBe(1)
    expect(second).toBe(0)
  })

  test("skips out-of-scope JS URLs", async () => {
    const sid = "s"
    WebScope.ensure(sid, ORIGIN + "/") // scope = app.test
    collectJs(sid, "https://cdn.evil.com", "/tracker.js")
    let fetched = false
    await JsMiner.mineNew(sid, async () => {
      fetched = true
      return `fetch("/api/x")`
    })
    expect(fetched).toBe(false)
    expect(minedKeys(sid)).toEqual([])
  })

  test("mined routes are scope-filtered too (a bundle that references an external API)", async () => {
    const sid = "s"
    WebScope.ensure(sid, ORIGIN + "/")
    collectJs(sid, ORIGIN, "/app.js")
    await JsMiner.mineNew(sid, async () => `fetch("https://app.test/api/in"); fetch("https://third.party/api/out")`)
    expect(minedKeys(sid)).toEqual(["GET https://app.test/api/in"])
  })

  test("a failed / empty fetch mines nothing and does not throw", async () => {
    const sid = "s"
    WebScope.ensure(sid, ORIGIN + "/")
    collectJs(sid, ORIGIN, "/broken.js")
    const n = await JsMiner.mineNew(sid, async () => null)
    expect(n).toBe(0)
    expect(minedKeys(sid)).toEqual([])
  })

  test("scans fetched bundles for secrets and records them (redacted)", async () => {
    const sid = "s"
    WebScope.ensure(sid, ORIGIN + "/")
    collectJs(sid, ORIGIN, "/app.js")
    await JsMiner.mineNew(sid, async () => `const cfg = { key: "${AWS_KEY}" }; fetch("/api/x")`)
    expect(secretTypes(sid)).toContain("aws-access-key-id")
    const sec = DataCollector.latest(sid).secrets[0]
    expect(sec.preview).not.toContain(AWS_KEY) // redacted
    expect(sec.source).toBe("https://app.test/app.js")
  })

  test("follows an external source map and mines its original source (routes + secrets), fetch-once", async () => {
    const sid = "s"
    WebScope.ensure(sid, ORIGIN + "/")
    collectJs(sid, ORIGIN, "/app.js")
    const mapJson = JSON.stringify({ sources: ["src/api.ts"], sourcesContent: [`api.get("/api/frommap"); const k = "${AWS_KEY}"`] })
    const f = fetcherFor({
      "https://app.test/app.js": `console.log(1)\n//# sourceMappingURL=app.js.map`,
      "https://app.test/app.js.map": mapJson,
    })
    await JsMiner.mineNew(sid, f.fetch)
    expect(minedKeys(sid)).toContain("GET https://app.test/api/frommap")
    expect(secretTypes(sid)).toContain("aws-access-key-id")
    // A second pass re-fetches neither the bundle nor its map.
    await JsMiner.mineNew(sid, f.fetch)
    expect(f.calls["https://app.test/app.js.map"]).toBe(1)
  })

  test("decodes an INLINE source map without a second fetch", async () => {
    const sid = "s"
    WebScope.ensure(sid, ORIGIN + "/")
    collectJs(sid, ORIGIN, "/app.js")
    const mapJson = JSON.stringify({ sources: ["s"], sourcesContent: [`fetch("/api/inline")`] })
    const b64 = Buffer.from(mapJson, "utf8").toString("base64")
    const f = fetcherFor({ "https://app.test/app.js": `x\n//# sourceMappingURL=data:application/json;base64,${b64}` })
    await JsMiner.mineNew(sid, f.fetch)
    expect(minedKeys(sid)).toContain("GET https://app.test/api/inline")
    expect(Object.keys(f.calls)).toEqual(["https://app.test/app.js"]) // only the bundle was fetched
  })

  test("a concurrent pass is a no-op (inflight guard)", async () => {
    const sid = "s"
    WebScope.ensure(sid, ORIGIN + "/")
    collectJs(sid, ORIGIN, "/app.js")
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const slow = async () => {
      await gate
      return `fetch("/api/y")`
    }
    const p1 = JsMiner.mineNew(sid, slow) // starts, marks inflight, blocks on gate
    const during = await JsMiner.mineNew(sid, slow) // inflight → immediate 0
    expect(during).toBe(0)
    release()
    expect(await p1).toBe(1)
  })
})

describe("JsMiner — recursive chunk following (Phase 2)", () => {
  test("mineAll follows a chunk reference to a second bundle and mines ITS endpoints", async () => {
    const sid = "s-rec"
    WebScope.ensure(sid, "https://app.test/")
    collectJs(sid, "https://app.test", "/main.js")
    // main.js references a lazy chunk; the chunk carries the real API route.
    const pages: Record<string, string> = {
      "https://app.test/main.js": `import("./feature.deed.js"); api.get("/api/health")`,
      "https://app.test/feature.deed.js": `fetch("/api/secret-data"); axios.post("/api/admin/action")`,
    }
    const fetcher = async (url: string) => pages[url] ?? null
    await JsMiner.mineAll(sid, fetcher)
    const keys = minedKeys(sid)
    expect(keys).toContain("GET https://app.test/api/health") // from main.js
    expect(keys).toContain("GET https://app.test/api/secret-data") // from the FOLLOWED chunk
    expect(keys.some((k) => k.includes("/api/admin/action"))).toBe(true)
  })

  test("addJsUrls registers script-src bundles the network capture missed", () => {
    const sid = "s-scripts"
    const added = DataCollector.addJsUrls(sid, ["https://app.test/app.shell.js", "https://app.test/app.shell.js"])
    expect(added).toBe(1) // deduped
    expect(DataCollector.latest(sid).jsUrls).toContain("https://app.test/app.shell.js")
  })
})
