// #40 — active neighbour-ID (BOLA/IDOR) probe. Re-sends id±N under the same creds and flags a
// neighbour that returns a DISTINCT object, using a control (a non-existent id) to suppress apps that
// serve one uniform 200 shell for every id. No network — a stub sender models the target per id.
import { describe, expect, test } from "bun:test"
import type { Transaction, SendResult, Sender } from "../src/index"
import { numericIdNeighbor } from "../src/index"

const enc = new TextEncoder()
let n = 0
function tx(url: string, status = 200): Transaction {
  return {
    id: `t${n++}`,
    source: "browser",
    host: "app.test",
    identity: "org1",
    request: { method: "GET", url: `https://app.test${url}`, headers: [] },
    response: { status, headers: [] },
  }
}

// A stub sender that reads the mutated path-param id from the send mutations and returns the modelled
// object for it — so a test controls the target's response per id with no network.
function appSender(objectFor: (id: number) => { status: number; body: string }): Sender {
  return async (input, opts) => {
    const value = (opts as { mutations?: { value?: string }[] } | undefined)?.mutations?.[0]?.value
    const id = Number.parseInt(value ?? "", 10)
    const { status, body } = objectFor(id)
    const result = {
      response: { version: "HTTP/1.1", status, reason: "", headers: [], body: enc.encode(body) },
      timing: { totalMs: 1 },
      attempts: 1,
    }
    return { transaction: input as Transaction, result } as SendResult
  }
}

describe("numeric-id-neighbor active BOLA probe (#40)", () => {
  test("flags a neighbour id that returns a DISTINCT object under the same credentials", async () => {
    // ids 1000-1010 are distinct objects; everything else is 404
    const send = appSender((id) => (id >= 1000 && id <= 1010 ? { status: 200, body: `{"id":${id},"owner":"u${id}"}` } : { status: 404, body: "not found" }))
    const sigs = await numericIdNeighbor.probe([tx("/api/account/1005")], send)
    expect(sigs).toHaveLength(1)
    expect(sigs[0].severity).toBe("medium")
    expect(sigs[0].category).toBe("access-control")
    expect(sigs[0].evidence).toMatch(/1005 → 100[46]/) // nearest neighbour (1006 first, then 1004)
  })

  test("NO false positive when the app serves one 200 shell for every id (SPA)", async () => {
    const send = appSender(() => ({ status: 200, body: "<html>app shell</html>" }))
    const sigs = await numericIdNeighbor.probe([tx("/api/account/1005")], send)
    expect(sigs).toHaveLength(0)
  })

  test("control differential: neighbours returning the uniform 200 'denied' shell are suppressed", async () => {
    // our object is distinct; every OTHER id returns a uniform 200 access-denied body (== the control)
    const send = appSender((id) => (id === 1005 ? { status: 200, body: `{"id":1005,"secret":true}` } : { status: 200, body: `{"error":"access denied"}` }))
    const sigs = await numericIdNeighbor.probe([tx("/api/account/1005")], send)
    expect(sigs).toHaveLength(0)
  })

  test("NO signal when neighbours are all 404 (no sibling objects)", async () => {
    const send = appSender((id) => (id === 1005 ? { status: 200, body: `{"id":1005}` } : { status: 404, body: "nf" }))
    const sigs = await numericIdNeighbor.probe([tx("/api/account/1005")], send)
    expect(sigs).toHaveLength(0)
  })

  test("one probe per (endpoint, path-param)", async () => {
    const send = appSender((id) => (id >= 1000 && id <= 1010 ? { status: 200, body: `obj${id}` } : { status: 404, body: "nf" }))
    const sigs = await numericIdNeighbor.probe([tx("/api/account/1005"), tx("/api/account/1006")], send)
    expect(sigs).toHaveLength(1) // same logical endpoint → probed once
  })
})
