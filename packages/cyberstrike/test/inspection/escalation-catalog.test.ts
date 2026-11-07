import { describe, test, expect, afterEach } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir as ostmp } from "node:os"
import path from "node:path"
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

describe("EscalationCatalog — loadable packs (#P2)", () => {
  const prev = process.env.CYBERSTRIKE_ESCALATION_CATALOG_DIR
  afterEach(() => {
    if (prev === undefined) delete process.env.CYBERSTRIKE_ESCALATION_CATALOG_DIR
    else process.env.CYBERSTRIKE_ESCALATION_CATALOG_DIR = prev
    EscalationCatalog.reload()
  })

  test("built-in patterns load with no pack dir", () => {
    delete process.env.CYBERSTRIKE_ESCALATION_CATALOG_DIR
    EscalationCatalog.reload()
    const builtin = EscalationCatalog.loadPatterns()
    expect(builtin.length).toBeGreaterThan(0)
    expect(builtin.find((p) => p.id === "ssrf-internal")).toBeDefined()
  })

  test("a custom pack is merged with the built-ins and fires a seed", () => {
    const dir = mkdtempSync(path.join(ostmp(), "esc-pack-"))
    try {
      writeFileSync(
        path.join(dir, "team.json"),
        JSON.stringify([{ id: "xss-cors-custom", requires: ["xss"], impact: "custom-takeover", say: "team-specific xss chain" }]),
      )
      process.env.CYBERSTRIKE_ESCALATION_CATALOG_DIR = dir
      EscalationCatalog.reload()
      const ids = EscalationCatalog.loadPatterns().map((p) => p.id)
      expect(ids).toContain("xss-cors-custom") // merged
      expect(ids).toContain("ssrf-internal") // built-ins kept
      const seeds = EscalationCatalog.seeds([F("X", "Reflected XSS on /search")] as any)
      expect(seeds.find((s) => s.targetImpact === "custom-takeover")).toBeDefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a malformed pack is skipped, built-ins still load", () => {
    const dir = mkdtempSync(path.join(ostmp(), "esc-bad-"))
    try {
      writeFileSync(path.join(dir, "broken.json"), "{ not json")
      writeFileSync(path.join(dir, "invalid.json"), JSON.stringify([{ id: "x" }])) // missing requires/impact/say
      process.env.CYBERSTRIKE_ESCALATION_CATALOG_DIR = dir
      EscalationCatalog.reload()
      const ids = EscalationCatalog.loadPatterns().map((p) => p.id)
      expect(ids).not.toContain("x") // invalid pattern dropped
      expect(ids).toContain("ssrf-internal") // bad packs don't take the catalog down
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a pack entry overrides a built-in of the same id", () => {
    const dir = mkdtempSync(path.join(ostmp(), "esc-ovr-"))
    try {
      writeFileSync(
        path.join(dir, "override.json"),
        JSON.stringify({ patterns: [{ id: "idor-alone", requires: ["idor"], impact: "TUNED-IMPACT", say: "tuned" }] }),
      )
      process.env.CYBERSTRIKE_ESCALATION_CATALOG_DIR = dir
      EscalationCatalog.reload()
      const p = EscalationCatalog.loadPatterns().find((x) => x.id === "idor-alone")
      expect(p!.impact).toBe("TUNED-IMPACT") // team tune wins over the default
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
