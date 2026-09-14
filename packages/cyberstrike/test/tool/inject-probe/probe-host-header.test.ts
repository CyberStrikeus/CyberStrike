import { describe, test, expect } from "bun:test"
import { probeHostHeader } from "../../../src/tool/inject-probe/probe/host-header"
import type { HttpSender } from "../../../src/tool/inject-probe/send"
import type { ResolvedRequest, SendBudget } from "../../../src/tool/inject-probe/types"

const makeR = (): ResolvedRequest => ({
  method: "POST",
  url: new URL("http://example.com/password/reset"),
  headers: {},
  body: `{"email":"a@b.c"}`,
  contentType: "application/json",
  auth: { source: "none" },
  provenance: { fromRaw: false, reconstructed: false, bodyMaybeTruncated: false },
})
const budget = (max = 20): SendBudget => ({ sent: 0, max })
const sig = () => new AbortController().signal
const xfh = (req: { headers?: Record<string, string> }) => req.headers?.["x-forwarded-host"] ?? ""

describe("probeHostHeader (WSTG-INPV-17)", () => {
  test("app builds an absolute reset link from X-Forwarded-Host → reflected in body", async () => {
    const sender: HttpSender = { send: async (req) => ({ status: 200, body: `reset link: https://${xfh(req)}/reset?t=1`, headers: {} }) }
    const obs = await probeHostHeader(sender, makeR(), sig(), 0, budget())
    expect(obs.reflected.length).toBeGreaterThan(0)
    const hit = obs.reflected[0]!
    expect(hit.header).toBe("x-forwarded-host")
    expect(hit.where).toBe("body")
    expect(hit.evidence).toContain(".poison.test")
  })

  test("app redirects to the spoofed host → reflected in Location", async () => {
    const sender: HttpSender = { send: async (req) => ({ status: 302, body: "", headers: { location: `https://${xfh(req)}/next` } }) }
    const obs = await probeHostHeader(sender, makeR(), sig(), 0, budget())
    expect(obs.reflected.some((r) => r.where === "location")).toBe(true)
  })

  test("safe app that ignores forwarding headers → nothing reflected", async () => {
    const sender: HttpSender = { send: async () => ({ status: 200, body: "reset link: https://example.com/reset", headers: {} }) }
    const obs = await probeHostHeader(sender, makeR(), sig(), 0, budget())
    expect(obs.reflected).toEqual([])
    expect(obs.tried).toBeGreaterThan(0)
  })

  test("blocked response → flagged", async () => {
    const sender: HttpSender = { send: async () => ({ status: 403, body: "no", headers: {} }) }
    const obs = await probeHostHeader(sender, makeR(), sig(), 0, budget())
    expect(obs.blocked).toBe(true)
    expect(obs.reflected).toEqual([])
  })

  test("respects the send budget", async () => {
    const sender: HttpSender = { send: async () => ({ status: 200, body: "ok", headers: {} }) }
    const b = budget(2)
    const obs = await probeHostHeader(sender, makeR(), sig(), 0, b)
    expect(obs.tried).toBeLessThanOrEqual(2)
    expect(b.sent).toBeLessThanOrEqual(2)
  })
})
