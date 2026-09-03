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
