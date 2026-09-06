import { describe, test, expect } from "bun:test"
// Faithful loader-path test for the REAL @cyberstrike-io/azure package.
// It runs the package's plugin default and replays EXACTLY the loops the host's
// plugin loader runs after import:
//   - provider hook → registerProvider(key, factory)   (plugin/index.ts:106-109)
//   - tool hook     → ToolRegistry.fromPlugin(id, def)  (tool/registry.ts:110-111)
// then asserts azure appears in the live registry, collectAgentSpecs, and health —
// i.e. an installed azure package integrates through the real registration path,
// not a mock. (The BunProc.install step is only testable post-publish.)
import azurePlugin from "../src/index"
import { registerProvider, resolveProvider, collectAgentSpecs } from "cyberstrike/cloud/provider-registry"
import { isAssessmentProvider } from "cyberstrike/cloud/provider"
import { providerHealth } from "cyberstrike/cloud/provider-health"
import { buildCoreRuntime } from "cyberstrike/cloud/core-runtime"

// The host injects input.core; the test supplies the real runtime the same way.
const pluginInput = () => ({ core: buildCoreRuntime() }) as any

describe("azure package integrates through the real loader registration path", () => {
  test("running the package + the loader's provider loop registers azure in core", async () => {
    const hooks = await azurePlugin(pluginInput())

    // EXACT loader loop (plugin/index.ts:106-109)
    for (const [key, factory] of Object.entries(hooks.provider ?? {})) {
      registerProvider(key, factory as any)
    }

    // azure is now in the live core registry — from the package, not a built-in
    const azure = await resolveProvider("azure")
    expect(azure).toBeDefined()
    expect(azure!.key).toBe("azure")
    expect(isAssessmentProvider(azure!)).toBe(true)

    // its agents flow into the shared agent registry alongside web's
    const { specs } = await collectAgentSpecs()
    const azureAgents = specs.filter((s) => azure!.agentSpecs().some((a) => a.name === s.name))
    expect(azureAgents.length).toBe(13)
    // web is still there too (both domains coexist)
    expect(specs.some((s) => s.name === "hunt-agent")).toBe(true)
  })

  test("health reports the azure domain with its agents", async () => {
    const hooks = await azurePlugin(pluginInput())
    for (const [key, factory] of Object.entries(hooks.provider ?? {})) registerProvider(key, factory as any)

    const health = await providerHealth()
    const azure = health.domains.find((d) => d.domain === "azure")
    expect(azure).toBeDefined()
    expect(azure!.loaded).toBe(true)
    expect(azure!.agents).toBe(13)
    expect(azure!.byRole.orchestrator).toBe(1)
  })

  test("the package's tool hook entries are valid SDK ToolDefinitions (registerable)", async () => {
    const hooks = await azurePlugin(pluginInput())
    // ToolRegistry.fromPlugin(id, def) requires description + args + execute; assert
    // all 4 azure tools present that shape (so the tool loop would register them).
    const tools = hooks.tool ?? {}
    expect(Object.keys(tools).sort()).toEqual(
      ["azurehook", "get_assess_findings", "get_cloud_groups", "get_cloud_intel"].sort(),
    )
    for (const [id, def] of Object.entries(tools)) {
      expect(typeof (def as any).description, `${id}.description`).toBe("string")
      expect(typeof (def as any).args, `${id}.args`).toBe("object")
      expect(typeof (def as any).execute, `${id}.execute`).toBe("function")
    }
  })
})
