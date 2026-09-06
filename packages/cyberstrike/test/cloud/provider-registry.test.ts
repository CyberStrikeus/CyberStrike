import { describe, test, expect } from "bun:test"
import {
  registerProvider,
  registeredDomains,
  resolveProviders,
  collectAgentSpecs,
} from "../../src/cloud/provider-registry"
import type { DomainProvider, AgentSpec } from "../../src/cloud/provider"

function fakeProvider(key: string, agentNames: string[]): DomainProvider {
  return {
    key,
    agentSpecs: () =>
      agentNames.map(
        (name): AgentSpec => ({
          name,
          role: "specialist",
          description: `${name} desc`,
          steps: 10,
          color: "cyan",
          prompt: "p",
          skills: [],
          permissions: {},
        }),
      ),
  }
}

describe("ProviderRegistry", () => {
  test("built-in domains web + azure are registered", () => {
    const domains = registeredDomains()
    expect(domains).toContain("web")
    expect(domains).toContain("azure")
  })

  test("resolveProviders loads built-ins (web agents present)", async () => {
    const { providers, errors } = await resolveProviders()
    const web = providers.find((p) => p.key === "web")
    expect(web).toBeDefined()
    expect(web!.agentSpecs().some((s) => s.name === "hunt-agent")).toBe(true)
    // built-ins must not error
    expect(errors.find((e) => e.key === "web" || e.key === "azure")).toBeUndefined()
  })

  test("a throwing factory is skipped, not fatal; others still resolve", async () => {
    registerProvider("boom", () => {
      throw new Error("kaboom")
    })
    const { providers, errors } = await resolveProviders()
    expect(errors.some((e) => e.key === "boom")).toBe(true)
    // web still resolved despite boom throwing
    expect(providers.some((p) => p.key === "web")).toBe(true)
    // cleanup: replace boom with a no-op so later tests/suites aren't affected
    registerProvider("boom", () => fakeProvider("boom", []))
  })

  test("registerProvider is idempotent per key (replace, not duplicate)", () => {
    const before = registeredDomains().filter((d) => d === "dup").length
    registerProvider("dup", () => fakeProvider("dup", ["dup-a"]))
    registerProvider("dup", () => fakeProvider("dup", ["dup-b"]))
    const count = registeredDomains().filter((d) => d === "dup").length
    expect(before).toBe(0)
    expect(count).toBe(1)
  })

  test("collectAgentSpecs fails fast on a cross-domain agent-name collision", async () => {
    // hunt-agent is owned by the web domain; a plugin re-declaring it must be rejected.
    registerProvider("evil-twin", () => fakeProvider("evil-twin", ["hunt-agent"]))
    await expect(collectAgentSpecs()).rejects.toThrow(/unique across domains/)
    // cleanup
    registerProvider("evil-twin", () => fakeProvider("evil-twin", []))
  })

  test("collectAgentSpecs returns flattened specs from all domains after cleanup", async () => {
    const { specs } = await collectAgentSpecs()
    expect(specs.some((s) => s.name === "hunt-agent")).toBe(true)
    // no duplicate agent names in the flattened set
    const names = specs.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
