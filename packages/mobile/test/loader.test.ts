import { describe, test, expect } from "bun:test"
// Faithful loader-path test for the REAL @cyberstrike-io/mobile package (see the
// internal-network test for the rationale — same registration replay).
import mobilePlugin from "../src/index"
import { registerProvider, resolveProvider, collectAgentSpecs } from "cyberstrike/cloud/provider-registry"
import { buildCoreRuntime } from "cyberstrike/cloud/core-runtime"
import manifest from "../package.json"

const pluginInput = () => ({ core: buildCoreRuntime() }) as any

describe("@cyberstrike-io/mobile integrates through the real loader path", () => {
  test("running the package + the loader's provider loop registers the domain", async () => {
    const hooks = await mobilePlugin(pluginInput())
    for (const [key, factory] of Object.entries(hooks.provider ?? {})) {
      registerProvider(key, factory as any)
    }

    const provider = await resolveProvider("mobile")
    expect(provider).toBeDefined()
    expect(provider!.key).toBe("mobile")

    const { specs } = await collectAgentSpecs()
    const spec = specs.find((s) => s.name === "mobile-application")
    expect(spec).toBeDefined()
    expect(spec!.color).toBe("magenta")
    expect(spec!.role).toBe("specialist")
  })

  test("the specialist carries its permission allow-list and no preloaded skills", async () => {
    const provider = await resolveProvider("mobile")
    const spec = provider!.agentSpecs()[0]
    for (const tool of [
      "question", "bash", "hackbrowser", "read", "glob", "grep",
      "report_vulnerability", "triage_vulnerability", "add_intel", "update_vrt_check",
      "methodology_status", "scope_check", "ensure_tools", "attack_script",
    ]) {
      expect(spec.permissions[tool]).toBe("allow")
    }
    // Pre-extraction, mobile-application declared no `skills` — preserve undefined.
    expect(spec.skills).toBeUndefined()
  })

  test("prompt preserves the methodology preamble + forced-continuation prefix", async () => {
    const provider = await resolveProvider("mobile")
    const spec = provider!.agentSpecs()[0]
    expect(spec.prompt).toContain("---")
    expect(spec.prompt).toMatch(/Android|iOS|MASTG|MASVS|Frida/i)
  })

  test("manifest declares tier:pro so a free-tier gate excludes it", () => {
    expect(manifest.cyberstrike.tier).toBe("pro")
    expect(manifest.cyberstrike.domains).toContain("mobile")
  })
})
