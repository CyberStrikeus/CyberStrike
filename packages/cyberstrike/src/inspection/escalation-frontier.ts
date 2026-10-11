import { createHash } from "node:crypto"

// The code-enforced relentless engine (P1, docs/correlation-hunter-agent.md). The escalation-hunter
// EMITS hypotheses via the propose_escalation tool; THIS holds the frontier so persistence, no-repeat
// (tried-set), expected-impact ordering, and the budget are structural — not prompt-trust. The model
// owns the CONTENT of a hypothesis; the code owns when to stop, what not to repeat, and what to work next.
//
// Scoped per hunt session (the escalation-hunter child session). In-memory: a hunt is one agentic
// session, so a restart interrupts it anyway — the frontier dies with the hunt, nothing to persist.
export namespace EscalationFrontier {
  export interface Hypothesis {
    fingerprint: string
    from: string[] // seed finding ids this chains
    hypothesis: string // the model's creative "chain X with Y to reach Z"
    targetImpact: string // claimed escalated impact
    priority: number // 0 = highest expected impact
    status: "pending" | "done"
  }
  interface Frontier {
    items: Hypothesis[]
    tried: Set<string>
    budget: number
    used: number
    calls: number // EVERY propose() call, incl. duplicates/post-spent — the hard-cap counter (#96)
    spentReplies: number // how many times we've already told the model to stop
  }

  const DEFAULT_BUDGET = Math.max(1, Number(process.env.CYBERSTRIKE_ESCALATION_HYPOTHESIS_BUDGET) || 25)
  // Hard ceiling on TOTAL propose() calls (accepted + duplicate + post-spent). The budget only bounds
  // ACCEPTED hypotheses; a weak model that spams duplicates never spends it (a duplicate doesn't
  // increment `used`), so without this a hunt loops until the wall-clock timeout, pinning the escalation
  // source active forever (#96). Generous — real hunts use far fewer — but finite.
  const CALL_CAP = Math.max(DEFAULT_BUDGET * 3, Number(process.env.CYBERSTRIKE_ESCALATION_CALL_CAP) || 80)
  // Once the frontier is spent/capped, the model is TOLD to stop. A model that ignores that (keeps
  // proposing) is cut off in code: after this many post-spent replies, propose() returns terminate=true
  // and the tool cancels the hunt's own child session.
  const SPENT_GRACE = 2
  const frontiers = new Map<string, Frontier>()

  function get(sessionID: string): Frontier {
    let f = frontiers.get(sessionID)
    if (!f) {
      f = { items: [], tried: new Set(), budget: DEFAULT_BUDGET, used: 0, calls: 0, spentReplies: 0 }
      frontiers.set(sessionID, f)
    }
    return f
  }

  // Stable fingerprint of a hypothesis — the from-set (order-independent) + the normalized text. Two
  // proposals that chain the same findings toward the same idea collapse, so a closed path is never retried.
  function fingerprint(from: string[], hypothesis: string): string {
    const seeds = [...from].sort().join(",")
    const norm = hypothesis.toLowerCase().replace(/\s+/g, " ").trim()
    return createHash("sha1").update(`${seeds}|${norm}`).digest("hex").slice(0, 16)
  }

  // Expected-impact priority from the claimed target (crown-jewel outcomes first). Heuristic seed; the
  // point is only to spend the budget on the biggest chains first, so a cut-short hunt still lands them.
  function priorityOf(targetImpact: string): number {
    const t = targetImpact.toLowerCase()
    if (/\b(ato|account takeover|rce|remote code|full (data|db)|mass (data )?exfil|authz-wide|admin takeover|tenant takeover)\b/.test(t))
      return 0
    if (/\b(privilege|escalat|exfil|bypass|ssrf|internal)\b/.test(t)) return 1
    return 2
  }

