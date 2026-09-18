// Multi-pattern presence scan for the sound rule pre-filter (#40 P2). One Aho-Corasick automaton is
// built over every rule literal; a single linear pass over a transaction's raw text yields the set of
// literals present — cost independent of the number of rules, which is what lets tens of thousands of
// rules run without evaluating every one. `satisfiable` then decides, per rule, whether its precondition
// COULD hold given the present literals; only satisfiable (and unconditional / precondition-less) rules
// are evaluated. Skipping is sound: a rule pruned here provably cannot match (a required literal absent).
import type { Transaction } from "./transaction"
import type { Precondition } from "./precondition"

export class LiteralScanner {
  private readonly gotoMap: Map<string, number>[] = [new Map()]
  private readonly fail: number[] = [0]
  private readonly output: Set<string>[] = [new Set()]

  constructor(literals: Iterable<string>) {
    for (const lit of literals) {
      if (!lit) continue
      let node = 0
      for (const ch of lit) {
        let next = this.gotoMap[node]!.get(ch)
        if (next === undefined) {
          next = this.gotoMap.length
          this.gotoMap.push(new Map())
          this.fail.push(0)
          this.output.push(new Set())
          this.gotoMap[node]!.set(ch, next)
        }
        node = next
      }
      this.output[node]!.add(lit)
    }
    // BFS to build failure links; merge output along them.
    const queue: number[] = []
    for (const [, n] of this.gotoMap[0]!) queue.push(n) // depth-1 nodes fail to root (0)
    let qi = 0
    while (qi < queue.length) {
      const node = queue[qi++]!
      for (const [ch, next] of this.gotoMap[node]!) {
        queue.push(next)
        let f = this.fail[node]!
        while (f > 0 && !this.gotoMap[f]!.has(ch)) f = this.fail[f]!
        const target = this.gotoMap[f]!.get(ch)
        this.fail[next] = target !== undefined && target !== next ? target : 0
        for (const o of this.output[this.fail[next]!]!) this.output[next]!.add(o)
      }
    }
  }

  // The subset of indexed literals occurring in `haystack` (already lowercased by the caller).
  present(haystack: string): Set<string> {
    const found = new Set<string>()
    let node = 0
    for (const ch of haystack) {
      while (node > 0 && !this.gotoMap[node]!.has(ch)) node = this.fail[node]!
      node = this.gotoMap[node]!.get(ch) ?? 0
      const out = this.output[node]!
      if (out.size) for (const o of out) found.add(o)
    }
    return found
  }
}

// A per-registry rule pre-filter: an Aho-Corasick scanner over all rule literals PLUS a reverse index
// (literal → the rules that require it), so selecting the rules to evaluate for a transaction is
// O(present literals + always-run rules) — independent of the total rule count. That is what lets 20k+
// rules run per transaction. Sound: a rule is a candidate only via `always` (fail-open) or by having a
// present literal AND a satisfiable precondition; a rule whose required literal is absent is never a
// candidate — and it provably could not have matched.
export class RulePrefilter {
  private readonly scanner: LiteralScanner
  private readonly byLiteral = new Map<string, number[]>() // literal → indices of rules that reference it
  private readonly always: number[] = [] // indices of rules with no prunable precondition (always run)
  private readonly pre: (Precondition | undefined)[]

  constructor(rules: { precondition?: Precondition }[]) {
    this.pre = rules.map((r) => r.precondition)
    const lits = new Set<string>()
    rules.forEach((r, i) => {
      const p = r.precondition
      if (!p || p.kind === "unconditional") {
        this.always.push(i)
        return
      }
      const rl = literalsOf(p)
      if (rl.length === 0) {
        this.always.push(i) // defensive: a precondition with no literal can't prune
        return
      }
      for (const l of rl) {
        lits.add(l)
        const arr = this.byLiteral.get(l)
        if (arr) arr.push(i)
        else this.byLiteral.set(l, [i])
      }
    })
    this.scanner = new LiteralScanner(lits)
  }

  // The rule indices to evaluate for `haystack` (lowercased), in ascending order so the output matches
  // an unfiltered pass. = always-run rules ∪ rules with a present literal whose full precondition holds.
  candidates(haystack: string): number[] {
    const present = this.scanner.present(haystack)
    const set = new Set<number>(this.always)
    for (const lit of present) {
      const rs = this.byLiteral.get(lit)
      if (!rs) continue
      for (const i of rs) if (!set.has(i) && satisfiable(this.pre[i]!, present)) set.add(i)
    }
    return [...set].sort((a, b) => a - b)
  }
}

// Can this precondition hold given the set of present literals? Unconditional always can (fail-open).
export function satisfiable(pre: Precondition, present: Set<string>): boolean {
  if (pre.kind === "unconditional") return true
  if (pre.kind === "any") return pre.literals.some((l) => present.has(l))
  return pre.parts.every((p) => satisfiable(p, present))
}

// Every literal referenced by a precondition (for building the scanner).
export function literalsOf(pre: Precondition, out: string[] = []): string[] {
  if (pre.kind === "any") out.push(...pre.literals)
  else if (pre.kind === "all") for (const p of pre.parts) literalsOf(p, out)
  return out
}

// The lowercased raw text of a transaction that the scan runs over — a SUPERSET of every raw field a
// precondition can reference (request line + headers + body, response status + headers + body), so
// "present in this haystack" is never stricter than "present in the actual subject".
export function haystackOf(tx: Transaction): string {
  const parts: string[] = [tx.request.method, tx.request.url]
  for (const h of tx.request.headers) parts.push(h.name, h.value)
  if (tx.request.body) parts.push(tx.request.body)
  if (tx.response) {
    parts.push(String(tx.response.status))
    for (const h of tx.response.headers) parts.push(h.name, h.value)
    if (tx.response.body) parts.push(tx.response.body)
  }
  return parts.join("\n").toLowerCase()
}
