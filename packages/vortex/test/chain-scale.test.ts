// #40 P1 — the value-reuse join is index-driven, not an O(txs^steps) scan. A real leak→reuse chain
// must still be found when buried in thousands of unrelated transactions, and it must complete fast
// (the naive all-pairs version parses every request against every other and would not).
import { describe, expect, test } from "bun:test"
import type { Transaction, ChainRule } from "../src/index"
import { compileChain } from "../src/index"

let n = 0
function req(method: string, url: string, status: number, body = "", identity?: string): Transaction {
  return {
    id: `t${n++}`,
    source: "browser",
    host: "app.test",
    identity,
    request: { method, url: `https://app.test${url}`, headers: [] },
    response: { status, headers: [{ name: "content-type", value: "application/json" }], body },
  }
}

// A value from owner's response (200, identity A) reused in attacker's request (200, identity B).
const reuseChain: ChainRule = {
  id: "cross-identity-value-reuse",
  category: "access-control",
  severity: "high",
  steps: [
    { as: "owner", when: "resp.status == 200" },
    { as: "attacker", when: "resp.status == 200", reuses: "owner" },
  ],
  distinctIdentity: true,
  message: "value {shared} from {owner.endpoint} reused at {attacker.endpoint}",
}

const TOKEN = "abc123def456abc789ef012" // 24 chars, letters+digits → correlatable

describe("chain value-reuse join at scale (#40 P1)", () => {
  test("finds the real reuse chain buried in thousands of unrelated transactions, quickly", () => {
    const corpus: Transaction[] = []
    // owner leaks a correlatable value in its response
    corpus.push(req("GET", "/api/account", 200, JSON.stringify({ session: TOKEN }), "userA"))
    // 3000 unrelated transactions — no correlatable values, so they never share (never candidates)
    for (let i = 0; i < 3000; i++) corpus.push(req("GET", `/n/${i}`, 200, "{}"))
    // attacker reuses the leaked value in its request, under a DIFFERENT identity
    corpus.push(req("GET", `/api/other?s=${TOKEN}`, 200, "{}", "userB"))

    const started = Date.now()
    const sigs = compileChain(reuseChain).evaluate(corpus)
    const elapsed = Date.now() - started

    // correctness at scale: the chain is found among the noise
    const hit = sigs.find((s) => s.dedupKey?.includes("/api/account") && s.dedupKey?.includes("/api/other"))
    expect(hit).toBeDefined()
    expect(hit!.severity).toBe("high")
    expect(hit!.title).toContain(TOKEN)

    // performance: index-driven, not O(n^2) request parsing. Generous bound — the indexed path is a
    // few ms here; the all-pairs parse over ~3000 txs would be far slower.
    expect(elapsed).toBeLessThan(1500)
  })

  test("no false chain when nothing is actually reused, even at scale", () => {
    const corpus: Transaction[] = []
    // owner leaks a value, but no request ever carries it
    corpus.push(req("GET", "/api/account", 200, JSON.stringify({ session: TOKEN }), "userA"))
    for (let i = 0; i < 2000; i++) corpus.push(req("GET", `/n/${i}?q=${i}`, 200, "{}", "userB"))
    const sigs = compileChain(reuseChain).evaluate(corpus)
    expect(sigs).toHaveLength(0)
  })
})
