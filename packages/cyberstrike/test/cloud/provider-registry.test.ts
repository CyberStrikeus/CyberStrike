import { describe, test, expect } from "bun:test"
import {
  registerProvider,
  registeredDomains,
  resolveProviders,
  resolveProvider,
  collectAgentSpecs,
} from "../../src/cloud/provider-registry"
import { isAssessmentProvider } from "../../src/cloud/provider"
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
  test("web is the built-in domain; azure is a package, not built-in", () => {
    const domains = registeredDomains()
    expect(domains).toContain("web")
    // azure moved to @cyberstrike-io/azure — it registers via the plugin
    // `provider` hook when installed, NOT as a core built-in.
    expect(domains).not.toContain("azure")
  })

  test("resolveProviders loads the web built-in (agents present, no error)", async () => {
    const { providers, errors } = await resolveProviders()
    const web = providers.find((p) => p.key === "web")
    expect(web).toBeDefined()
    expect(web!.agentSpecs().some((s) => s.name === "hunt-agent")).toBe(true)
    expect(errors.find((e) => e.key === "web")).toBeUndefined()
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

  test("a plugin-style provider hook registers a domain whose agents then appear", async () => {
    // Simulates what plugin/index.ts does when it loads an installed package that
    // exports a `provider` hook: it calls registerProvider(key, factory). After
    // that, the domain's agents are collected exactly like the built-ins.
    const hookProvider = { aws: () => fakeProvider("aws", ["aws-orchestrator", "aws-iam", "aws-s3"]) }
    for (const [key, factory] of Object.entries(hookProvider)) registerProvider(key, factory)

    expect(registeredDomains()).toContain("aws")
    const { specs } = await collectAgentSpecs()
    expect(specs.some((s) => s.name === "aws-orchestrator")).toBe(true)
    expect(specs.some((s) => s.name === "aws-iam")).toBe(true)
    expect(specs.filter((s) => s.name.startsWith("aws-")).length).toBe(3)

    // cleanup
    registerProvider("aws", () => fakeProvider("aws", []))
  })

  test("resolveProvider runs only the requested domain's factory", async () => {
    let webRan = 0
    let awsRan = 0
    registerProvider("resolvetest-web", () => {
      webRan++
      return fakeProvider("resolvetest-web", ["rw"])
    })
    registerProvider("resolvetest-aws", () => {
      awsRan++
      return fakeProvider("resolvetest-aws", ["ra"])
    })
    const p = await resolveProvider("resolvetest-aws")
    expect(p?.key).toBe("resolvetest-aws")
    expect(awsRan).toBe(1)
    expect(webRan).toBe(0) // the other factory was NOT run
    expect(await resolveProvider("nonexistent")).toBeUndefined()
    // cleanup
    registerProvider("resolvetest-web", () => fakeProvider("resolvetest-web", []))
    registerProvider("resolvetest-aws", () => fakeProvider("resolvetest-aws", []))
  })
})

describe("C10 — pluggable workflow entry (assessment provider resolution)", () => {
  test("a registered assessment domain resolves from the registry and narrows", async () => {
    // Azure now ships as a package; the C10 entry (azurehook) resolves whatever
    // assessment provider is registered under "azure". Simulate that registration
    // and verify the resolve + isAssessmentProvider narrowing the entry relies on.
    registerProvider("assess-c10", () => ({
      key: "assess-c10",
      agentSpecs: () => [],
      groups: () => [],
      identityGroup: () => null,
      parallelGroups: () => [],
      validate: () => ({ ok: true as const, totalFindings: 0 }),
      findingCount: () => 0,
      classify: () => [],
      analystPrompt: () => "",
      batchPrompt: () => "",
      verifyPrompt: () => "",
      followupPrompt: () => "",
      identityContext: () => "",
    }))
    const resolved = await resolveProvider("assess-c10")
    expect(resolved).toBeDefined()
    expect(isAssessmentProvider(resolved!)).toBe(true)
    // cleanup
    registerProvider("assess-c10", () => fakeProvider("assess-c10", []))
  })

  test("isAssessmentProvider rejects a thin agents-only provider", () => {
    const thin = fakeProvider("thin", ["thin-a"])
    expect(isAssessmentProvider(thin)).toBe(false)
  })
})
