import { describe, test, expect } from "bun:test"
// Faithful loader-path test for the REAL @cyberstrike-io/internal-network package.
// It runs the package's plugin default and replays EXACTLY the loop the host's
// plugin loader runs after import (provider hook → registerProvider), then asserts
// the internal-network specialist appears in collectAgentSpecs — i.e. an installed
// pro package integrates through the real registration path, not a mock.
import internalNetworkPlugin from "../src/index"
import { registerProvider, resolveProvider, collectAgentSpecs } from "cyberstrike/cloud/provider-registry"
import { buildCoreRuntime } from "cyberstrike/cloud/core-runtime"
import manifest from "../package.json"

// The host injects input.core; the test supplies the real runtime the same way.
const pluginInput = () => ({ core: buildCoreRuntime() }) as any

describe("@cyberstrike-io/internal-network integrates through the real loader path", () => {
  test("running the package + the loader's provider loop registers the domain", async () => {
    const hooks = await internalNetworkPlugin(pluginInput())
    for (const [key, factory] of Object.entries(hooks.provider ?? {})) {
      registerProvider(key, factory as any)
    }

    const provider = await resolveProvider("internal-network")
    expect(provider).toBeDefined()
    expect(provider!.key).toBe("internal-network")

    const { specs } = await collectAgentSpecs()
    const spec = specs.find((s) => s.name === "internal-network")
    expect(spec).toBeDefined()
    expect(spec!.color).toBe("yellow")
    expect(spec!.role).toBe("specialist")
  })

  test("the specialist carries its full permission allow-list", async () => {
    const provider = await resolveProvider("internal-network")
    const spec = provider!.agentSpecs()[0]
    // The large allow-list must survive the extraction verbatim.
    for (const tool of [
      "bash", "hackbrowser", "attack_script", "ebpf", "winhook", "machook", "linuxhook",
      "awshook", "azurehook", "kubehook", "gcphook", "containerhook", "iachook",
      "cloud_audit", "k8s_audit", "ci_audit", "cipipe",
    ]) {
      expect(spec.permissions[tool]).toBe("allow")
    }
    expect(spec.skills).toContain("ad-security")
    expect(spec.skills).toContain("kerberos-attacks")
  })

  test("prompt preserves the methodology preamble + forced-continuation prefix", async () => {
    const provider = await resolveProvider("internal-network")
    const spec = provider!.agentSpecs()[0]
    // Composed prompt: common-methodology → forced-continuation → --- → domain prompt.
    expect(spec.prompt).toContain("---")
    expect(spec.prompt.indexOf("---")).toBeGreaterThan(0)
    // Domain content is present after the separator.
    expect(spec.prompt).toMatch(/Active Directory|Kerberos|lateral movement/i)
  })

  test("manifest declares tier:pro so a free-tier gate excludes it", () => {
    expect(manifest.cyberstrike.tier).toBe("pro")
    expect(manifest.cyberstrike.domains).toContain("internal-network")
  })
})
