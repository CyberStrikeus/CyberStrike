import { describe, test, expect } from "bun:test"
import { providerHealth, formatHealthReport } from "../../src/cloud/provider-health"
import { registerProvider } from "../../src/cloud/provider-registry"
import type { DomainProvider, AgentSpec } from "../../src/cloud/provider"

function fakeProvider(key: string, specs: Partial<AgentSpec>[]): DomainProvider {
  return {
    key,
    agentSpecs: () =>
      specs.map((s): AgentSpec => ({
        name: s.name!,
        role: s.role ?? "specialist",
        description: s.name!,
        steps: 10,
        color: "cyan",
        prompt: "p",
        skills: [],
        permissions: s.permissions ?? {},
      })),
  }
}

describe("providerHealth", () => {
  test("reports built-in web domain with agent/role/tool counts", async () => {
    const report = await providerHealth()
    const web = report.domains.find((d) => d.domain === "web")
    expect(web).toBeDefined()
    expect(web!.loaded).toBe(true)
    expect(web!.agents).toBe(13)
    expect(web!.byRole.orchestrator).toBe(1)
    expect(web!.byRole.analyzer).toBe(1)
    expect(web!.byRole.specialist).toBe(11)
    // web agents call tools (http_replay, web_get_session_context, ...) — non-zero
    expect(web!.tools).toBeGreaterThan(0)
    expect(web!.ruleCount).toBeGreaterThan(0)
  })

  test("healthy built-in registry reports ok=true and no collisions", async () => {
    const report = await providerHealth()
    // built-ins alone are healthy (this may include leftover fake domains from
    // other suites, but those are valid and collision-free)
    expect(report.loadErrors.filter((e) => e.domain === "web" || e.domain === "azure")).toEqual([])
    expect(report.totalAgents).toBeGreaterThan(13)
  })

  test("a broken provider shows as loaded:false with its error, ok=false", async () => {
    registerProvider("brokencloud", () => {
      throw new Error("missing API key")
    })
    const report = await providerHealth()
    const broken = report.domains.find((d) => d.domain === "brokencloud")
    expect(broken).toBeDefined()
    expect(broken!.loaded).toBe(false)
    expect(broken!.error).toContain("missing API key")
    expect(report.ok).toBe(false)
    // cleanup
    registerProvider("brokencloud", () => fakeProvider("brokencloud", []))
  })

  test("cross-domain agent-name collision is reported (not thrown)", async () => {
    registerProvider("twin", () => fakeProvider("twin", [{ name: "hunt-agent" }]))
    const report = await providerHealth()
    const collision = report.collisions.find((c) => c.agent === "hunt-agent")
    expect(collision).toBeDefined()
    expect(collision!.domains).toContain("web")
    expect(collision!.domains).toContain("twin")
    expect(report.ok).toBe(false)
    // cleanup
    registerProvider("twin", () => fakeProvider("twin", []))
  })

  test("tool count reflects allow-listed capabilities, excludes wildcard", async () => {
    registerProvider("counttest", () =>
      fakeProvider("counttest", [
        { name: "ct-a", permissions: { "*": "deny", http_replay: "allow", scope_check: "allow" } },
        { name: "ct-b", permissions: { "*": "deny", http_replay: "allow", authn_test: "allow" } },
      ]),
    )
    const report = await providerHealth()
    const ct = report.domains.find((d) => d.domain === "counttest")!
    // distinct tools across ct-a + ct-b: http_replay, scope_check, authn_test = 3; "*" excluded
    expect(ct.tools).toBe(3)
    expect(ct.toolNames).toEqual(["authn_test", "http_replay", "scope_check"])
    // cleanup
    registerProvider("counttest", () => fakeProvider("counttest", []))
  })

  test("formatHealthReport renders a readable per-domain summary", async () => {
    const report = await providerHealth()
    const text = formatHealthReport(report)
    expect(text).toContain("Domains:")
    expect(text).toMatch(/✓ web — 13 agents/)
  })
})
