// #40 P1c — a chain evaluated with the incrementally-maintained ChainValueIndex (passed via the corpus
// context) must produce EXACTLY the same signals as one that builds its own index. Proven over edge
// cases and seeded-random corpora. This is the guarantee that maintaining the join index at ingest
// (instead of rebuilding it per corpus run) loses nothing.
import { describe, expect, test } from "bun:test"
import type { Transaction, ChainRule, Signal } from "../src/index"
import { compileChain, ChainValueIndex } from "../src/index"

let n = 0
function req(url: string, status: number, body = "", identity?: string): Transaction {
  return {
    id: `t${n++}`,
    source: "browser",
    host: "app.test",
    identity,
    request: { method: "GET", url: `https://app.test${url}`, headers: [] },
    response: { status, headers: [{ name: "content-type", value: "application/json" }], body },
  }
}

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

const norm = (s: Signal[]) => s.map((x) => `${x.ruleId}|${x.transactionId}|${x.evidence}|${x.dedupKey}`).sort()

function assertSame(corpus: Transaction[]) {
  const selfBuilt = compileChain(reuseChain).evaluate(corpus)
  const idx = new ChainValueIndex()
  for (const t of corpus) idx.observe(t)
  const withMaintained = compileChain(reuseChain).evaluate(corpus, { valueIndex: idx.map() })
  expect(norm(withMaintained)).toEqual(norm(selfBuilt))
}

describe("chain with maintained index ≡ self-built index (#40 P1c)", () => {
  test("edge cases match exactly", () => {
    const TOK = "abc123def456abc789ef012"
    assertSame([])
    assertSame([req("/a", 200, JSON.stringify({ s: TOK }), "org1"), req(`/b?t=${TOK}`, 200, "", "org2")]) // hit
    assertSame([req("/a", 200, JSON.stringify({ s: TOK }), "org1"), req(`/b?t=${TOK}`, 200, "", "org1")]) // same identity → no chain
    assertSame([req("/a", 200, JSON.stringify({ s: TOK }), "org1"), req("/b?t=OTHER99999", 200, "", "org2")]) // different value
  })

  test("matches over seeded-random corpora", () => {
    const tokens = ["tokAAAA1111bbbb2222", "tokCCCC3333dddd4444", "tokEEEE5555ffff6666"]
    const idents: (string | undefined)[] = [undefined, "org1", "org2"]
    for (let seed = 1; seed <= 30; seed++) {
      let s = seed * 40503
      const rng = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
      const size = 1 + Math.floor(rng() * 30)
      const corpus: Transaction[] = []
      for (let i = 0; i < size; i++) {
        const tok = tokens[Math.floor(rng() * tokens.length)]!
        const identity = idents[Math.floor(rng() * idents.length)]
        const status = rng() < 0.8 ? 200 : 403
        // half expose the token in the response, half carry it in the request
        if (rng() < 0.5) corpus.push(req(`/r${i}`, status, JSON.stringify({ s: tok }), identity))
        else corpus.push(req(`/q${i}?t=${tok}`, status, "", identity))
      }
      assertSame(corpus)
    }
  })
})
