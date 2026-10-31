import { describe, expect, test } from "bun:test"
import { TechPlaybook } from "../../src/session/web/signal"

// The CS signal fabric (detectors / SignalStore / CanaryRegistry / runDetectors) was retired — Vortex
// is the single producer (#15). TechPlaybook stays as shared scaffolding (the Vortex technology-retest
// path renders the same stack playbooks), so its behaviour is still covered here.
describe("TechPlaybook — a detected stack maps to concrete test cases", () => {
  test("known slug returns paths + vuln classes + a directive", () => {
    const e = TechPlaybook.get("spring-boot")!
    expect(e.paths).toContain("/actuator/env")
    expect(e.vulnClasses).toContain("spel-injection")
    expect(e.directive.length).toBeGreaterThan(0)
  })

  test("render produces a prompt block for multiple stacks, skips unknowns", () => {
    const block = TechPlaybook.render(["wordpress", "not-a-real-stack", "graphql"])
    expect(block).toContain("WordPress")
    expect(block).toContain("GraphQL")
    expect(block).not.toContain("not-a-real-stack")
  })

  test("slugForLabel maps recon_test labels to playbook slugs", () => {
    expect(TechPlaybook.slugForLabel("Spring Boot")).toBe("spring-boot")
    expect(TechPlaybook.slugForLabel("ASP.NET")).toBe("aspnet")
    expect(TechPlaybook.slugForLabel("Apache")).toBeUndefined() // bare web server → no playbook
  })
})
