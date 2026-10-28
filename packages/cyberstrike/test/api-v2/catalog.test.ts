import { expect, test } from "bun:test"
import { listen } from "../../src/api-v2/server"
import { tmpdir } from "../fixture/fixture"

const provider = {
  npm: "@ai-sdk/openai-compatible",
  options: { apiKey: "test", baseURL: "http://127.0.0.1:1/v1" },
  models: { test: { name: "Test", limit: { context: 128000, output: 4096 } } },
}

test("agent, provider, command, and skill lookups answer from the directory's own config", async () => {
  await using tmp = await tmpdir({
    config: {
      model: "contract/test",
      enabled_providers: ["contract"],
      provider: { contract: provider },
      command: { "contract-cmd": { template: "say hi", description: "contract command" } },
    },
  })
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const call = (route: string) =>
    fetch(new URL(`${route}${route.includes("?") ? "&" : "?"}directory=${encodeURIComponent(tmp.path)}`, server.url))
  try {
    const agent = await call("/api/agent/cyberstrike")
    expect(agent.status).toBe(200)
    expect((await agent.json()).data).toMatchObject({ id: "cyberstrike", name: "cyberstrike" })

    const missingAgent = await call("/api/agent/no-such-agent")
    expect(missingAgent.status).toBe(404)
    expect(await missingAgent.json()).toMatchObject({ _tag: "AgentNotFoundError", agentID: "no-such-agent" })

    const found = await call("/api/provider/contract")
    expect(found.status).toBe(200)
    expect((await found.json()).data).toMatchObject({ id: "contract", name: expect.any(String), activation: "enabled" })

    const missingProvider = await call("/api/provider/no-such-provider")
    expect(missingProvider.status).toBe(404)
    expect(await missingProvider.json()).toMatchObject({
      _tag: "ProviderNotFoundError",
      providerID: "no-such-provider",
    })

    const commands = await (await call("/api/command")).json()
    expect(commands.data).toContainEqual({ name: "contract-cmd", description: "contract command" })

    const skills = await call("/api/skill")
    expect(skills.status).toBe(200)
    expect(Array.isArray((await skills.json()).data)).toBe(true)
  } finally {
    await server.stop()
  }
}, 60_000)
