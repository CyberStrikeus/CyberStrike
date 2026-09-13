import { describe, expect, test } from "bun:test"
import type { Transaction } from "@cyberstrike-io/vortex"
import { MemoryStore, RuleRegistry, registerPlugin, extract } from "@cyberstrike-io/vortex"
import { plugin } from "../src/plugin"

function tx(id: string, url: string, body: string, contentType?: string): Transaction {
  return {
    id,
    source: "browser",
    host: "app.test",
    request: { method: "GET", url, headers: [] },
    response: { status: 200, headers: contentType ? [{ name: "content-type", value: contentType }] : [], body },
  }
}

describe("jsmine.plugin() — the Vortex extractor seam end-to-end", () => {
  test("registerPlugin + extract() mines JS transactions through the engine", () => {
    const store = new MemoryStore()
    store.add(tx("app", "https://app.test/static/app.js", 'fetch("/api/v1/users");var k="AKIAIOSFODNN7EXAMPLE"'))
    const reg = new RuleRegistry()
    registerPlugin(reg, plugin())
    expect(reg.listHooks()).toHaveLength(1)

    extract(store, reg) // core drives the hook — jsmine never called directly

    expect(store.discovered("endpoint").map((d) => d.value)).toContain("https://app.test/api/v1/users")
    expect(store.signals({ ruleId: "jsmine-secret" })).toHaveLength(1)
  })

  test("mines by content-type even when the URL is not .js", () => {
    const store = new MemoryStore()
    store.add(tx("bundle", "https://app.test/bundle", 'axios.get("/api/orders")', "application/javascript; charset=utf-8"))
    const reg = new RuleRegistry().registerHookAll(plugin().onTransaction!)
    extract(store, reg)
    expect(store.discovered("endpoint").map((d) => d.value)).toContain("https://app.test/api/orders")
  })

  test("ignores non-JS transactions (HTML page)", () => {
    const store = new MemoryStore()
    store.add(tx("home", "https://app.test/", '<a href="/api/secret">x</a>', "text/html"))
    const reg = new RuleRegistry()
    registerPlugin(reg, plugin())
    extract(store, reg)
    expect(store.discovered("endpoint")).toHaveLength(0)
    expect(store.signals()).toHaveLength(0)
  })

  test("entropy toggle passes through", () => {
    const store = new MemoryStore()
    const tok = "kThP9xQ2mV7nR4wZ8bL1cY6dF3gJ5aX"
    store.add(tx("a", "https://app.test/a.js", `x("${tok}")`))
    const reg = new RuleRegistry()
    registerPlugin(reg, plugin({ entropy: false }))
    extract(store, reg)
    expect(store.signals({ ruleId: "jsmine-secret" })).toHaveLength(0) // entropy off ⇒ unknown token not flagged
  })
})
