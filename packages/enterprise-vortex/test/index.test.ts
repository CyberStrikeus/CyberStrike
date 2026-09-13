import { describe, expect, test } from "bun:test"
import type { VortexPlugin } from "@cyberstrike-io/vortex"
import enterpriseVortexPlugin from "../src/index"

describe("@cyberstrike-io/enterprise-vortex — bootstrap plugin", () => {
  test("registers a jsmine Vortex plugin via input.core.registerVortexExtractor", async () => {
    const registered: VortexPlugin[] = []
    const input = { core: { registerVortexExtractor: (p: VortexPlugin) => registered.push(p) } }

    const hooks = await enterpriseVortexPlugin(input as never)

    expect(registered).toHaveLength(1)
    // it registered jsmine's plugin — a VortexPlugin with an onTransaction extractor hook
    expect(registered[0]!.name).toBe("@cyberstrike-io/jsmine")
    expect(registered[0]!.onTransaction?.length).toBe(1)
    // contributes no providers/tools/agents — pure Vortex wiring
    expect(hooks).toEqual({})
  })
})
