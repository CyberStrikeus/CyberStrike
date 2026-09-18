// The deterministic rule layer. Two rule shapes:
//   - Rule       : looks at ONE transaction (header hygiene, error signatures, reflection).
//   - CorpusRule : looks at the WHOLE corpus (cross-transaction / cross-identity — the pentest
//                  core: "endpoint reachable under A and B", auth-strip diffs, IDOR surface).
// Both emit Signals. Signals carry a `dedupKey` so the same finding on the same logical endpoint
// collapses to one instead of firing per request (the 100x banner noise).
import type { Transaction, Severity } from "./transaction"
import type { TrafficStore } from "./store"

// A per-transaction side-effecting hook a plugin registers to run over ingested traffic. Unlike a
// Rule (which returns Signals for the registry to collect), a hook is handed the store and a
// transaction and does its own work — it is the seam for imperative EXTRACTORS (e.g. the Enterprise
// jsmine miner: parse a JS body → write discovered endpoints/JS + secret signals). Core owns WHEN
// hooks run (see scan.ts `extract`); the plugin owns WHAT they do. Lets the free core invoke a paid
// extractor through an interface it owns, without importing the plugin (dependency inversion).
export type TransactionHook = (store: TrafficStore, tx: Transaction) => void

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

// Optional per-run context a corpus rule may use. `valueIndex` is a pre-built (or incrementally
// maintained) request-value index for value-reuse joins (chains), so a caller that maintains it does
// not force each chain to rebuild it over the whole corpus. Absent ⇒ the rule builds what it needs
// itself, preserving standalone behaviour. (#40 P1c)
export interface CorpusContext {
  valueIndex?: Map<string, Set<string>>
}

// A rule over the whole corpus — it receives every transaction and correlates across them.
export interface CorpusRule {
  id: string
  title: string
  category: string
  severity: Severity
  evaluate(txs: Transaction[], ctx?: CorpusContext): Signal[]
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
  private readonly hooks: TransactionHook[] = []

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
  registerHook(hook: TransactionHook): this {
    this.hooks.push(hook)
    return this
  }
  registerHookAll(hooks: TransactionHook[]): this {
    for (const h of hooks) this.registerHook(h)
    return this
  }
  list(): Rule[] {
    return [...this.rules]
  }
  listCorpus(): CorpusRule[] {
    return [...this.corpusRules]
  }
  listHooks(): TransactionHook[] {
    return [...this.hooks]
  }

  // Run every registered transaction hook over ONE transaction. A throwing hook is isolated so one
  // plugin's failure never breaks ingest or the other hooks. Side effects land in `store`.
  runHooks(store: TrafficStore, tx: Transaction): void {
    for (const hook of this.hooks) {
      try {
        hook(store, tx)
      } catch {
        // a hook must never break the pipeline — swallow and continue
      }
    }
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
  // `include` optionally restricts which corpus rules run (default: all) — used by callers that drive
  // some corpus rules incrementally (e.g. the bridge's AccessMatcher) and so must skip their batch twins
  // to avoid recomputing them. Existing callers pass nothing and get every corpus rule as before.
  analyzeCorpus(txs: Transaction[], include?: (rule: CorpusRule) => boolean, ctx?: CorpusContext): Signal[] {
    const out: Signal[] = []
    for (const rule of this.corpusRules) {
      if (include && !include(rule)) continue
      for (const sig of rule.evaluate(txs, ctx)) out.push(sig)
    }
    return dedupe(out)
  }
}
