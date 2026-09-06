import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Plugin } from "../../src/plugin"
import { collectAgentSpecs, registerProvider, registeredDomains } from "../../src/cloud/provider-registry"
import { providerHealth } from "../../src/cloud/provider-health"

// End-to-end proof that an INSTALLED plugin (here a local .cyberstrike/plugin file,
// the same load path `npm install`ed packages take) contributes a whole domain via
// the `provider` hook: real loader → hook → registry → agent registry + health.
describe("plugin.provider-hook (end-to-end)", () => {
  test("a local plugin's provider hook registers a domain; its agents + health appear", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".cyberstrike", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })
        await Bun.write(
          path.join(pluginDir, "awstest-domain.ts"),
          [
            "export default async () => ({",
            "  provider: {",
            "    awstest: () => ({",
            '      key: "awstest",',
            "      agentSpecs: () => [",
            '        { name: "awstest-orchestrator", role: "orchestrator", description: "AWS main", steps: 10, color: "cyan", prompt: "p", skills: [], permissions: { "*": "deny", task: "allow" } },',
            '        { name: "awstest-iam", role: "specialist", description: "AWS IAM", steps: 10, color: "cyan", prompt: "p", skills: [], permissions: { "*": "deny", awshook: "allow" } },',
            "      ],",
            "    }),",
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Force plugin load — the loader runs each plugin and registers any
        // `provider` hook into the domain registry as a side-effect.
        await Plugin.list()

        expect(registeredDomains()).toContain("awstest")

        const { specs } = await collectAgentSpecs()
        expect(specs.some((s) => s.name === "awstest-orchestrator")).toBe(true)
        expect(specs.some((s) => s.name === "awstest-iam")).toBe(true)

        const health = await providerHealth()
        const aws = health.domains.find((d) => d.domain === "awstest")
        expect(aws).toBeDefined()
        expect(aws!.loaded).toBe(true)
        expect(aws!.agents).toBe(2)
        expect(aws!.byRole.orchestrator).toBe(1)
        expect(aws!.byRole.specialist).toBe(1)
        expect(aws!.toolNames).toContain("awshook")
      },
    })

    // The registry is module-global; unregister the leaked test domain so it
    // doesn't bleed into other suites in the same process.
    registerProvider("awstest", () => ({ key: "awstest", agentSpecs: () => [] }))
  }, 30000)
})