  export interface ProposeResult {
    status: "queued" | "duplicate" | "budget-spent"
    message: string
    next?: { hypothesis: string; targetImpact: string; from: string[] }
    pending: number
    used: number
    budget: number
    // Code-level kill switch (#96): the model has been told to stop and kept proposing past the grace —
    // the tool must cancel the hunt's own child session so the escalation source can go inactive.
    terminate?: boolean
  }

  export function propose(
    sessionID: string,
    input: { from: string[]; hypothesis: string; targetImpact: string },
  ): ProposeResult {
    const f = get(sessionID)
    f.calls++
    const base = () => ({ pending: f.items.filter((i) => i.status === "pending").length, used: f.used, budget: f.budget })

    // Spent EITHER by budget (enough accepted hypotheses) OR by the hard call cap (a duplicate/post-spent
    // spam loop). Both end the hunt; the cap is what makes a repeating model terminable in code (#96).
    if (f.used >= f.budget || f.calls > CALL_CAP) {
      f.spentReplies++
      return {
        status: "budget-spent",
        message: "Budget spent — STOP proposing. Finalize report_vulnerability for every chain you confirmed, then end.",
        terminate: f.spentReplies > SPENT_GRACE,
        ...base(),
      }
    }

    const fp = fingerprint(input.from, input.hypothesis)
    if (f.tried.has(fp)) {
      return {
        status: "duplicate",
        message: "Already attempted this angle (closed). Propose a DIFFERENT chain — another identity, sibling object, encoding, or hop.",
        next: nextPending(f),
        ...base(),
      }
    }

    f.tried.add(fp)
    f.used++
    f.items.push({
      fingerprint: fp,
      from: input.from,
      hypothesis: input.hypothesis,
      targetImpact: input.targetImpact,
      priority: priorityOf(input.targetImpact),
      status: "pending",
    })

    return {
      status: "queued",
      message:
        "Queued. Work the NEXT item below now: construct it, confirm by replay (http_replay), and report_vulnerability if proven. Keep proposing follow-ups until this returns budget-spent or no next item.",
      next: nextPending(f),
      ...base(),
    }
  }

  // The next item to work — highest expected impact first — and mark it done (it is now the model's
  // current job). Returns undefined when the frontier is drained.
  function nextPending(f: Frontier): { hypothesis: string; targetImpact: string; from: string[] } | undefined {
    const pending = f.items.filter((i) => i.status === "pending").sort((a, b) => a.priority - b.priority)
    const top = pending[0]
    if (!top) return undefined
    top.status = "done"
    return { hypothesis: top.hypothesis, targetImpact: top.targetImpact, from: top.from }
  }

  // Code-seed the frontier (P2): the catalog matched the session's findings into obvious chains; pre-load
  // them so even a lazy model works them. Respects the tried-set + budget; returns how many were added.
  export function seed(sessionID: string, items: { from: string[]; hypothesis: string; targetImpact: string }[]): number {
    const f = get(sessionID)
    let added = 0
    for (const it of items) {
      if (f.used >= f.budget) break
      const fp = fingerprint(it.from, it.hypothesis)
      if (f.tried.has(fp)) continue
      f.tried.add(fp)
      f.used++
      f.items.push({
        fingerprint: fp,
        from: it.from,
        hypothesis: it.hypothesis,
        targetImpact: it.targetImpact,
        priority: priorityOf(it.targetImpact),
        status: "pending",
      })
      added++
    }
    return added
  }

  // Release a hunt's frontier (the child session ended). Keeps the map from growing unbounded.
  export function clear(sessionID: string): void {
    frontiers.delete(sessionID)
  }

  // Test/diagnostics.
  export function snapshot(sessionID: string): { used: number; budget: number; tried: number; pending: number } {
    const f = frontiers.get(sessionID)
    if (!f) return { used: 0, budget: DEFAULT_BUDGET, tried: 0, pending: 0 }
    return { used: f.used, budget: f.budget, tried: f.tried.size, pending: f.items.filter((i) => i.status === "pending").length }
  }
}
