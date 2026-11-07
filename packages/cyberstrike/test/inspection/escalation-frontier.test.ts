import { describe, test, expect } from "bun:test"
import { EscalationFrontier } from "../../src/inspection/escalation-frontier"

describe("EscalationFrontier — code-enforced relentless engine (#P1)", () => {
  test("queues a hypothesis and hands back a next item to work", () => {
    const s = "sess_a"
    EscalationFrontier.clear(s)
    const r = EscalationFrontier.propose(s, { from: ["F1"], hypothesis: "chain F1 info-disc + SSRF", targetImpact: "internal RCE" } as any)
    expect(r.status).toBe("queued")
    expect(r.next?.hypothesis).toContain("SSRF")
    expect(r.used).toBe(1)
  })

  test("a closed path cannot be re-attempted (tried-set, code-enforced)", () => {
    const s = "sess_b"
    EscalationFrontier.clear(s)
    EscalationFrontier.propose(s, { from: ["F1"], hypothesis: "Same Chain Idea", targetImpact: "ato" } as any)
    const dup = EscalationFrontier.propose(s, { from: ["F1"], hypothesis: "same   chain IDEA", targetImpact: "ato" } as any) // normalized → same fingerprint
    expect(dup.status).toBe("duplicate")
    expect(EscalationFrontier.snapshot(s).used).toBe(1) // the duplicate did NOT consume budget or enqueue
  })

  test("highest expected impact is handed back first (crown-jewel ordering)", () => {
    const s = "sess_c"
    EscalationFrontier.clear(s)
    EscalationFrontier.propose(s, { from: [], hypothesis: "low thing", targetImpact: "minor info leak" } as any) // priority 2
    const r = EscalationFrontier.propose(s, { from: [], hypothesis: "big thing", targetImpact: "account takeover" } as any) // priority 0
    expect(r.next?.targetImpact).toBe("account takeover") // the ATO is worked before the info leak
  })

  test("budget is a hard gate — past it, stop proposing", () => {
    const s = "sess_d"
    EscalationFrontier.clear(s)
    process.env.CYBERSTRIKE_ESCALATION_HYPOTHESIS_BUDGET // uses default 25; drive past it
    for (let i = 0; i < 25; i++) EscalationFrontier.propose(s, { from: [], hypothesis: "h" + i, targetImpact: "x" } as any)
    const over = EscalationFrontier.propose(s, { from: [], hypothesis: "one too many", targetImpact: "ato" } as any)
    expect(over.status).toBe("budget-spent")
    expect(over.message).toContain("Budget spent")
  })

  test("clear releases the frontier", () => {
    const s = "sess_e"
    EscalationFrontier.propose(s, { from: [], hypothesis: "h", targetImpact: "x" } as any)
    expect(EscalationFrontier.snapshot(s).used).toBe(1)
    EscalationFrontier.clear(s)
    expect(EscalationFrontier.snapshot(s).used).toBe(0)
  })
})
