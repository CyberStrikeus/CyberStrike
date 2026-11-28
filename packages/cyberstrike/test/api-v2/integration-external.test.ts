import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { listen } from "../../src/api-v2/server"
import { Auth } from "../../src/auth"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { tmpdir } from "../fixture/fixture"

const ID = "fixture-external"
const ENV = "FIXTURE_EXTERNAL_TOKEN"

const config = {
  model: `${ID}/test`,
  enabled_providers: [ID],
  provider: {
    [ID]: {
      npm: "@ai-sdk/openai-compatible",
      env: [ENV],
      options: { baseURL: "http://127.0.0.1:1/v1" },
      models: { test: { name: "Test", limit: { context: 128000, output: 4096 } } },
    },
  },
}

test("connect external stores an env reference, never the secret, and resolves it at use time", async () => {
  await using tmp = await tmpdir({ config })
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const query = `directory=${encodeURIComponent(tmp.path)}`
  const connect = (integrationID: string, body: unknown) =>
    fetch(new URL(`/api/integration/${integrationID}/connect/external?${query}`, server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  const secret = "sk-fixture-external-secret"
  try {
    const unknown = await connect("no-such-integration", { methodID: "external" })
    expect(unknown.status).toBe(404)
    expect((await unknown.json())._tag).toBe("IntegrationNotFoundError")

    const wrongMethod = await connect(ID, { methodID: "0" })
    expect(wrongMethod.status).toBe(400)
    expect((await wrongMethod.json())._tag).toBe("InvalidRequestError")

    const undeclared = await connect(ID, { methodID: "external", answer: { env: "NOT_DECLARED" } })
    expect(undeclared.status).toBe(400)

    // The variable must be set before the reference is stored.
    delete process.env[ENV]
    const unset = await connect(ID, { methodID: "external" })
    expect(unset.status).toBe(400)
    expect(await Auth.get(ID)).toBeUndefined()

    process.env[ENV] = secret
    const connected = await connect(ID, { methodID: "external" })
    expect(connected.status).toBe(204)
    expect(await Auth.get(ID)).toEqual({ type: "external", env: ENV })

    const stored = await fs.readFile(path.join(Global.Path.data, "auth.json"), "utf8")
    expect(stored).not.toContain(secret)

    const listed = await (await fetch(new URL(`/api/integration/${ID}?${query}`, server.url))).json()
    expect(listed.data.connections).toContainEqual(expect.objectContaining({ type: "credential", method: "external" }))

    // Provider state is built once per instance, so the loader is checked in a fresh instance that starts after the variable is set.
    await using fresh = await tmpdir({ config })
    const key = await Instance.provide({ directory: fresh.path, fn: async () => (await Provider.list())[ID]?.key })
    expect(key).toBe(secret)

    delete process.env[ENV]
    const info = await Auth.get(ID)
    expect(Auth.available(info)).toBe(false)
    const thrown = (() => {
      try {
        Auth.resolve(info)
      } catch (error) {
        return error
      }
    })()
    expect(Auth.ExternalUnavailableError.isInstance(thrown)).toBe(true)
    expect(Auth.resolve({ type: "api", key: "sk-plain" })).toBe("sk-plain")
  } finally {
    delete process.env[ENV]
    await Auth.remove(ID)
    await server.stop()
  }
}, 60_000)
