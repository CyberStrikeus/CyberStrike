import { describe, test, expect } from "bun:test"
import { probeHppPoint } from "../../../src/tool/inject-probe/probe/hpp"
import { createBackoff } from "../../../src/tool/inject-probe/probe/base"
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

const queryPoint: InjPoint = { location: "query", name: "id" }
const makeBudget = (max = 50): SendBudget => ({ sent: 0, max })

function hppSender(mode: "first-wins" | "last-wins" | "both" | "none"): HttpSender {
  return {
    send: async (req) => {
      const u = new URL(req.url)
      const ids = u.searchParams.getAll("id")
      let body = "page content"
      if (ids.length === 1) {
        body = `result: ${ids[0]}`
      } else if (ids.length >= 2) {
        if (mode === "first-wins") body = `result: ${ids[0]}`
        else if (mode === "last-wins") body = `result: ${ids[1]}`
        else if (mode === "both") body = `result: ${ids[0]} and ${ids[1]}`
        else body = "result: merged"
      }
      return { status: 200, body, headers: {} }
    },
  }
}

describe("probeHppPoint", () => {
  test("non-query/form_field → early return with note", async () => {
    const sender: HttpSender = { send: async () => ({ status: 200, body: "ok", headers: {} }) }
    const headerPoint: InjPoint = { location: "header", name: "x-custom" }
    const obs = await probeHppPoint(sender, makeR(), headerPoint, new AbortController().signal, 0, makeBudget())
    expect(obs.parser_behavior).toBe("inconclusive")
    expect(obs.note).toContain("not applicable")
    expect(obs.note).toContain("header")
  })

  test("json_body returns not applicable", async () => {
    const sender: HttpSender = { send: async () => ({ status: 200, body: "ok", headers: {} }) }
    const jsonPoint: InjPoint = { location: "json_body", name: "field" }
    const obs = await probeHppPoint(sender, makeR(), jsonPoint, new AbortController().signal, 0, makeBudget())
    expect(obs.note).toContain("not applicable")
  })

  test("baseline blocked → early return", async () => {
    const sender: HttpSender = { send: async () => ({ status: 403, body: "Blocked", headers: {} }) }
    const obs = await probeHppPoint(sender, makeR(), queryPoint, new AbortController().signal, 0, makeBudget())
    expect(obs.blocked).toBe(true)
    expect(obs.parser_behavior).toBe("inconclusive")
  })

  test("last-wins: append reflected, prepend not", async () => {
    const sender = hppSender("last-wins")
    const obs = await probeHppPoint(sender, makeR(), queryPoint, new AbortController().signal, 0, makeBudget())
    expect(obs.append_reflected).toBe(true)
    expect(obs.prepend_reflected).toBe(false)
    expect(obs.parser_behavior).toBe("last-wins")
  })

  test("first-wins: prepend reflected, append not", async () => {
    const sender = hppSender("first-wins")
    const obs = await probeHppPoint(sender, makeR(), queryPoint, new AbortController().signal, 0, makeBudget())
    expect(obs.append_reflected).toBe(false)
    expect(obs.prepend_reflected).toBe(true)
    expect(obs.parser_behavior).toBe("first-wins")
  })

  test("both: both reflected", async () => {
    const sender = hppSender("both")
    const obs = await probeHppPoint(sender, makeR(), queryPoint, new AbortController().signal, 0, makeBudget())
    expect(obs.append_reflected).toBe(true)
    expect(obs.prepend_reflected).toBe(true)
    expect(obs.parser_behavior).toBe("both")
  })

  test("neither reflected → inconclusive with note", async () => {
    const sender = hppSender("none")
    const obs = await probeHppPoint(sender, makeR(), queryPoint, new AbortController().signal, 0, makeBudget())
    expect(obs.append_reflected).toBe(false)
    expect(obs.prepend_reflected).toBe(false)
    expect(obs.parser_behavior).toBe("inconclusive")
    expect(obs.note).toContain("neither")
  })

  test("blocked append → blocked=true with block_signal", async () => {
    let callIdx = 0
    const sender: HttpSender = {
      send: async (req) => {
        callIdx++
        if (callIdx === 1) return { status: 200, body: "baseline ok", headers: {} }
        return { status: 403, body: "Blocked", headers: {} }
      },
    }
    const obs = await probeHppPoint(sender, makeR(), queryPoint, new AbortController().signal, 0, makeBudget())
    expect(obs.blocked).toBe(true)
    expect(obs.block_signal).toBeDefined()
  })

  test("backoff integration: state updated on block and success", async () => {
    let callIdx = 0
    const sender: HttpSender = {
      send: async () => {
        callIdx++
        if (callIdx === 1) return { status: 200, body: "baseline", headers: {} }
        if (callIdx === 2) return { status: 403, body: "Blocked", headers: {} }
        return { status: 200, body: "ok", headers: {} }
      },
    }
    const backoff = createBackoff(0)
    await probeHppPoint(sender, makeR(), queryPoint, new AbortController().signal, 0, makeBudget(), undefined, backoff)
    expect(backoff.totalBlocks).toBeGreaterThanOrEqual(1)
    expect(backoff.delay).toBeGreaterThanOrEqual(500)
  })

  test("register callback called for each nonce", async () => {
    const sender = hppSender("last-wins")
    const registered: { token: string; kind: string }[] = []
    const register: RegisterCanary = (token, kind) => registered.push({ token, kind })
    await probeHppPoint(sender, makeR(), queryPoint, new AbortController().signal, 0, makeBudget(), register)
    expect(registered.length).toBeGreaterThanOrEqual(3)
    for (const r of registered) {
      expect(r.kind).toBe("reflect")
      expect(r.token.startsWith("m")).toBe(true)
    }
  })

  test("budget exhaustion stops before prepend phase", async () => {
    const sender = hppSender("both")
    const budget = makeBudget(2)
    const obs = await probeHppPoint(sender, makeR(), queryPoint, new AbortController().signal, 0, budget)
    expect(budget.sent).toBeLessThanOrEqual(2)
  })

  test("abort signal stops probe", async () => {
    const sender = hppSender("both")
    const ac = new AbortController()
    ac.abort()
    const obs = await probeHppPoint(sender, makeR(), queryPoint, ac.signal, 0, makeBudget())
    expect(obs.parser_behavior).toBe("inconclusive")
  })

  test("form_field location works with urlencoded body", async () => {
    const r: ResolvedRequest = {
      method: "POST",
      url: new URL("http://example.com/page"),
      headers: {},
      body: "user=admin&pass=secret",
      contentType: "application/x-www-form-urlencoded",
      auth: { source: "none" },
      provenance: { fromRaw: false, reconstructed: false, bodyMaybeTruncated: false },
    }
    const formPoint: InjPoint = { location: "form_field", name: "user" }
    const sender: HttpSender = {
      send: async (req) => {
        const body = req.body ?? ""
        const params = new URLSearchParams(body)
        const users = params.getAll("user")
        return { status: 200, body: `users: ${users.join(",")}`, headers: {} }
      },
    }
    const obs = await probeHppPoint(sender, r, formPoint, new AbortController().signal, 0, makeBudget())
    expect(obs.note === undefined || !obs.note.includes("not applicable")).toBe(true)
  })
})
