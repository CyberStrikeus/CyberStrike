import { beforeEach, describe, expect, test } from "bun:test"
import { DataCollector } from "../../../src/session/web/data-collector"

beforeEach(() => DataCollector._reset())

const rec = (over: Partial<DataCollector.Record_>): DataCollector.Record_ => ({ method: "GET", origin: "https://h.tld", path: "/", ...over })

describe("classify — content-type first, URL suffix fallback", () => {
  test("content-type wins", () => {
    expect(DataCollector.classify("/x", "application/javascript")).toBe("js")
    expect(DataCollector.classify("/x", "text/html; charset=utf-8")).toBe("html")
    expect(DataCollector.classify("/x", "application/json")).toBe("api")
    expect(DataCollector.classify("/api/x", "application/vnd.api+json")).toBe("api")
    expect(DataCollector.classify("/x", "text/css")).toBe("static")
    expect(DataCollector.classify("/x", "image/png")).toBe("static")
    expect(DataCollector.classify("/x", "text/event-stream")).toBe("realtime")
  })
  test("URL suffix fallback when no content-type", () => {
    expect(DataCollector.classify("/app.js")).toBe("js")
    expect(DataCollector.classify("/main.mjs?v=2")).toBe("js")
    expect(DataCollector.classify("/logo.png")).toBe("static")
    expect(DataCollector.classify("/index.jsp")).toBe("html")
  })
  test("a bare route with no signal is treated as a navigable html route", () => {
    expect(DataCollector.classify("/account")).toBe("html")
    expect(DataCollector.classify("/api/users")).toBe("html") // no ct/suffix ⇒ route (still surfaced)
  })
})

describe("record + latest", () => {
  test("html/api requests become endpoints; hits accumulate; status refreshes", () => {
    const sid = "s"
    DataCollector.record(sid, rec({ path: "/account", contentType: "text/html", status: 200 }))
    DataCollector.record(sid, rec({ path: "/account", contentType: "text/html", status: 302 }))
    const eps = DataCollector.latest(sid).endpoints
    expect(eps.length).toBe(1)
    expect(eps[0]).toMatchObject({ method: "GET", path: "/account", kind: "html", hits: 2, lastStatus: 302 })
  })

  test("js requests are collected as URLs, not endpoints", () => {
    const sid = "s"
    DataCollector.record(sid, rec({ path: "/static/app.js", contentType: "application/javascript" }))
    const d = DataCollector.latest(sid)
    expect(d.jsUrls).toEqual(["https://h.tld/static/app.js"])
    expect(d.endpoints).toEqual([])
    expect(d.counts.js).toBe(1)
  })

  test("static requests only bump counters", () => {
    const sid = "s"
    DataCollector.record(sid, rec({ path: "/a.png", contentType: "image/png" }))
    const d = DataCollector.latest(sid)
    expect(d.counts.static).toBe(1)
    expect(d.endpoints).toEqual([])
    expect(d.jsUrls).toEqual([])
  })

  test("latest orders html routes before api", () => {
    const sid = "s"
    DataCollector.record(sid, rec({ method: "POST", path: "/api/transfer", contentType: "application/json" }))
    DataCollector.record(sid, rec({ path: "/dashboard", contentType: "text/html" }))
    expect(DataCollector.latest(sid).endpoints.map((e) => e.kind)).toEqual(["html", "api"])
  })

  test("unknown session → empty view", () => {
    const d = DataCollector.latest("nobody")
    expect(d.endpoints).toEqual([])
    expect(d.jsUrls).toEqual([])
    expect(d.minedRoutes).toEqual([])
    expect(d.counts).toEqual({ api: 0, html: 0, js: 0, static: 0, realtime: 0 })
  })

  test("addMined records + dedupes JS-mined routes (P4.1)", () => {
    const sid = "s"
    DataCollector.addMined(sid, [
      { method: "GET", url: "https://h.tld/api/a" },
      { method: "POST", url: "https://h.tld/api/b" },
      { method: "GET", url: "https://h.tld/api/a" }, // duplicate
    ])
    DataCollector.addMined(sid, []) // no-op
    expect(DataCollector.latest(sid).minedRoutes.map((r) => `${r.method} ${r.url}`).sort()).toEqual([
      "GET https://h.tld/api/a",
      "POST https://h.tld/api/b",
    ])
  })
})

describe("server signals for the framework fingerprint", () => {
  test("retains signal headers only; extracts response cookie names (values dropped)", () => {
    const sid = "s"
    DataCollector.record(
      sid,
      rec({
        path: "/",
        contentType: "text/html",
        headers: {
          "X-Powered-By": "PHP/8.2.0",
          "Server": "Apache",
          "X-Request-Id": "should-be-dropped",
          "Set-Cookie": "PHPSESSID=secretvalue; Path=/, JSESSIONID=other; HttpOnly",
        },
      }),
    )
    const srv = DataCollector.latest(sid).server
    expect(srv.headers["x-powered-by"]).toBe("PHP/8.2.0")
    expect(srv.headers["server"]).toBe("Apache")
    expect(srv.headers["x-request-id"]).toBeUndefined() // non-signal header not retained
    expect(srv.cookies.sort()).toEqual(["JSESSIONID", "PHPSESSID"])
    // no cookie VALUE is retained anywhere
    expect(JSON.stringify(srv)).not.toContain("secretvalue")
  })

  test("a single cookie with a comma in Expires is not mis-split", () => {
    const sid = "s"
    DataCollector.record(sid, rec({ headers: { "set-cookie": "SES1=a; Path=/; Expires=Wed, 09 Jun 2021 10:18:14 GMT" } }))
    expect(DataCollector.latest(sid).server.cookies).toEqual(["SES1"])
  })
})
