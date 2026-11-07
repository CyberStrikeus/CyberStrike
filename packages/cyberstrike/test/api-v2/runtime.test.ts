import { expect, test } from "bun:test"
import { listen } from "../../src/api-v2/server"
import { tmpdir } from "../fixture/fixture"

test("plugin, project, location, config shell, and migration endpoints answer with real state", async () => {
  await using tmp = await tmpdir({ git: true })
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const at = (route: string) =>
    new URL(`${route}${route.includes("?") ? "&" : "?"}directory=${encodeURIComponent(tmp.path)}`, server.url)
  const json = (route: string, init?: RequestInit) => fetch(at(route), init)
  try {
    const plugins = await json("/api/plugin")
    expect(plugins.status).toBe(200)
    expect((await plugins.json()).data).toEqual([])

    const unknownCheck = await json("/api/plugin/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "not-configured" }),
    })
    expect(unknownCheck.status).toBe(400)
    expect((await unknownCheck.json())._tag).toBe("InvalidRequestError")

    const unknownUpdate = await json("/api/plugin/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targets: ["not-configured"] }),
    })
    expect(unknownUpdate.status).toBe(400)

    const reload = await fetch(new URL("/api/location/reload", server.url), { method: "POST" })
    expect(reload.status).toBe(204)

    const shells = await (await fetch(new URL("/api/config/shell", server.url))).json()
    expect(shells).toHaveLength(1)
    expect(shells[0]).toMatchObject({ acceptable: true, name: expect.any(String), path: expect.any(String) })

    const migration = await (await fetch(new URL("/api/experimental/migration/v1", server.url))).json()
    expect(["required", "completed"]).toContain(migration.status)

    const projects = await (await fetch(new URL("/api/project", server.url))).json()
    const project = projects.find((row: { canonical: string }) => row.canonical === tmp.path)
    expect(project).toBeDefined()
    const renamed = await fetch(new URL(`/api/project/${project.id}`, server.url), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "contract project" }),
    })
    expect(renamed.status).toBe(200)
    expect(await renamed.json()).toMatchObject({ id: project.id, name: "contract project", canonical: tmp.path })

    const missing = await fetch(new URL("/api/project/prj_missing", server.url), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    })
    expect(missing.status).toBe(404)
    expect((await missing.json())._tag).toBe("ProjectNotFoundError")
  } finally {
    await server.stop()
  }
}, 60_000)
