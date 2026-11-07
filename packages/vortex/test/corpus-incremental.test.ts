// #40 P1c — the incremental AccessMatcher must produce EXACTLY the same signals as the batch access
// CorpusRules (crossIdentityAccess + unauthenticatedReach). Proven by diffing batch vs incremental over
// hand-built edge cases AND many seeded-random corpora. This is the equivalence guarantee that makes
// "incremental, never re-scan" safe: if it ever diverges (drops or invents a finding), this fails.
import { describe, expect, test } from "bun:test"
import type { Transaction, Signal } from "../src/index"
import { crossIdentityAccess, unauthenticatedReach, AccessMatcher } from "../src/index"

let n = 0
function tx(url: string, status: number, identity?: string): Transaction {
  return {
    id: `t${n++}`,
    source: "browser",
    host: "app.test",
    identity,
    request: { method: "GET", url: `https://app.test${url}`, headers: [] },
    response: { status, headers: [], body: "" },
  }
}

function batch(corpus: Transaction[]): Signal[] {
  return [...crossIdentityAccess.evaluate(corpus), ...unauthenticatedReach.evaluate(corpus)]
}
function incremental(corpus: Transaction[]): Signal[] {
  const m = new AccessMatcher()
  for (const t of corpus) m.observe(t)
  return m.signals()
}
// Full-fidelity comparison: id, anchor tx, evidence, dedupKey — everything, order-independent.
const norm = (sigs: Signal[]) =>
  sigs
    .map((s) => `${s.ruleId}|${s.transactionId}|${s.severity}|${s.evidence}|${s.dedupKey}`)
    .sort()

function assertSame(corpus: Transaction[]) {
  expect(norm(incremental(corpus))).toEqual(norm(batch(corpus)))
}

describe("AccessMatcher ≡ batch access rules (#40 P1c)", () => {
  test("hand-built edge cases match exactly", () => {
    assertSame([])
    assertSame([tx("/a", 200, "org1")]) // single identity → nothing
    assertSame([tx("/a", 200, "org1"), tx("/a", 200, "org2")]) // cross-identity
    assertSame([tx("/a", 200, "org1"), tx("/a", 200)]) // authed + anon → cross-identity + unauth-reach
    assertSame([tx("/a", 403, "org1"), tx("/a", 403, "org2")]) // both failed → nothing
    assertSame([tx("/a", 200, "org1"), tx("/a", 200, "org1"), tx("/a", 200, "org1")]) // same identity ×N → nothing
    assertSame([
      tx("/a", 200), tx("/a", 200, "org1"), // anon first, then authed
      tx("/b", 200, "org1"), tx("/b", 200, "org2"), tx("/b", 200, "org3"),
      tx("/c", 500, "org1"),
    ])
  })

  test("matches over many seeded-random corpora", () => {
    const endpoints = ["/a", "/b", "/c", "/api/x", "/api/y"]
    const idents: (string | undefined)[] = [undefined, "org1", "org2", "org3"]
    for (let seed = 1; seed <= 40; seed++) {
      let s = seed * 2654435761
      const rng = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
      const size = 1 + Math.floor(rng() * 60)
      const corpus: Transaction[] = []
      for (let i = 0; i < size; i++) {
        const url = endpoints[Math.floor(rng() * endpoints.length)]!
        const identity = idents[Math.floor(rng() * idents.length)]
        const status = rng() < 0.7 ? 200 : 403
        corpus.push(tx(url, status, identity))
      }
      assertSame(corpus)
    }
  })
})
