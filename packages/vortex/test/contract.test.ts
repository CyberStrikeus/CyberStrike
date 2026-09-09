import { describe, expect, test } from "bun:test"
import type { Transaction, SourceAdapter, VortexPlugin } from "../src/index"
import { MemoryStore, RuleRegistry, feed, registerPlugin, PluginError, CORE_API_VERSION, runActiveRules, send } from "../src/index"

describe("consumer contract — SourceAdapter", () => {
  test("feed() runs an adapter over raw events into the store, skipping undefined", () => {
    const store = new MemoryStore()
    // a toy adapter that turns a {u} record into a Transaction, skipping blanks
    const adapter: SourceAdapter<{ u: string }> = {
      source: "import",
      ingest: (raw) => (raw.u ? { id: raw.u, source: "import", host: "app.test", request: { method: "GET", url: `https://app.test/${raw.u}`, headers: [] } } : undefined),
    }
    const n = feed(store, adapter, [{ u: "a" }, { u: "" }, { u: "b" }])
    expect(n).toBe(2)
    expect(store.all().map((t) => t.id).sort()).toEqual(["a", "b"])
  })
})

describe("consumer contract — VortexPlugin + registerPlugin", () => {
  const plugin: VortexPlugin = {
    name: "acme-rules",
    version: "0.1.0",
    requiresCore: "^1.0.0",
    rules: [{ id: "acme-teapot", category: "misc", severity: "low", when: "resp.status == 418" }],
    probes: [{ id: "acme-probe", category: "injection", severity: "high", select: "req.query.q", inject: { into: "query", name: "q", payloads: ["'"] }, detect: 'regex("SQL", resp.body)' }],
  }

  test("registers declarative rules into a registry and returns the probes as active rules", async () => {
    const reg = new RuleRegistry()
    const probes = registerPlugin(reg, plugin)
    const tx: Transaction = { id: "t", source: "browser", host: "app.test", request: { method: "GET", url: "https://app.test/x", headers: [] }, response: { status: 418, headers: [], body: "" } }
    expect(reg.analyze([tx]).map((s) => s.ruleId)).toContain("acme-teapot") // the plugin rule ran
    expect(probes).toHaveLength(1) // probe compiled to an ActiveRule, returned for runActiveRules

    // and the returned active rule actually works through runActiveRules
    const q: Transaction = { id: "q", source: "browser", host: "app.test", request: { method: "GET", url: "https://app.test/s?q=1", headers: [] } }
    const sigs = await runActiveRules(probes, [q], (input, opts) => send(input, { ...opts, transport: async () => ({ response: { version: "HTTP/1.1", status: 500, reason: "", headers: [], body: new TextEncoder().encode("SQL error") }, timing: { totalMs: 1 } }) }))
    expect(sigs.map((s) => s.ruleId)).toContain("acme-probe")
  })

  test("rejects a plugin that needs an incompatible core version", () => {
    expect(() => registerPlugin(new RuleRegistry(), { name: "future", version: "1.0.0", requiresCore: "^2.0.0", rules: [] })).toThrow(PluginError)
    expect(CORE_API_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
  test("a compatible caret range and an omitted requiresCore both pass", () => {
    expect(() => registerPlugin(new RuleRegistry(), { name: "ok", version: "1.0.0", requiresCore: "^1.0.0" })).not.toThrow()
    expect(() => registerPlugin(new RuleRegistry(), { name: "any", version: "1.0.0" })).not.toThrow()
  })
})
