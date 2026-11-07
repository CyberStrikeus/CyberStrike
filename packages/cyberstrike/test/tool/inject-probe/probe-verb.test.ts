import { describe, test, expect } from "bun:test"
import { probeVerbTampering } from "../../../src/tool/inject-probe/probe/verb"
import type { HttpSender } from "../../../src/tool/inject-probe/send"
import type { ResolvedRequest, SendBudget } from "../../../src/tool/inject-probe/types"

const makeR = (method = "POST"): ResolvedRequest => ({
  method,
  url: new URL("http://example.com/admin/action"),
  headers: {},
  body: `{"x":1}`,
  contentType: "application/json",
  auth: { source: "none" },
  provenance: { fromRaw: false, reconstructed: false, bodyMaybeTruncated: false },
})
const budget = (max = 20): SendBudget => ({ sent: 0, max })
const sig = () => new AbortController().signal

describe("probeVerbTampering (WSTG-INPV-03)", () => {
  test("control keys on the verb: base POST is 403 but GET is 200 → bypass", async () => {
    const sender: HttpSender = {
      send: async (req) => (req.method === "POST" ? { status: 403, body: "denied", headers: {} } : { status: 200, body: "data", headers: {} }),
    }
    const obs = await probeVerbTampering(sender, makeR("POST"), sig(), 0, budget())
    expect(obs.baseline.status).toBe(403)
    expect(obs.bypass.length).toBeGreaterThan(0)
    expect(obs.bypass.some((b) => b.to === 200)).toBe(true)
  })

  test("arbitrary verb accepted (2xx) is flagged", async () => {
    const sender: HttpSender = { send: async () => ({ status: 200, body: "ok", headers: {} }) }
    const obs = await probeVerbTampering(sender, makeR("POST"), sig(), 0, budget())
    expect(obs.arbitrary_verb_accepted).toBe(true)
  })

  test("Allow advertising PUT/DELETE is surfaced but NOT fired", async () => {
    const fired: string[] = []
    const sender: HttpSender = {
      send: async (req) => {
        fired.push(req.method)
        const headers: Record<string, string> = req.method === "OPTIONS" ? { allow: "GET, POST, PUT, DELETE, OPTIONS" } : {}
        return { status: 200, body: "", headers }
      },
    }
    const obs = await probeVerbTampering(sender, makeR("POST"), sig(), 0, budget())
    expect(obs.dangerous_methods_allowed).toEqual(["PUT", "DELETE"])
    // safety: the probe never sent a destructive verb
    expect(fired).not.toContain("PUT")
    expect(fired).not.toContain("DELETE")
    expect(fired).not.toContain("PATCH")
  })

  test("uniformly-protected endpoint (all deny) → no bypass", async () => {
    const sender: HttpSender = { send: async () => ({ status: 403, body: "denied", headers: {} }) }
    const obs = await probeVerbTampering(sender, makeR("POST"), sig(), 0, budget())
    expect(obs.bypass).toEqual([])
    expect(obs.arbitrary_verb_accepted).toBe(false)
  })
})
