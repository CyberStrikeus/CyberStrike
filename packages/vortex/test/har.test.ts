import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { fromHar, parseHar, toHar, observed, isObserved, defaultRegistry } from "../src/index"

const har = {
  log: {
    entries: [
      {
        startedDateTime: "2026-01-01T00:00:00.000Z",
        time: 42,
        request: { method: "POST", url: "https://app.test/api/x?q=1", headers: [{ name: "Content-Type", value: "application/json" }], postData: { mimeType: "application/json", text: '{"a":1}' } },
        response: { status: 200, headers: [{ name: "Server", value: "nginx" }], content: { size: 9, mimeType: "application/json", text: '{"ok":true}' } },
      },
    ],
  },
}

describe("HAR import/export", () => {
  test("fromHar maps entries to Transactions (source import)", () => {
    const txs = fromHar(har, "sess")
    expect(txs).toHaveLength(1)
    const t = txs[0]!
    expect(t.source).toBe("import")
    expect(t.session).toBe("sess")
    expect(t.host).toBe("app.test")
    expect(t.request.method).toBe("POST")
    expect(t.request.body).toBe('{"a":1}')
    expect(t.response?.status).toBe(200)
    expect(t.response?.body).toBe('{"ok":true}')
    expect(t.timing?.ms).toBe(42)
  })
  test("parseHar handles a JSON string; round-trips through toHar", () => {
    const txs = parseHar(JSON.stringify(har))
    const back = toHar(txs)
    expect(back.log?.entries).toHaveLength(1)
    expect(back.log?.entries?.[0]?.request?.url).toBe("https://app.test/api/x?q=1")
  })
  test("tolerates malformed entries", () => {
    expect(fromHar({ log: { entries: [{ request: {} } as any] } })).toHaveLength(0) // no url → skipped
    expect(fromHar({})).toHaveLength(0)
  })
})

describe("agent-safety: replay probes never pollute passive detection", () => {
  const observedTx: Transaction = { id: "obs", source: "browser", host: "app.test", request: { method: "GET", url: "https://app.test/api/x", headers: [] }, response: { status: 200, headers: [{ name: "content-type", value: "application/json" }], body: "{}" } }
  // an agent-sent probe that ECHOES a canary/payload — must NOT be treated as the app's behavior
  const replayTx: Transaction = { id: "vx_1", source: "replay", derivedFrom: "obs", host: "app.test", request: { method: "GET", url: "https://app.test/api/x?q=cnry123", headers: [] }, response: { status: 200, headers: [], body: "reflected cnry123 -----BEGIN RSA PRIVATE KEY-----" } }

  test("isObserved excludes replay; observed() keeps only real traffic", () => {
    expect(isObserved(observedTx)).toBe(true)
    expect(isObserved(replayTx)).toBe(false)
    expect(observed([observedTx, replayTx]).map((t) => t.id)).toEqual(["obs"])
  })

  test("passive analyze over observed() does NOT flag the agent's own injected payload", () => {
    const all = [observedTx, replayTx]
    // If we (wrongly) analyzed replay traffic, the secret-in-response rule would fire on the probe's
    // echoed key. Scoping to observed() prevents that self-inflicted false finding.
    const scoped = defaultRegistry().analyze(observed(all))
    expect(scoped.some((s) => s.ruleId === "secret-in-response")).toBe(false)
    // (and analyzing the raw replay WOULD have fired it — proving the scope is what protects us)
    expect(defaultRegistry().analyze([replayTx]).some((s) => s.ruleId === "secret-in-response")).toBe(true)
  })
})
