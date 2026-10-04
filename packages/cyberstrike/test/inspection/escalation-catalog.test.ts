import { describe, test, expect } from "bun:test"
import { EscalationCatalog } from "../../src/inspection/escalation-catalog"
import { EscalationFrontier } from "../../src/inspection/escalation-frontier"

const F = (id: string, title: string, endpoint?: string) => ({ id, title, description: "", endpoint } as any)

describe("EscalationCatalog — code-seeded chains (#P2)", () => {
  test("classify maps titles to primitive classes", () => {
    expect(EscalationCatalog.classify(F("1", "Blind SSRF on /fetch"))).toContain("ssrf")
    expect(EscalationCatalog.classify(F("2", "IDOR: another user's order"))).toContain("idor")
    expect(EscalationCatalog.classify(F("3", "Internal path disclosed in verbose error"))).toContain("info-disclosure")
    expect(EscalationCatalog.classify(F("4", "Open redirect on /login"))).toContain("open-redirect")
  })

  test("seeds produces a chain when the required primitives are both present", () => {
    const findings = [F("A", "Internal host leaked (info disclosure)"), F("B", "SSRF on /proxy")]
    const seeds = EscalationCatalog.seeds(findings as any)
    const ssrf = seeds.find((s) => s.targetImpact.includes("internal RCE"))
    expect(ssrf).toBeDefined()
    expect(ssrf!.from.sort()).toEqual(["A", "B"]) // references both primitives
  })

  test("no seed when a required primitive is missing", () => {
    const seeds = EscalationCatalog.seeds([F("A", "Internal host leaked (info disclosure)")] as any)
    expect(seeds.find((s) => s.targetImpact.includes("internal RCE"))).toBeUndefined() // no SSRF → no pivot chain
  })

  test("frontier.seed enqueues code seeds respecting the tried-set", () => {
    const s = "cat_sess"
    EscalationFrontier.clear(s)
    const items = [{ from: ["A"], hypothesis: "chain one", targetImpact: "ato" }]
    expect(EscalationFrontier.seed(s, items)).toBe(1)
    expect(EscalationFrontier.seed(s, items)).toBe(0) // same fingerprint → not re-seeded
    expect(EscalationFrontier.snapshot(s).pending).toBe(1)
  })
})
