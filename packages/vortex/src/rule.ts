// The deterministic rule layer. A Rule looks at a Transaction and emits zero or more Signals —
// no LLM, no agent initiative. This is the piece that guarantees the BASICS (missing headers,
// weak cookies, banners, error signatures) are caught on EVERY transaction, so agents are left to
// verify/exploit pre-surfaced candidates instead of discovering them by luck.
import type { Transaction, Severity } from "./transaction"

// A finding candidate produced by a rule. Deliberately lightweight: it points AT a transaction and
// says what/why. Turning a signal into a confirmed vulnerability is a later (agent) step.
export interface Signal {
  ruleId: string
  transactionId: string
  severity: Severity
  category: string
  title: string
  // Short human-readable proof ("missing: HSTS, CSP" / "Server: uvicorn"). Keep it one line.
  evidence?: string
}

export interface Rule {
  id: string
  title: string
  category: string
  severity: Severity
  // Pure + deterministic: same transaction in ⇒ same signals out, no side effects. Return [] when
  // the rule does not fire. A rule that needs a response should no-op when `tx.response` is absent.
  evaluate(tx: Transaction): Signal[]
}

// A registry so consumers (the web pipeline, cloud modules) can assemble a rule set and run it.
// Kept dead-simple: register rules, run them over one transaction or the whole store.
export class RuleRegistry {
  private readonly rules: Rule[] = []

  register(rule: Rule): this {
    this.rules.push(rule)
    return this
  }
  registerAll(rules: Rule[]): this {
    for (const r of rules) this.register(r)
    return this
  }
  list(): Rule[] {
    return [...this.rules]
  }
  // Run every rule over one transaction, collecting all signals.
  run(tx: Transaction): Signal[] {
    const out: Signal[] = []
    for (const rule of this.rules) {
      for (const sig of rule.evaluate(tx)) out.push(sig)
    }
    return out
  }
  // Run over many transactions (e.g. store.all()).
  runAll(txs: Transaction[]): Signal[] {
    const out: Signal[] = []
    for (const tx of txs) for (const sig of this.run(tx)) out.push(sig)
    return out
  }
}
