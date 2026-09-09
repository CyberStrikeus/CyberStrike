import { describe, expect, test } from "bun:test"
import type { Transaction, InjectPoint } from "../src/index"
import { injectPoints, valueType, MemoryStore } from "../src/index"
import { SqliteStore } from "../src/sqlite-store"

function jsonTx(id: string, url: string, body?: string, headers: { name: string; value: string }[] = []): Transaction {
  const h = body ? [{ name: "content-type", value: "application/json" }, ...headers] : headers
  return { id, session: "s1", source: "browser", host: "app.test", request: { method: body ? "POST" : "GET", url, headers: h, body } }
}

function find(points: InjectPoint[], location: InjectPoint["location"], dotpath: string): InjectPoint | undefined {
  return points.find((p) => p.location === location && p.dotpath === dotpath)
}

describe("injectPoints enumeration", () => {
  test("single + multiple query params", () => {
    const pts = injectPoints(jsonTx("t1", "https://app.test/search?q=abc&page=2"))
    expect(find(pts, "query", "q")?.valueSample).toBe("abc")
    expect(find(pts, "query", "q")?.valueType).toBe("string")
    expect(find(pts, "query", "page")?.valueType).toBe("number")
    expect(pts.filter((p) => p.location === "query").length).toBe(2)
  })

  test("nested body objects AND array elements expand to dotpath points", () => {
    const body = JSON.stringify({ params: { filters: [{ value: "dance" }, { value: "jazz" }], date: "2026-01-01" }, name: "Report" })
    const pts = injectPoints(jsonTx("t2", "https://app.test/api/run", body))
    // nested array element → dotted numeric index
    expect(find(pts, "body", "params.filters.0.value")?.valueSample).toBe("dance")
    expect(find(pts, "body", "params.filters.1.value")?.valueSample).toBe("jazz")
    // nested scalar + top-level scalar
    expect(find(pts, "body", "params.date")?.valueSample).toBe("2026-01-01")
    expect(find(pts, "body", "name")?.valueSample).toBe("Report")
    // `name` on the point = the leaf key, not the full dotpath
    expect(find(pts, "body", "params.filters.0.value")?.name).toBe("value")
  })

  test("form-encoded body params", () => {
    const tx: Transaction = {
      id: "t3",
      session: "s1",
      source: "browser",
      host: "app.test",
      request: { method: "POST", url: "https://app.test/login", headers: [{ name: "content-type", value: "application/x-www-form-urlencoded" }], body: "user=admin&pass=1234" },
    }
    const pts = injectPoints(tx)
    expect(find(pts, "body", "user")?.valueSample).toBe("admin")
    expect(find(pts, "body", "pass")?.valueType).toBe("number")
  })

  test("id-shaped path segments are points; static route words are not", () => {
    const pts = injectPoints(jsonTx("t4", "https://app.test/review/api/customers/ea8722b0-dcd4-4fed-8c1f-d5952857dd16/dashboard"))
    const uuidSeg = pts.find((p) => p.location === "path")
    expect(uuidSeg?.dotpath).toBe("3") // 0:review 1:api 2:customers 3:<uuid> 4:dashboard
    expect(uuidSeg?.valueType).toBe("uuid")
    expect(uuidSeg?.name).toBe("customers")
    expect(pts.filter((p) => p.location === "path").length).toBe(1) // only the uuid, not the words
  })

  test("numeric path id is a point", () => {
    const pts = injectPoints(jsonTx("t5", "https://app.test/orders/12345"))
    expect(find(pts, "path", "1")?.valueType).toBe("number")
  })

  test("only injectable headers become points", () => {
    const pts = injectPoints(
      jsonTx("t6", "https://app.test/x", undefined, [
        { name: "Referer", value: "https://app.test/from" },
        { name: "accept-language", value: "en-US" },
      ]),
    )
    expect(find(pts, "header", "referer")?.valueSample).toBe("https://app.test/from")
    expect(pts.some((p) => p.location === "header" && p.dotpath === "accept-language")).toBe(false)
  })

  test("valueType inference", () => {
    expect(valueType("")).toBe("empty")
    expect(valueType("ea8722b0-dcd4-4fed-8c1f-d5952857dd16")).toBe("uuid")
    expect(valueType("507f1f77bcf86cd799439011")).toBe("objectid")
    expect(valueType("42")).toBe("number")
    expect(valueType("true")).toBe("bool")
    expect(valueType('{"a":1}')).toBe("json")
    expect(valueType("hello")).toBe("string")
  })

  test("stable id = tx + location + dotpath, deterministic across calls", () => {
    const url = "https://app.test/search?q=abc"
    expect(injectPoints(jsonTx("t7", url))[0]!.id).toBe(injectPoints(jsonTx("t7", url))[0]!.id)
    expect(find(injectPoints(jsonTx("t7", url)), "query", "q")?.id).toBe("t7:query:q")
  })
})

describe("store persistence — MemoryStore + SqliteStore", () => {
  const stores: [string, () => import("../src/store").TrafficStore][] = [
    ["memory", () => new MemoryStore()],
    ["sqlite", () => new SqliteStore(":memory:", "s1")],
  ]

  for (const [label, make] of stores) {
    test(`${label}: add returns NEW count, re-add dedups`, () => {
      const s = make()
      const pts = injectPoints(jsonTx("tx1", "https://app.test/s?q=a&p=1"))
      expect(s.addInjectPoints(pts)).toBe(2)
      expect(s.addInjectPoints(pts)).toBe(0) // idempotent
      expect(s.injectPoints().length).toBe(2)
    })

    test(`${label}: filter by transactionId and location`, () => {
      const s = make()
      s.addInjectPoints(injectPoints(jsonTx("txA", "https://app.test/a?x=1")))
      s.addInjectPoints(injectPoints(jsonTx("txB", "https://app.test/b/12345")))
      expect(s.injectPoints({ transactionId: "txA" }).length).toBe(1)
      expect(s.injectPoints({ location: "path" }).length).toBe(1)
      expect(s.injectPoints({ location: "path" })[0]!.transactionId).toBe("txB")
    })

    test(`${label}: probed flag persists and is preserved on re-add`, () => {
      const s = make()
      const pts = injectPoints(jsonTx("txP", "https://app.test/s?q=a"))
      s.addInjectPoints(pts)
      // mark probed
      s.addInjectPoints([{ ...pts[0]!, probed: true }])
      expect(s.injectPoints({ probed: true }).length).toBe(1)
      // a plain re-enumeration (probed undefined) must NOT clobber the flag back to unprobed
      s.addInjectPoints(pts)
      expect(s.injectPoints({ probed: true }).length).toBe(1)
    })
  }
})
