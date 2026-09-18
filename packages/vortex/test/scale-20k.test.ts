// #40 P2 — REAL scale proof: 20 000 rules × 20 000 requests. Two things must hold, and both are tests:
//   1. COMPLETENESS: for every transaction, the prefiltered run() returns EXACTLY what runAll() (every
//      rule) returns — no endpoint ever skips a rule that would fire. (run ⊆ runAll always; equality ⇒
//      nothing lost.)
//   2. SCALE: the prefiltered pass over all 20k requests is far cheaper than evaluating every rule.
import { describe, expect, test } from "bun:test"
import type { Transaction, Signal, DeclarativeRule } from "../src/index"
import { RuleRegistry, compileRules } from "../src/index"

const RULES = 20_000
const TXS = 20_000

// A realistic-ish rule mix: mostly a required literal (contains), some regex signatures, a few fail-open
// comparisons (no prunable literal → always run). Each rule's marker is derivable from its index.
function makeRules(): DeclarativeRule[] {
  const out: DeclarativeRule[] = []
  for (let i = 0; i < RULES; i++) {
    const base = { id: `r${i}`, category: "t", severity: "info" as const, message: `fired ${i}` }
    if (i % 50 === 0) out.push({ ...base, when: `resp.status == ${500 + (i % 50)}` }) // ~2% fail-open
    else if (i % 7 === 0) out.push({ ...base, when: `regex("SIG${i}Z[0-9]{2}", resp.body)` })
    else out.push({ ...base, when: `contains(resp.body, "MK${i}Q")` })
  }
  return out
}
const isContainsRule = (i: number) => i % 50 !== 0 && i % 7 !== 0

let n = 0
function tx(body: string, status = 200): Transaction {
  return {
    id: `t${n++}`,
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: "https://app.test/x", headers: [] },
    response: { status, headers: [{ name: "content-type", value: "text/html" }], body },
  }
}

// Each request embeds a few real rule markers among noise, so a handful of the 20k rules fire on it.
function makeTxs(): Transaction[] {
  const out: Transaction[] = []
  for (let t = 0; t < TXS; t++) {
    const parts: string[] = ["ordinary page content"]
    for (let k = 0; k < 3; k++) {
      let i = (t * 7 + k * 3001) % RULES
      if (!isContainsRule(i)) i = (i + 1) % RULES // steer toward a contains rule so it actually fires
      if (isContainsRule(i)) parts.push(`MK${i}Q`)
    }
    if (t % 5 === 0) parts.push(`SIG${(t * 11) % RULES}Z42`)
    out.push(tx(parts.join(" ... "), t % 4 === 0 ? 500 + (t % 50) : 200))
  }
  return out
}

const norm = (s: Signal[]) => s.map((x) => x.ruleId).sort()

const registry = new RuleRegistry().registerAll(compileRules(makeRules()))
const txs = makeTxs()

describe("20k rules × 20k requests (#40 P2)", () => {
  test("registry holds 20k rules", () => {
    expect(registry.list().length).toBe(RULES)
  })

  test(
    "COMPLETENESS: prefiltered run() ≡ runAll() for a broad sample — no rule ever skipped",
    () => {
      let checked = 0
      for (let i = 0; i < TXS; i += 130) {
        expect(norm(registry.run(txs[i]!)).join(",")).toBe(norm(registry.runAll(txs[i]!)).join(","))
        checked++
      }
      expect(checked).toBeGreaterThan(100)
    },
    30_000,
  )

  test("a request's embedded markers all fire (positive detection at scale)", () => {
    // pick 5 known contains-rule indices, embed their markers, assert every one fires
    const ids: string[] = []
    const parts: string[] = ["noise"]
    let i = 12345
    while (ids.length < 5) {
      if (isContainsRule(i)) {
        parts.push(`MK${i}Q`)
        ids.push(`r${i}`)
      }
      i++
    }
    const fired = new Set(registry.run(tx(parts.join(" "))).map((s) => s.ruleId))
    for (const id of ids) expect(fired.has(id)).toBe(true)
  })

  test(
    "SCALE: prefiltered pass over 20k requests is far cheaper than evaluating every rule",
    () => {
      registry.run(txs[0]!) // warm the prefilter build
      const t0 = performance.now()
      let total = 0
      for (const t of txs) total += registry.run(t).length
      const prefilteredMs = performance.now() - t0

      const SUB = 200
      const t1 = performance.now()
      for (let i = 0; i < SUB; i++) registry.runAll(txs[i]!)
      const unfilteredFullMs = ((performance.now() - t1) * TXS) / SUB

      // eslint-disable-next-line no-console
      console.log(
        `20k×20k — prefiltered: ${prefilteredMs.toFixed(0)}ms for all ${TXS} reqs; ` +
          `unfiltered (all rules): ~${unfilteredFullMs.toFixed(0)}ms (${(unfilteredFullMs / prefilteredMs).toFixed(1)}× more); ` +
          `signals=${total}`,
      )
      expect(prefilteredMs).toBeLessThan(unfilteredFullMs)
    },
    30_000,
  )
})
