import { describe, test, expect } from "bun:test"
import { runErrorProbe, type ErrResp } from "../../../src/tool/error-probe/probe"
import { errorVariants } from "../../../src/tool/error-probe/mutate"
import { HttpMessage } from "../../../src/replay/message"

describe("error-probe/probe — runErrorProbe", () => {
  test("marks a disclosure the baseline lacked as triggered", async () => {
    // Clean baseline; the malformed variant elicits a Python traceback.
    const send = async (msg: { tag: string }): Promise<ErrResp> => {
      if (msg.tag === "base") return { status: 200, body: "ok" }
      return { status: 500, body: 'Traceback (most recent call last):\n  File "/app/x.py", line 3' }
    }
    const run = await runErrorProbe(
      { baselineMsg: { tag: "base" }, variants: [{ name: "malformed-json", msg: { tag: "mut" } }] },
      send,
    )
    expect(run.baselineDisclosures).toHaveLength(0)
    expect(run.findings[0].triggered).toBe(true)
    expect(run.findings[0].disclosures.map((d) => d.kind)).toContain("error-python")
  })

  test("a leak already in the baseline is NOT counted as triggered", async () => {
    const leak = "Fatal error: boom in /var/www/x.php on line 1"
    const send = async (): Promise<ErrResp> => ({ status: 500, body: leak })
    const run = await runErrorProbe({ baselineMsg: { t: 0 }, variants: [{ name: "v", msg: { t: 1 } }] }, send)
    expect(run.baselineDisclosures.length).toBeGreaterThan(0)
    expect(run.findings[0].triggered).toBe(false) // same leak as baseline → not newly triggered
  })

  test("transport error on a variant is recorded, not thrown", async () => {
    const send = async (msg: { t: number }): Promise<ErrResp> => (msg.t === 0 ? { status: 200, body: "ok" } : { error: "timeout" })
    const run = await runErrorProbe({ baselineMsg: { t: 0 }, variants: [{ name: "v", msg: { t: 1 } }] }, send)
    expect(run.findings[0].error).toBe("timeout")
    expect(run.findings[0].triggered).toBe(false)
  })
})

describe("error-probe/mutate — errorVariants", () => {
  function parse(raw: string) {
    return HttpMessage.parse(raw)
  }

  test("JSON POST yields malformed-json, type-confusion, wrong-content-type, malformed-query", () => {
    const msg = parse('POST /api/x HTTP/1.1\r\nHost: h\r\nContent-Type: application/json\r\n\r\n{"a":1}')
    const names = errorVariants(msg).map((v) => v.name)
    expect(names).toEqual(["malformed-json", "type-confusion", "wrong-content-type", "malformed-query"])
    const swap = errorVariants(msg).find((v) => v.name === "type-confusion")!
    expect(new TextDecoder().decode(swap.msg.body)).toBe("[]") // object → array
  })

  test("GET with no body yields only malformed-query (safe for GET)", () => {
    const msg = parse("GET /search?q=1 HTTP/1.1\r\nHost: h\r\n\r\n")
    const vs = errorVariants(msg)
    expect(vs.map((v) => v.name)).toEqual(["malformed-query"])
    expect(vs[0].msg.target).toContain("%ZZ%")
    expect(vs[0].msg.target.startsWith("/search?q=1&")).toBe(true) // appended, not clobbered
  })
})
