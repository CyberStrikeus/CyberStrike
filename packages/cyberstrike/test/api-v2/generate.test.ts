import { expect, test } from "bun:test"
import { listen } from "../../src/api-v2/server"
import { tmpdir } from "../fixture/fixture"

const ID = "fixture-generate"

// The provider points at a closed local port, so a real generation attempt fails without any network access.
test("generate.text reports unknown models, variants, and failed generations with declared errors", async () => {
  await using tmp = await tmpdir({
    config: {
      model: `${ID}/test`,
      enabled_providers: [ID],
      provider: {
        [ID]: {
          npm: "@ai-sdk/openai-compatible",
          options: { apiKey: "test", baseURL: "http://127.0.0.1:1/v1" },
          models: { test: { name: "Test", limit: { context: 128000, output: 4096 } } },
        },
      },
    },
  })
  // generate takes no location, so it resolves the base configuration from the server's working directory.
  const cwd = process.cwd()
  process.chdir(tmp.path)
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const call = (body: unknown) =>
    fetch(new URL("/api/experimental/generate", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  try {
    const unknown = await call({ prompt: "hello", model: { id: "no-model", providerID: "no-provider" } })
    expect(unknown.status).toBe(400)
    expect((await unknown.json())._tag).toBe("InvalidRequestError")

    const variant = await call({ prompt: "hello", model: { id: "test", providerID: ID, variant: "fast" } })
    expect(variant.status).toBe(400)

    const failed = await call({ prompt: "hello", model: { id: "test", providerID: ID } })
    expect(failed.status).toBe(503)
    expect((await failed.json())._tag).toBe("ServiceUnavailableError")
  } finally {
    await server.stop()
    process.chdir(cwd)
  }
}, 120_000)
