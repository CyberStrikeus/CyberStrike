import { describe, expect, test } from "bun:test"
import { JsMine } from "../../../src/session/web/js-mine"

const ORIGIN = "https://app.test"
const all = () => true
const mine = (text: string, inScope: (u: string) => boolean = all) =>
  JsMine.mineEndpoints(text, ORIGIN, inScope).map((e) => `${e.method} ${e.url}`)

describe("JsMine.mineEndpoints — deterministic route harvest", () => {
  test("http-client call sites capture the method (non-API-prefix paths isolate the call rule)", () => {
    expect(mine(`svc.get("/things/list"); svc.post('/things/save')`)).toEqual([
      "GET https://app.test/things/list",
      "POST https://app.test/things/save",
    ])
  })

  test("an API-prefix path in a call ALSO yields the GET path-literal (bonus harvest, by design)", () => {
    expect(mine(`http.post('/api/login')`).sort()).toEqual(["GET https://app.test/api/login", "POST https://app.test/api/login"])
  })

  test("fetch() defaults to GET", () => {
    expect(mine(`await fetch("/api/orders")`)).toEqual(["GET https://app.test/api/orders"])
  })

  test("bare API-prefix path literals are harvested", () => {
    expect(mine(`const u = "/api/products"; const a = "/admin/settings"`)).toEqual([
      "GET https://app.test/api/products",
      "GET https://app.test/admin/settings",
    ])
  })

  test("template literals normalize to the endpoint SHAPE", () => {
    expect(mine("api.get(`/api/users/${id}/posts`)")).toEqual(["GET https://app.test/api/users/{}/posts"])
  })

  test("whole-segment prefix match — /user-guide and /username are NOT mined as /user", () => {
    expect(mine(`const a = "/user-guide"; const b = "/username"`)).toEqual([])
  })

  test("static assets and non-http schemes are skipped", () => {
    expect(mine(`fetch("/vendor.js"); fetch("/logo.png"); api.get("data:text/x"); fetch("//cdn.x/a")`)).toEqual([])
  })

  test("dedupes identical routes", () => {
    expect(mine(`fetch("/api/x"); fetch("/api/x")`)).toEqual(["GET https://app.test/api/x"])
  })

  test("absolute URLs are kept only when in scope", () => {
    const text = `fetch("https://app.test/api/in"); fetch("https://evil.com/api/out")`
    expect(mine(text, (u) => !u.includes("evil.com"))).toEqual(["GET https://app.test/api/in"])
  })

  test("relative-without-slash is too ambiguous → dropped", () => {
    expect(mine(`api.get("users/list")`)).toEqual([])
  })
})
