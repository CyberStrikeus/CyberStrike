import { expect, test } from "bun:test"
import { Effect } from "effect"
import { listen } from "../../src/api-v2/server"
import { inInstance } from "../../src/api-v2/instance"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

test("session permission create evaluates session rules and leaves ask requests pending", async () => {
  await using tmp = await tmpdir()
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const call = (method: string, route: string, body?: unknown) =>
    fetch(new URL(route, server.url), {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  try {
    const rules = [{ permission: "bash", pattern: "rm *", action: "deny" as const }]
    const denied = await Effect.runPromise(inInstance(tmp.path, () => Session.create({ permission: rules })))
    const plain = await (await call("POST", "/api/session", { location: { directory: tmp.path } })).json()

    const deny = await call("POST", `/api/session/${denied.id}/permission`, { action: "bash", resources: ["rm -rf x"] })
    expect(deny.status).toBe(200)
    expect((await deny.json()).data.effect).toBe("deny")

    const ask = await call("POST", `/api/session/${plain.data.id}/permission`, { action: "bash", resources: ["ls"] })
    expect(ask.status).toBe(200)
    const created = (await ask.json()).data
    expect(created).toMatchObject({ effect: "ask" })

    const pending = await (await call("GET", `/api/session/${plain.data.id}/permission`)).json()
    expect(pending.data.map((row: { id: string }) => row.id)).toContain(created.id)

    expect(
      (await call("POST", `/api/session/${plain.data.id}/permission/${created.id}/reply`, { decision: "once" })).status,
    ).toBe(204)
    const after = await (await call("GET", `/api/session/${plain.data.id}/permission`)).json()
    expect(after.data.map((row: { id: string }) => row.id)).not.toContain(created.id)
  } finally {
    await server.stop()
  }
})
