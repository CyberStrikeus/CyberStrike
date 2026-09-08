import { describe, expect, test } from "bun:test"
import type { Transaction, Sender } from "../src/index"
import { compileProbes, probeRules, runActiveRules, parseProbes, send, Engine } from "../src/index"

function tx(id: string, url: string, resCT = "text/html"): Transaction {
  return { id, source: "browser", host: "app.test", request: { method: "GET", url: `https://app.test${url}`, headers: [] }, response: { status: 200, headers: [{ name: "content-type", value: resCT }], body: "<html>ok</html>" } }
}

const enc = new TextEncoder()
const res = (status: number, body: string): Engine.ReplayResponse.Result => ({ response: { version: "HTTP/1.1", status, reason: "", headers: [], body: enc.encode(body) }, timing: { totalMs: 1 } })

// Senders wrap the REAL send() (so {canary} substitution + canaryReflected run) with a stub transport.
const echo: Sender = (input, opts) => send(input, { ...opts, transport: async (req) => res(200, new TextDecoder().decode(Engine.HttpMessage.serialize(req))) })
// Reflects the URL-DECODED target, so injected markup (<vx>…</vx>) bounces back UNESCAPED → broke out.
const rawReflect: Sender = (input, opts) => send(input, { ...opts, transport: async (req) => res(200, decodeURIComponent(req.target)) })
const sqlErr: Sender = (input, opts) => send(input, { ...opts, transport: async () => res(500, "You have an error in your SQL syntax") })
const clean: Sender = (input, opts) => send(input, { ...opts, transport: async () => res(200, "<html>fine</html>") })

describe("ProbeRule → ActiveRule (the active DSL shape)", () => {
  const [xss, sqli] = compileProbes(probeRules)

  test("reflected-xss fires when the canary bounces back (detect: reflected)", async () => {
    const sigs = await xss!.probe([tx("a", "/search?q=hi")], echo)
    expect(sigs).toHaveLength(1)
    expect(sigs[0].ruleId).toBe("reflected-xss-lead")
    expect(sigs[0].title).toContain("/search")
  })
  test("reflected-xss does NOT fire when nothing reflects", async () => {
    expect(await xss!.probe([tx("a", "/search?q=hi")], clean)).toHaveLength(0)
  })
  test("reflected-xss elevates to high when the markup reflects UNESCAPED (broke out)", async () => {
    const sigs = await xss!.probe([tx("a", "/search?q=hi")], rawReflect)
    expect(sigs).toHaveLength(1)
    expect(sigs[0].severity).toBe("high") // rule declares medium; broke-out upgrades it
    expect(sigs[0].evidence).toContain("UNESCAPED")
  })
  test("select filters: no q param / not html → not probed", async () => {
    expect(await xss!.probe([tx("a", "/search")], echo)).toHaveLength(0) // no q
    expect(await xss!.probe([tx("a", "/api/x?q=1", "application/json")], echo)).toHaveLength(0) // not html
  })
  test("sql-error fires when the probe response carries a SQL error signature (detect: HTTPQL)", async () => {
    const sigs = await sqli!.probe([tx("a", "/item?id=5")], sqlErr)
    expect(sigs).toHaveLength(1)
    expect(sigs[0].severity).toBe("high")
  })
  test("one probe set per endpoint (no fan-out) + runActiveRules aggregates", async () => {
    const sigs = await runActiveRules([sqli!], [tx("a", "/item?id=1"), tx("b", "/item?id=2")], sqlErr)
    expect(sigs).toHaveLength(1) // same endpoint /item?id={} → probed once
  })
  test("parseProbes validates an agent's JSON probe rule", () => {
    expect(parseProbes(probeRules)).toHaveLength(2)
    expect(() => parseProbes([{ id: "x", category: "c", severity: "high", select: "resp.status == 200", inject: { into: "query", payloads: [] }, detect: "reflected" }])).toThrow() // empty payloads + missing name
  })
})
