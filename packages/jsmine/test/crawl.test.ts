import { describe, expect, test } from "bun:test"
import type { Transaction, Sender, SendResult } from "@cyberstrike-io/vortex"
import { MemoryStore, discoveredId } from "@cyberstrike-io/vortex"
import { mineDiscoveredJs, classifyScript } from "../src/crawl"

// A fake Sender that serves canned JS bodies by URL and records what was requested.
function fakeSender(bodies: Record<string, string>): { send: Sender; hits: string[] } {
  const hits: string[] = []
  let n = 0
  const send: Sender = async (input) => {
    const url = typeof input === "object" && "url" in input ? (input.url as string) : ""
    hits.push(url)
    const tx: Transaction = {
      id: `tx${++n}`,
      source: "replay",
      host: new URL(url).host,
      request: { method: "GET", url, headers: [] },
      response: { status: 200, headers: [], body: bodies[url] ?? "" },
    }
    return { transaction: tx } as SendResult
  }
  return { send, hits }
}

describe("classifyScript — first-party / cdn / third-party routing", () => {
  test("root-relative and bare are first-party", () => {
    expect(classifyScript("/static/app.js", "app.test")).toBe("first-party")
    expect(classifyScript("./chunk.js", "app.test")).toBe("first-party")
  })
  test("same host is first-party", () => {
    expect(classifyScript("https://app.test/a.js", "app.test")).toBe("first-party")
  })
  test("known CDN host is cdn", () => {
    expect(classifyScript("https://cdn.jsdelivr.net/npm/vue.js", "app.test")).toBe("cdn")
    expect(classifyScript("https://code.jquery.com/jquery-3.7.1.min.js", "app.test")).toBe("cdn")
  })
  test("other off-host is third-party", () => {
    expect(classifyScript("https://widget.acme.io/w.js", "app.test")).toBe("third-party")
  })
})

describe("mineDiscoveredJs — recursive first-party JS mining", () => {
  test("fetches first-party JS, mines it, follows newly discovered JS, skips CDN", async () => {
    const store = new MemoryStore()
    // seed the inventory: one first-party bundle, one CDN bundle (should be skipped)
    store.addDiscovered([
      { id: discoveredId("js", "/static/app.js"), kind: "js", value: "/static/app.js", hit: false },
      { id: discoveredId("js", "https://cdn.jsdelivr.net/npm/vue.js"), kind: "js", value: "https://cdn.jsdelivr.net/npm/vue.js", hit: false },
    ])
    const bodies: Record<string, string> = {
      // app.js: an API call, a hardcoded secret, and a reference to a further first-party chunk
      "https://app.test/static/app.js": 'fetch("/api/v1/orders");var k="AKIAIOSFODNN7EXAMPLE";import("/static/lazy.js")',
      // lazy.js (discovered from app.js): another endpoint
      "https://app.test/static/lazy.js": 'axios.get("/api/v1/profile")',
    }
    const { send, hits } = fakeSender(bodies)

    const res = await mineDiscoveredJs(store, send, { baseUrl: "https://app.test/" })

    // fetched both first-party bundles, skipped the CDN one
    expect(res.fetched.sort()).toEqual(["https://app.test/static/app.js", "https://app.test/static/lazy.js"])
    expect(res.skipped).toContain("https://cdn.jsdelivr.net/npm/vue.js")
    expect(hits).not.toContain("https://cdn.jsdelivr.net/npm/vue.js") // CDN never fetched
    // endpoints from BOTH bundles landed
    const eps = store.discovered("endpoint").map((d) => d.value)
    expect(eps).toContain("https://app.test/api/v1/orders")
    expect(eps).toContain("https://app.test/api/v1/profile")
    // the secret became a signal
    expect(res.secrets).toBe(1)
    expect(store.signals({ ruleId: "jsmine-secret" })).toHaveLength(1)
  })

  test("respects maxJs cap", async () => {
    const store = new MemoryStore()
    store.addDiscovered([
      { id: discoveredId("js", "/a.js"), kind: "js", value: "/a.js", hit: false },
      { id: discoveredId("js", "/b.js"), kind: "js", value: "/b.js", hit: false },
      { id: discoveredId("js", "/c.js"), kind: "js", value: "/c.js", hit: false },
    ])
    const { send } = fakeSender({})
    const res = await mineDiscoveredJs(store, send, { baseUrl: "https://app.test/", maxJs: 2 })
    expect(res.fetched).toHaveLength(2)
  })
})
