import { expect, test } from "bun:test"
import { listen } from "../../src/api-v2/server"
import { tmpdir } from "../fixture/fixture"

const ID = "fixture-integration"

test("integrations list the configured provider, store a key, and reject unknown ids with typed errors", async () => {
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
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const base = server.url
  const query = `directory=${encodeURIComponent(tmp.path)}`
  const call = (route: string, init?: { method?: string; body?: unknown }) =>
    fetch(new URL(`${route}${route.includes("?") ? "&" : "?"}${query}`, base), {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  try {
    const listed = await (await call("/api/integration")).json()
    const fixture = listed.data.find((item: { id: string }) => item.id === ID)
    expect(fixture).toMatchObject({ id: ID, methods: [{ type: "key", label: "API key" }], connections: [] })

    const got = await call(`/api/integration/${ID}`)
    expect(got.status).toBe(200)
    expect((await got.json()).data).toMatchObject({ id: ID })

    const missing = await call("/api/integration/no-such-integration")
    expect(missing.status).toBe(404)
    expect((await missing.json())._tag).toBe("IntegrationNotFoundError")

    const connected = await call(`/api/integration/${ID}/connect/key`, { body: { key: "sk-fixture" } })
    expect(connected.status).toBe(204)
    const after = await (await call(`/api/integration/${ID}`)).json()
    expect(after.data.connections).toEqual([
      expect.objectContaining({ type: "credential", label: ID, method: "key" }),
    ])

    const unknownKey = await call("/api/integration/no-such-integration/connect/key", { body: { key: "x" } })
    expect(unknownKey.status).toBe(404)

    const unknownMethod = await call(`/api/integration/${ID}/connect/oauth`, {
      body: { methodID: "0" },
    })
    expect(unknownMethod.status).toBe(400)
    expect((await unknownMethod.json())._tag).toBe("InvalidRequestError")

    const attempt = await call(`/api/integration/${ID}/connect/oauth/con_missing`)
    expect(attempt.status).toBe(404)
    expect((await attempt.json())._tag).toBe("IntegrationAttemptNotFoundError")

    const complete = await call(`/api/integration/${ID}/connect/oauth/con_missing/complete`, { body: {} })
    expect(complete.status).toBe(404)

    const cancel = await call(`/api/integration/${ID}/connect/oauth/con_missing`, { method: "DELETE" })
    expect(cancel.status).toBe(204)
  } finally {
    await server.stop()
  }
}, 60_000)
