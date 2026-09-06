import { describe, test, expect } from "bun:test"
import { probeErrorSigPoint } from "../../../src/tool/inject-probe/probe/errsig"
import type { HttpSender } from "../../../src/tool/inject-probe/send"
import type { ResolvedRequest, SendBudget, InjPoint } from "../../../src/tool/inject-probe/types"

const makeR = (): ResolvedRequest => ({
  method: "GET",
  url: new URL("http://example.com/search?q=test"),
  headers: {},
  body: "",
  contentType: "",
  auth: { source: "none" },
  provenance: { fromRaw: false, reconstructed: false, bodyMaybeTruncated: false },
})

const point: InjPoint = { location: "query", name: "q" }
const makeBudget = (max = 500): SendBudget => ({ sent: 0, max })

function makeErrSigSender(opts?: {
  baselineBody?: string
  errorPayloads?: Set<string>
  errorBody?: string
  trueBoolBody?: string
  falseBoolBody?: string
}): HttpSender {
  const baselineBody = opts?.baselineBody ?? "normal page content"
  const errorPayloads = opts?.errorPayloads ?? new Set(["'", '"'])
  const errorBody = opts?.errorBody ?? 'You have an error in your SQL syntax near "\'"'
  const trueBoolBody = opts?.trueBoolBody ?? baselineBody
  const falseBoolBody = opts?.falseBoolBody ?? baselineBody
  return {
    send: async (req) => {
      const u = new URL(req.url)
      const val = u.searchParams.get("q") ?? ""
      if (errorPayloads.has(val)) {
        return { status: 200, body: errorBody, headers: {} }
      }
      if (val.includes("AND") || val.includes("OR")) {
        const isTrueCase = val.includes("'1'='1") || val.includes('"1"="1') || val.includes("1=1")
        return { status: 200, body: isTrueCase ? trueBoolBody : falseBoolBody, headers: {} }
      }
      return { status: 200, body: baselineBody, headers: {} }
    },
  }
}

describe("probeErrorSigPoint", () => {
  test("detects SQL error signatures", async () => {
    const sender = makeErrSigSender()
    const obs = await probeErrorSigPoint(sender, makeR(), point, "sqli", new AbortController().signal, 0, makeBudget())
    expect(obs.error_findings.length).toBeGreaterThan(0)
    const first = obs.error_findings[0]!
    expect(first.snippet).toContain("SQL syntax")
  })

  test("boolean differential detected when true/false differ in bytes", async () => {
    const baseBody = "a".repeat(100)
    const sender = makeErrSigSender({
      baselineBody: baseBody,
      errorPayloads: new Set(),
      trueBoolBody: baseBody,
      falseBoolBody: "b".repeat(50),
    })
    const obs = await probeErrorSigPoint(sender, makeR(), point, "sqli", new AbortController().signal, 0, makeBudget())
    const diffs = obs.bool_findings.filter((b) => b.differential)
    expect(diffs.length).toBeGreaterThan(0)
    expect(diffs[0]!.signals).toContain("bytes")
  })

  test("no differential when true/false have same size", async () => {
    const body = "a".repeat(100)
    const sender = makeErrSigSender({
      baselineBody: body,
      errorPayloads: new Set(),
      trueBoolBody: body,
      falseBoolBody: body,
    })
    const obs = await probeErrorSigPoint(sender, makeR(), point, "sqli", new AbortController().signal, 0, makeBudget())
    const diffs = obs.bool_findings.filter((b) => b.differential)
    expect(diffs).toEqual([])
  })

  test("baseline blocked → early return with block note", async () => {
    const sender: HttpSender = {
      send: async () => ({ status: 403, body: "Blocked", headers: {} }),
    }
    const obs = await probeErrorSigPoint(sender, makeR(), point, "sqli", new AbortController().signal, 0, makeBudget())
    expect(obs.blocked).toBe(true)
    expect(obs.note).toContain("blocked")
    expect(obs.error_findings).toEqual([])
    expect(obs.bool_findings).toEqual([])
  })

  test("baseline error → early return", async () => {
    const sender: HttpSender = {
      send: async () => ({ error: "ETIMEDOUT" }),
    }
    const obs = await probeErrorSigPoint(sender, makeR(), point, "sqli", new AbortController().signal, 0, makeBudget())
    expect(obs.blocked).toBe(false)
    expect(obs.note).toContain("failed")
    expect(obs.block_signal).toContain("timeout")
  })

  test("block signal on boolean pair is noted, not crashed", async () => {
    let callIdx = 0
    const sender: HttpSender = {
      send: async () => {
        callIdx++
        if (callIdx <= 2) return { status: 200, body: "a".repeat(100), headers: {} }
        if (callIdx % 3 === 0) return { status: 403, body: "Blocked", headers: {} }
        return { status: 200, body: "a".repeat(100), headers: {} }
      },
    }
    const obs = await probeErrorSigPoint(sender, makeR(), point, "sqli", new AbortController().signal, 0, makeBudget())
    expect(obs.block_signal).toBeDefined()
  })

  test("nosql error signature detected", async () => {
    const sender: HttpSender = {
      send: async (req) => {
        const u = new URL(req.url)
        const val = u.searchParams.get("q") ?? ""
        if (val === "'" || val === '"' || val === "\\") {
          return { status: 200, body: "MongoError: failed to parse", headers: {} }
        }
        return { status: 200, body: "normal", headers: {} }
      },
    }
    const obs = await probeErrorSigPoint(sender, makeR(), point, "nosql", new AbortController().signal, 0, makeBudget())
    expect(obs.error_findings.length).toBeGreaterThan(0)
    expect(obs.error_findings[0]!.snippet).toContain("MongoError")
  })

  test("sqli baseline byte jitter is recorded", async () => {
    const sender = makeErrSigSender({ errorPayloads: new Set() })
    const obs = await probeErrorSigPoint(sender, makeR(), point, "sqli", new AbortController().signal, 0, makeBudget())
    expect(obs.baseline.byte_jitter).toBeGreaterThanOrEqual(0)
    expect(obs.baseline.status).toBe(200)
  })
})
