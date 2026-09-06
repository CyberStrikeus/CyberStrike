import { describe, test, expect } from "bun:test"
import { probeXssPoint } from "../../../src/tool/inject-probe/probe/xss"
import type { HttpSender } from "../../../src/tool/inject-probe/send"
import type { ResolvedRequest, SendBudget, InjPoint, RegisterCanary } from "../../../src/tool/inject-probe/types"

const makeR = (): ResolvedRequest => ({
  method: "GET",
  url: new URL("http://example.com/page?id=1"),
  headers: {},
  body: "",
  contentType: "",
  auth: { source: "none" },
  provenance: { fromRaw: false, reconstructed: false, bodyMaybeTruncated: false },
})

const point: InjPoint = { location: "query", name: "id" }
const makeBudget = (max = 200): SendBudget => ({ sent: 0, max })

function reflectingSender(opts?: { block?: boolean; encodeTags?: boolean }): HttpSender {
  return {
    send: async (req) => {
      if (opts?.block) return { status: 403, body: "Forbidden", headers: {} }
      const u = new URL(req.url)
      const val = u.searchParams.get("id") ?? ""
      let body: string
      if (opts?.encodeTags) {
        body = `<html><body>${val.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</body></html>`
      } else {
        body = `<html><body>${val}</body></html>`
      }
      return { status: 200, body, headers: {} }
    },
  }
}

describe("probeXssPoint", () => {
  test("marker not reflected → early return, no tags", async () => {
    const sender: HttpSender = {
      send: async () => ({ status: 200, body: "no reflection here", headers: {} }),
    }
    const obs = await probeXssPoint(sender, makeR(), point, new AbortController().signal, 0, makeBudget())
    expect(obs.marker_reflected).toBe(false)
    expect(obs.surviving_tags).toEqual([])
    expect(obs.weaponized).toEqual([])
  })

  test("marker reflected → tag scanning fires", async () => {
    const sender = reflectingSender()
    const obs = await probeXssPoint(sender, makeR(), point, new AbortController().signal, 0, makeBudget())
    expect(obs.marker_reflected).toBe(true)
    expect(obs.surviving_tags.length).toBeGreaterThan(0)
    expect(obs.context).toBe("html-body")
  })

  test("tags html-encoded → no surviving tags", async () => {
    const sender = reflectingSender({ encodeTags: true })
    const obs = await probeXssPoint(sender, makeR(), point, new AbortController().signal, 0, makeBudget())
    expect(obs.marker_reflected).toBe(true)
    expect(obs.surviving_tags).toEqual([])
    expect(obs.marker_html_encoded).toBe(true)
  })

  test("blocked response → blocked=true", async () => {
    const sender = reflectingSender({ block: true })
    const obs = await probeXssPoint(sender, makeR(), point, new AbortController().signal, 0, makeBudget())
    expect(obs.blocked).toBe(true)
    expect(obs.note).toContain("baseline")
  })

  test("budget exhaustion stops early", async () => {
    const sender = reflectingSender()
    const budget = makeBudget(2)
    const obs = await probeXssPoint(sender, makeR(), point, new AbortController().signal, 0, budget)
    expect(budget.sent).toBeLessThanOrEqual(2)
  })

  test("abort signal stops early", async () => {
    const sender = reflectingSender()
    const ac = new AbortController()
    ac.abort()
    const obs = await probeXssPoint(sender, makeR(), point, ac.signal, 0, makeBudget())
    expect(obs.surviving_tags).toEqual([])
  })

  test("register callback is called with nonces", async () => {
    const sender = reflectingSender()
    const registered: { token: string; kind: string }[] = []
    const register: RegisterCanary = (token, kind) => registered.push({ token, kind })
    await probeXssPoint(sender, makeR(), point, new AbortController().signal, 0, makeBudget(), register)
    expect(registered.length).toBeGreaterThan(0)
    expect(registered[0]!.kind).toBe("reflect")
    for (const r of registered) {
      expect(r.token.startsWith("m")).toBe(true)
    }
  })

  test("reflected tags + weapons produce weaponized payloads", async () => {
    const sender = reflectingSender()
    const obs = await probeXssPoint(sender, makeR(), point, new AbortController().signal, 0, makeBudget())
    expect(obs.surviving_tags.length).toBeGreaterThan(0)
    expect(obs.weaponized.length).toBeGreaterThan(0)
    const hasXssOrReady = obs.weaponized.some((w) => w.includes("XSS") || w.includes("alert"))
    expect(hasXssOrReady).toBe(true)
  })
})
