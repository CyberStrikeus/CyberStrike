// Active rules — the deterministic layer that SENDS. Unlike Rule/CorpusRule (pure, passive), an
// ActiveRule probes: it picks transactions from the corpus, sends mutated requests through the
// injected sender (the same agent-agnostic send() the engine exposes), diffs the outcome, and
// emits signals. This is the DSL/engine driving the send core deterministically — no agent, no LLM.
// The sender is INJECTED so rules stay testable with a stub (no network) and so all sends go
// through one governed path.
import type { Transaction } from "./transaction"
import type { Signal } from "./rule"
import { dedupe } from "./rule"
import type { SendResult, RequestSpec, SendOptions } from "./replay"

// The one real send. Matches the signature of replay.send — a rule receives it; production passes
// the real send(), tests pass a stub.
export type Sender = (
  input: Transaction | RequestSpec | { req: import("./send").HttpMessage.Request; origin: string },
  opts?: SendOptions,
) => Promise<SendResult>

export interface ActiveRule {
  id: string
  title: string
  category: string
  severity: import("./transaction").Severity
  // Probe the corpus with `send`, returning candidate signals. Should bound its own work (e.g. one
  // probe per endpoint) — the sender is governed, but a rule must not fan out without limit.
  probe(txs: Transaction[], send: Sender): Promise<Signal[]>
}

// Run active rules over a corpus with an injected sender; collect + dedup the signals.
export async function runActiveRules(rules: ActiveRule[], txs: Transaction[], send: Sender): Promise<Signal[]> {
  const out: Signal[] = []
  for (const rule of rules) {
    for (const sig of await rule.probe(txs, send)) out.push(sig)
  }
  return dedupe(out)
}
