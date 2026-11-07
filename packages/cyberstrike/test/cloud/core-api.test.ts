import { describe, test, expect } from "bun:test"
import { CORE_API_VERSION, coreApiSatisfies, requireCoreApi } from "../../src/cloud/core-api"
import { registerProvider } from "../../src/cloud/provider-registry"
import { providerHealth } from "../../src/cloud/provider-health"

describe("core API compatibility", () => {
  test("coreApiSatisfies compares major.minor.patch", () => {
    expect(coreApiSatisfies(CORE_API_VERSION)).toBe(true) // equal — host satisfies its own
    expect(coreApiSatisfies("1.0.0")).toBe(true) // host is >= 1.0.0
    expect(coreApiSatisfies("0.9.0")).toBe(true) // host much newer
    expect(coreApiSatisfies("999.0.0")).toBe(false) // host older (major)
    expect(coreApiSatisfies("1.999.0")).toBe(false) // host older (minor)
  })

  test("unparseable version never satisfies (safe default)", () => {
    expect(coreApiSatisfies("latest")).toBe(false)
    expect(coreApiSatisfies("")).toBe(false)
  })

  test("requireCoreApi throws with a clear message on mismatch", () => {
    expect(() => requireCoreApi("2.0.0")).toThrow(/incompatible core API/)
    expect(() => requireCoreApi(CORE_API_VERSION)).not.toThrow()
  })

  test("a package requiring an incompatible core surfaces as failed in health (not crash)", async () => {
    // Simulates a workflow package that pins a newer core than installed: its
    // provider factory calls requireCoreApi and throws. resolveProviders catches
    // it — the domain shows failed, the host and other domains keep working.
    registerProvider("future-domain", () => {
      requireCoreApi("99.0.0")
      return { key: "future-domain", agentSpecs: () => [] }
    })
    const health = await providerHealth()
    const future = health.domains.find((d) => d.domain === "future-domain")
    expect(future).toBeDefined()
    expect(future!.loaded).toBe(false)
    expect(future!.error).toContain("incompatible core API")
    expect(health.ok).toBe(false)
    // web still loaded despite the incompatible domain
    expect(health.domains.find((d) => d.domain === "web")?.loaded).toBe(true)
    // cleanup
    registerProvider("future-domain", () => ({ key: "future-domain", agentSpecs: () => [] }))
  })
})
