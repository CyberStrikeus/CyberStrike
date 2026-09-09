import { describe, expect, test } from "bun:test"
import type { Sender } from "../src/index"
import { MemoryStore, crawl } from "../src/index"

// A stub site: url → HTML body. The Sender returns a minimal SendResult carrying the response.
const site: Record<string, string> = {
  "https://app.test/": '<a href="/a">a</a><a href="/b">b</a><script src="/app.js"></script><a href="https://other.test/x">ext</a>',
  "https://app.test/a": '<a href="/">home</a><a href="/c">c</a>',
  "https://app.test/b": "no links here",
  "https://app.test/c": "leaf",
}
const sender = (calls: string[]): Sender => async (input) => {
  const url = typeof input === "object" && input && "url" in input ? (input as { url: string }).url : String(input)
  calls.push(url)
  const body = site[url] ?? ""
  return {
    transaction: { id: `vx_${url}`, source: "replay", host: "app.test", request: { method: "GET", url, headers: [] }, response: { status: 200, headers: [{ name: "content-type", value: "text/html" }], body } },
    result: { response: { version: "HTTP/1.1", status: 200, reason: "OK", headers: [], body: new Uint8Array() }, timing: { totalMs: 1 } },
  } as never
}

describe("crawl — shallow discovery producer", () => {
  test("walks same-host page links breadth-first, skips external, records scripts as jsUrls", async () => {
    const store = new MemoryStore()
    const calls: string[] = []
    const res = await crawl(store, "https://app.test/", sender(calls))
    // fetched all same-host pages, NOT the external host, NOT the script (scripts are recorded, not page-crawled)
    expect(res.fetched.sort()).toEqual(["https://app.test/", "https://app.test/a", "https://app.test/b", "https://app.test/c"])
    expect(calls).not.toContain("https://other.test/x")
    expect(calls).not.toContain("https://app.test/app.js")
    // crawled traffic joined the corpus
    expect(store.size()).toBe(4)
    // discovered inventory: pages as endpoints, the script as a jsUrl (for a later JS-mine pass)
    expect(store.discovered("js").map((d) => d.value)).toContain("https://app.test/app.js")
    expect(store.discovered("endpoint").length).toBeGreaterThan(0)
  })

  test("maxPages bounds the frontier", async () => {
    const store = new MemoryStore()
    const calls: string[] = []
    const res = await crawl(store, "https://app.test/", sender(calls), { maxPages: 2 })
    expect(res.fetched).toHaveLength(2)
  })

  test("sameHostOnly:false does not prune the external host", async () => {
    const store = new MemoryStore()
    const calls: string[] = []
    await crawl(store, "https://app.test/", sender(calls), { sameHostOnly: false, maxPages: 10 })
    expect(calls).toContain("https://other.test/x")
  })
})
