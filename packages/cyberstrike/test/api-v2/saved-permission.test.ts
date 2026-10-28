import { expect, test } from "bun:test"
import { Effect } from "effect"
import { listen } from "../../src/api-v2/server"
import { inInstance } from "../../src/api-v2/instance"
import { Instance } from "../../src/project/instance"
import { PermissionNext } from "../../src/permission/next"
import { PermissionSaved } from "../../src/permission/saved"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

test("saved permissions persist from an always reply, bind later asks, and follow the v2 routes", async () => {
  await using tmp = await tmpdir({ git: true })
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const call = (method: string, route: string, body?: unknown) =>
    fetch(new URL(route, server.url), {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  try {
    const session = await Effect.runPromise(inInstance(tmp.path, () => Session.create({})))
    const projectID = await Effect.runPromise(inInstance(tmp.path, async () => Instance.project.id))

    const asked = await call("POST", `/api/session/${session.id}/permission`, {
      action: "bash",
      resources: ["ls -la"],
      save: ["ls *"],
    })
    expect((await asked.json()).data.effect).toBe("ask")
    const pending = (await (await call("GET", `/api/session/${session.id}/permission`)).json()).data
    expect(pending).toHaveLength(1)

    const replied = await call("POST", `/api/session/${session.id}/permission/${pending[0].id}/reply`, {
      decision: "always",
    })
    expect(replied.status).toBe(204)

    const listed = await (await call("GET", `/api/permission/saved?projectID=${projectID}`)).json()
    expect(listed.data).toEqual([
      expect.objectContaining({
        projectID,
        action: "bash",
        resource: "ls *",
        time: { created: expect.any(Number), updated: expect.any(Number) },
      }),
    ])
    const [saved] = listed.data

    // A new ask that matches the saved rule is allowed without a pending request.
    const outcome = await Effect.runPromise(
      inInstance(tmp.path, async () => {
        const ask = PermissionNext.ask({
          sessionID: session.id,
          permission: "bash",
          patterns: ["ls -la"],
          metadata: {},
          always: [],
          ruleset: [],
        }).then(() => "allowed")
        return Promise.race([ask, Bun.sleep(300).then(() => "pending")])
      }),
    )
    expect(outcome).toBe("allowed")

    // An ask that matches no saved rule still stays pending, so only the first permission was saved.
    const other = await call("POST", `/api/session/${session.id}/permission`, {
      action: "bash",
      resources: ["rm x"],
      save: ["rm *"],
    })
    expect((await other.json()).data.effect).toBe("ask")
    const afterOther = await (await call("GET", `/api/permission/saved?projectID=${projectID}`)).json()
    expect(afterOther.data).toHaveLength(1)

    const renamed = await call("PATCH", `/api/permission/saved/${saved.id}`, { resource: "ls -l *" })
    expect(renamed.status).toBe(200)
    expect((await renamed.json()).data).toMatchObject({ id: saved.id, resource: "ls -l *", action: "bash" })

    await Effect.runPromise(inInstance(tmp.path, async () => PermissionSaved.save(projectID, "edit", "src/*")))
    const clash = await call("PATCH", `/api/permission/saved/${saved.id}`, { action: "edit", resource: "src/*" })
    expect(clash.status).toBe(409)
    expect((await clash.json())._tag).toBe("ConflictError")

    const missing = await call("PATCH", "/api/permission/saved/psv_missing", { resource: "x" })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ _tag: "PermissionSavedNotFoundError", id: "psv_missing" })

    expect((await call("DELETE", `/api/permission/saved/${saved.id}`)).status).toBe(204)
    expect((await call("DELETE", `/api/permission/saved/${saved.id}`)).status).toBe(204)
    const rest = await (await call("GET", `/api/permission/saved?projectID=${projectID}`)).json()
    expect(rest.data.map((row: { resource: string }) => row.resource)).toEqual(["src/*"])
  } finally {
    await server.stop()
  }
})
