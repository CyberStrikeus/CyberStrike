import { describe, expect, test } from "bun:test"
import type { Transaction } from "@cyberstrike-io/vortex"
import { MemoryStore } from "@cyberstrike-io/vortex"
import { mineInto } from "../src/ingest"

function tx(id: string): Transaction {
  return { id, source: "browser", host: "app.test", request: { method: "GET", url: "https://app.test/js/app.js", headers: [] }, response: { status: 200, headers: [], body: "" } }
}

describe("mineInto — mine a JS body into a Vortex store", () => {
  test("endpoints/jsUrls land in the discovered inventory", () => {
    const store = new MemoryStore()
    store.add(tx("a"))
    const res = mineInto(store, "a", 'fetch("/api/v1/users"); import("/static/x.js")', { baseUrl: "https://app.test/js/app.js" })
    expect(res.discovered).toBe(2)
    expect(store.discovered("endpoint").map((d) => d.value)).toContain("https://app.test/api/v1/users")
    expect(store.discovered("js").map((d) => d.value)).toContain("https://app.test/static/x.js")
  })

  test("mined secrets become high-severity info-disclosure signals (redacted, deduped)", () => {
    const store = new MemoryStore()
    store.add(tx("a"))
    const body = 'var k="AKIAIOSFODNN7EXAMPLE"; var p="-----BEGIN RSA PRIVATE KEY-----";'
    const res = mineInto(store, "a", body)
    expect(res.secrets).toBe(2)
    const sigs = store.signals({ ruleId: "jsmine-secret" })
    expect(sigs).toHaveLength(2)
    const aws = sigs.find((s) => s.title.includes("aws-access-key"))
    expect(aws?.severity).toBe("high")
    expect(aws?.category).toBe("info-disclosure")
    expect(aws?.evidence).toBe("AKIA…(20 chars)") // redacted — no cleartext in the signal layer
    // re-mining the same body is idempotent (dedupKey carries the full value)
    expect(mineInto(store, "a", body).secrets).toBe(0)
    expect(store.signals({ ruleId: "jsmine-secret" })).toHaveLength(2)
  })

  test("new vendor shapes are labeled correctly in the signal title", () => {
    const store = new MemoryStore()
    store.add(tx("a"))
    const body = [
      `k1="sk_test_${"a".repeat(24)}"`,
      `u="mongodb+srv://admin:s3cretP4ss@c0.mongodb.net/db"`,
      `t="SK${"0123456789abcdef0123456789abcdef"}"`,
    ].join(";")
    mineInto(store, "a", body)
    const titles = store.signals({ ruleId: "jsmine-secret" }).map((s) => s.title)
    expect(titles.some((t) => t.includes("stripe-key"))).toBe(true)
    expect(titles.some((t) => t.includes("connection-string-credentials"))).toBe(true)
    expect(titles.some((t) => t.includes("twilio-api-key"))).toBe(true)
  })

  test("a referenced source map becomes a low-severity info-disclosure signal", () => {
    const store = new MemoryStore()
    store.add(tx("a"))
    mineInto(store, "a", 'fetch("/api/x");\n//# sourceMappingURL=app.7f8a.js.map', { baseUrl: "https://app.test/js/app.js" })
    const sigs = store.signals({ ruleId: "jsmine-sourcemap" })
    expect(sigs).toHaveLength(1)
    expect(sigs[0]?.severity).toBe("low")
    expect(sigs[0]?.category).toBe("info-disclosure")
    expect(sigs[0]?.evidence).toBe("https://app.test/js/app.7f8a.js.map")
    // deduped per map URL — re-mining does not double-report
    mineInto(store, "a", 'fetch("/api/x");\n//# sourceMappingURL=app.7f8a.js.map', { baseUrl: "https://app.test/js/app.js" })
    expect(store.signals({ ruleId: "jsmine-sourcemap" })).toHaveLength(1)
  })

  test("a clean JS body writes nothing", () => {
    const store = new MemoryStore()
    store.add(tx("a"))
    const res = mineInto(store, "a", "function f(a,b){return a+b}")
    expect(res.discovered).toBe(0)
    expect(res.secrets).toBe(0)
  })
})
