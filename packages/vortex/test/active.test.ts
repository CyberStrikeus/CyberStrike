import { describe, expect, test } from "bun:test"
import type { Transaction, SendResult, Sender } from "../src/index"
import { authStrip, runActiveRules } from "../src/index"

let n = 0
function tx(path: string, status: number, headers: { name: string; value: string }[]): Transaction {
  return {
    id: `t${n++}`,
    source: "browser",
    host: "app.test",
    identity: "org1",
    request: { method: "GET", url: `https://app.test${path}`, headers },
    response: { status, headers: [] },
  }
}

// A sender that records the requests it was asked to send and returns a chosen status. No network.
function sender(status: number): { send: Sender; calls: (Transaction | unknown)[] } {
  const calls: unknown[] = []
  const send: Sender = async (input, opts) => {
    calls.push({ input, opts })
    const result = { response: { version: "HTTP/1.1", status, reason: "", headers: [], body: new Uint8Array() }, timing: { totalMs: 1 }, attempts: 1 }
    return { transaction: input as Transaction, result } as SendResult
  }
  return { send, calls }
}

describe("auth-strip active rule", () => {
  test("fires HIGH when a stripped request still returns 2xx (auth not enforced)", async () => {
    const s = sender(200) // server STILL says 200 without creds → vulnerable
    const sigs = await authStrip.probe([tx("/api/secret", 200, [{ name: "authorization", value: "Bearer x" }])], s.send)
    expect(sigs).toHaveLength(1)
    expect(sigs[0].severity).toBe("high")
    expect(sigs[0].evidence).toContain("authorization")
    // it stripped the auth header before sending
    const opts = (s.calls[0] as { opts: { mutations: { op: string; name: string }[] } }).opts
    expect(opts.mutations).toEqual([{ op: "remove-header", name: "authorization" }])
  })

  test("no signal when the stripped request is rejected (401)", async () => {
    const s = sender(401)
    const sigs = await authStrip.probe([tx("/api/secret", 200, [{ name: "authorization", value: "Bearer x" }])], s.send)
    expect(sigs).toHaveLength(0)
  })

  test("skips endpoints with no credentials, and probes each endpoint once", async () => {
    const s = sender(200)
    const sigs = await authStrip.probe(
      [
        tx("/public", 200, []), // no creds → skipped
        tx("/api/x", 200, [{ name: "x-api-key", value: "k" }]),
        tx("/api/x", 200, [{ name: "x-api-key", value: "k2" }]), // same endpoint → probed once
      ],
      s.send,
    )
    expect(s.calls).toHaveLength(1) // only the one endpoint probed
    expect(sigs).toHaveLength(1)
  })

  test("runActiveRules collects + dedups", async () => {
    const s = sender(200)
    const sigs = await runActiveRules([authStrip], [tx("/api/y", 200, [{ name: "authorization", value: "t" }])], s.send)
    expect(sigs.map((x) => x.ruleId)).toEqual(["auth-strip"])
  })
})
