import { describe, test, expect } from "bun:test"
import { probeTimeBlindPoint } from "../../../src/tool/inject-probe/probe/time-blind"
import type { HttpSender } from "../../../src/tool/inject-probe/send"
import type { ResolvedRequest, SendBudget, InjPoint } from "../../../src/tool/inject-probe/types"

const makeR = (): ResolvedRequest => ({
  method: "GET",
  url: new URL("http://example.com/item?id=1"),
  headers: {},
  body: "",
  contentType: "",
  auth: { source: "none" },
  provenance: { fromRaw: false, reconstructed: false, bodyMaybeTruncated: false },
})
const point: InjPoint = { location: "query", name: "id" }
const budget = (max = 80): SendBudget => ({ sent: 0, max })
const sig = () => new AbortController().signal
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const D = 0.2 // test delay seconds (200ms), keeps the suite fast while exercising the real timing path

// The effective seconds a payload would sleep on a vulnerable server (conditional false → 0).
function delayOf(payload: string): number {
  const condFalse = payload.includes("1=2")
  let m = payload.match(/(?:SLEEP|pg_sleep)\(([\d.]+)\)/i) ?? payload.match(/WAITFOR DELAY '0:0:([\d.]+)'/i)
  if (m) return condFalse ? 0 : parseFloat(m[1]!)
  m = payload.match(/sleep\s+([\d.]+)/i)
  if (m) return parseFloat(m[1]!)
  return 0
}
const isSql = (v: string) => /SLEEP\(|pg_sleep|WAITFOR/i.test(v) // SQL sleep is a function call; cmd `; sleep N` is not

// A server vulnerable to the given families: it actually waits for the injected (effective) delay.
const vulnSender = (families: string[]): HttpSender => ({
  send: async (req) => {
    const v = new URL(req.url).searchParams.get("id") ?? ""
    let d = delayOf(v)
    if (d > 0 && ((isSql(v) && !families.includes("sqli")) || (!isSql(v) && !families.includes("cmd")))) d = 0
    if (d > 0) await wait(d * 1000)
    return { status: 200, body: "ok", headers: {} }
  },
})

describe("probeTimeBlindPoint (WSTG-INPV-05/12 blind time-based)", () => {
  test("delay scales AND both controls stay fast → confirmed (blind SQLi)", async () => {
    const obs = await probeTimeBlindPoint(vulnSender(["sqli"]), makeR(), point, sig(), 0, budget(), undefined, D)
    expect(obs.findings.length).toBeGreaterThan(0)
    const f = obs.findings[0]!
    expect(f.family).toBe("sqli")
    expect(f.observed_delta_ms).toBeGreaterThan(D * 1000 * 0.6) // materialized > 60% of the injected delay
    expect(f.conditional_confirmed).toBe(true) // false-condition control stayed fast
  }, 15000)

  test("command family confirmed independently", async () => {
    const obs = await probeTimeBlindPoint(vulnSender(["cmd"]), makeR(), point, sig(), 0, budget(), undefined, D)
    expect(obs.findings.some((f) => f.family === "cmd")).toBe(true)
  }, 15000)

  test("a non-delaying (safe) server → nothing confirmed", async () => {
    const safe: HttpSender = { send: async () => ({ status: 200, body: "ok", headers: {} }) }
    const obs = await probeTimeBlindPoint(safe, makeR(), point, sig(), 0, budget(), undefined, D)
    expect(obs.findings).toEqual([])
    expect(obs.tried).toBeGreaterThan(0) // it DID probe — not a skip
  }, 15000)

  test("a UNIFORMLY SLOW server (always slow, not injection) → NO false positive", async () => {
    const slow: HttpSender = {
      send: async () => {
        await wait(150) // every response is slow, regardless of payload
        return { status: 200, body: "ok", headers: {} }
      },
    }
    const obs = await probeTimeBlindPoint(slow, makeR(), point, sig(), 0, budget(), undefined, D)
    expect(obs.findings).toEqual([]) // baseline is ~150ms too → the injected payload adds no DELTA
  }, 15000)
})
