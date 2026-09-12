// The deterministic rule layer. Two rule shapes:
//   - Rule       : looks at ONE transaction (header hygiene, error signatures, reflection).
//   - CorpusRule : looks at the WHOLE corpus (cross-transaction / cross-identity — the pentest
//                  core: "endpoint reachable under A and B", auth-strip diffs, IDOR surface).
// Both emit Signals. Signals carry a `dedupKey` so the same finding on the same logical endpoint
// collapses to one instead of firing per request (the 100x banner noise).
import type { Transaction, Severity } from "./transaction"

// When a signal was produced by probing a specific input, the exact parameter it fired on — so a
// lead hands the agent the precise injection point structurally, not just prose in `evidence`.
export interface SignalParam {
  location: "query" | "body" | "path" | "header"
  dotpath: string
  name?: string
}

export interface Signal {
  ruleId: string
  transactionId: string
  severity: Severity
  category: string
  title: string
  evidence?: string
  // The exact parameter this fired on, when the signal came from probing an inject point (issue #9).
  // Absent for passive/corpus signals that aren't parameter-scoped.
  param?: SignalParam
  // Identity for de-duplication. Two signals with the same dedupKey are the same finding; the
  // registry keeps the first. A rule that wants endpoint-level (not instance-level) dedup sets it
  // to something like `${ruleId}:${endpointKey}`. Left unset ⇒ deduped per (ruleId, tx, title).
  dedupKey?: string
}

export interface Rule {
  id: string
  title: string
  category: string
  severity: Severity
  // Pure + deterministic. Return [] when it does not fire; no-op when a needed response is absent.
  evaluate(tx: Transaction): Signal[]
}

// A rule over the whole corpus — it receives every transaction and correlates across them.
export interface CorpusRule {
  id: string
  title: string
  category: string
  severity: Severity
  evaluate(txs: Transaction[]): Signal[]
}

// Keep the first signal per dedupKey. Signals without one fall back to a per-(rule,tx,title) key,
// so a rule firing twice identically on one transaction still collapses.
export function dedupe(signals: Signal[]): Signal[] {
  const seen = new Set<string>()
  const out: Signal[] = []
  for (const s of signals) {
    const key = s.dedupKey ?? `${s.ruleId}:${s.transactionId}:${s.title}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

export class RuleRegistry {
  private readonly rules: Rule[] = []
  private readonly corpusRules: CorpusRule[] = []

  register(rule: Rule): this {
    this.rules.push(rule)
    return this
  }
  registerAll(rules: Rule[]): this {
    for (const r of rules) this.register(r)
    return this
  }
  registerCorpus(rule: CorpusRule): this {
    this.corpusRules.push(rule)
    return this
  }
  registerCorpusAll(rules: CorpusRule[]): this {
    for (const r of rules) this.registerCorpus(r)
    return this
  }
  list(): Rule[] {
    return [...this.rules]
  }
  listCorpus(): CorpusRule[] {
    return [...this.corpusRules]
  }

  // Every per-transaction rule over ONE transaction (raw, not deduped — one tx can't self-collide
  // meaningfully, and callers streaming per-tx want the raw hits).
  run(tx: Transaction): Signal[] {
    const out: Signal[] = []
    for (const rule of this.rules) for (const sig of rule.evaluate(tx)) out.push(sig)
    return out
  }

  // The main entry: run per-transaction rules over EVERY transaction AND corpus rules over the
  // whole set, then dedup. This is what turns a body of traffic into a clean signal set.
  analyze(txs: Transaction[]): Signal[] {
    const out: Signal[] = []
    for (const tx of txs) for (const sig of this.run(tx)) out.push(sig)
    for (const rule of this.corpusRules) for (const sig of rule.evaluate(txs)) out.push(sig)
    return dedupe(out)
  }

  // Run ONLY the corpus (cross-transaction) rules over the whole set, deduped. Per-transaction rules
  // are captured incrementally at ingest (run(tx) per hit), so a read path that needs the
  // cross-transaction findings — access-control, chains, aggregate "one finding, many URLs" — gets
  // them here WITHOUT re-running every per-tx rule over the whole corpus again.
  analyzeCorpus(txs: Transaction[]): Signal[] {
    const out: Signal[] = []
    for (const rule of this.corpusRules) for (const sig of rule.evaluate(txs)) out.push(sig)
    return dedupe(out)
  }
}
