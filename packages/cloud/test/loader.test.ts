import { describe, test, expect } from "bun:test"
// Faithful loader-path test for the REAL @cyberstrike-io/cloud package (see the
// internal-network test for the rationale — same registration replay).
import cloudPlugin from "../src/index"
import { registerProvider, resolveProvider, collectAgentSpecs } from "cyberstrike/cloud/provider-registry"
import { buildCoreRuntime } from "cyberstrike/cloud/core-runtime"
import manifest from "../package.json"

const pluginInput = () => ({ core: buildCoreRuntime() }) as any

describe("@cyberstrike-io/cloud integrates through the real loader path", () => {
  test("running the package + the loader's provider loop registers the domain", async () => {
    const hooks = await cloudPlugin(pluginInput())
    for (const [key, factory] of Object.entries(hooks.provider ?? {})) {
      registerProvider(key, factory as any)
    }

    const provider = await resolveProvider("cloud")
    expect(provider).toBeDefined()
    expect(provider!.key).toBe("cloud")

    const { specs } = await collectAgentSpecs()
    const spec = specs.find((s) => s.name === "cloud-security")
    expect(spec).toBeDefined()
    expect(spec!.color).toBe("cyan")
    expect(spec!.role).toBe("specialist")
  })

  test("the specialist carries its full permission allow-list and CIS skills", async () => {
    const provider = await resolveProvider("cloud")
    const spec = provider!.agentSpecs()[0]
    for (const tool of [
      "bash", "hackbrowser", "attack_script", "awshook", "azurehook", "kubehook",
      "gcphook", "containerhook", "iachook", "cloud_audit", "k8s_audit", "ci_audit",
    ]) {
      expect(spec.permissions[tool]).toBe("allow")
    }
    expect(spec.skills).toContain("cis-aws-foundations-2.1.1")
    expect(spec.skills).toContain("cloud-assessment")
  })

  test("prompt preserves the methodology preamble + forced-continuation prefix", async () => {
    const provider = await resolveProvider("cloud")
    const spec = provider!.agentSpecs()[0]
    expect(spec.prompt).toContain("---")
    expect(spec.prompt).toMatch(/AWS|Azure|GCP|IAM|CIS/i)
  })

  test("manifest declares tier:pro so a free-tier gate excludes it", () => {
    expect(manifest.cyberstrike.tier).toBe("pro")
    expect(manifest.cyberstrike.domains).toContain("cloud")
  })
})
