import { expect, test } from "bun:test"
import { Auth } from "../../src/auth"
import { Credentials } from "../../src/auth/credentials"
import { listen } from "../../src/api-v2/server"

const LEGACY = "fixture-credential-legacy"
const FRESH = "fixture-credential-fresh"

test("credential store reads the v1 record as the active credential and keeps it in sync", async () => {
  await Auth.set(LEGACY, { type: "api", key: "sk-legacy" })
  try {
    const listed = await Credentials.list()
    expect(listed.filter((entry) => entry.integrationID === LEGACY)).toEqual([
      { id: `cred_${LEGACY}`, integrationID: LEGACY, label: LEGACY, active: true, value: { type: "key", key: "sk-legacy" } },
    ])

    const added = await Credentials.create({
      integrationID: LEGACY,
      label: "work",
      value: { type: "key", key: "sk-work" },
      activate: false,
    })
    expect(added).toMatchObject({ integrationID: LEGACY, label: "work", active: false })
    expect((await Auth.get(LEGACY))).toEqual({ type: "api", key: "sk-legacy" })

    expect(await Credentials.activate(added!.id)).toBe(true)
    expect(await Auth.get(LEGACY)).toEqual({ type: "api", key: "sk-work" })
    const after = (await Credentials.list()).filter((entry) => entry.integrationID === LEGACY)
    expect(after.map((entry) => [entry.label, entry.active])).toEqual([
      [LEGACY, false],
      ["work", true],
    ])

    expect(await Credentials.update(added!.id, "renamed")).toBe(true)
    expect((await Credentials.list()).find((entry) => entry.id === added!.id)?.label).toBe("renamed")

    expect(await Credentials.remove(added!.id)).toBe(true)
    expect(await Auth.get(LEGACY)).toBeUndefined()
  } finally {
    await Credentials.remove(`cred_${LEGACY}`)
    await Auth.remove(LEGACY)
  }
})

test("credential store adopts a v1 record written outside the store and refuses duplicate ids", async () => {
  await Auth.set(FRESH, { type: "api", key: "sk-first" })
  try {
    const first = await Credentials.create({
      integrationID: FRESH,
      value: { type: "key", key: "sk-manual" },
    })
    expect(first).toMatchObject({ active: true })
    expect(await Credentials.create({ id: first!.id, integrationID: FRESH, value: { type: "key", key: "x" } })).toBeUndefined()

    await Auth.set(FRESH, { type: "api", key: "sk-v1-login" })
    const adopted = (await Credentials.list()).filter((entry) => entry.integrationID === FRESH && entry.active)
    expect(adopted).toEqual([
      expect.objectContaining({ id: `cred_${FRESH}`, value: { type: "key", key: "sk-v1-login" } }),
    ])

    await Auth.remove(FRESH)
    expect((await Credentials.list()).filter((entry) => entry.integrationID === FRESH && entry.active)).toEqual([])
  } finally {
    await Credentials.remove(`cred_${FRESH}`)
    for (const entry of await Credentials.list()) if (entry.integrationID === FRESH) await Credentials.remove(entry.id)
    await Auth.remove(FRESH)
  }
})

test("credential routes answer with the declared bodies and statuses", async () => {
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const call = (method: string, route: string, body?: unknown) =>
    fetch(new URL(route, server.url), {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const ID = "fixture-credential-route"
  try {
    const created = await call("POST", "/api/credential", {
      id: "cred_route_fixture",
      integrationID: ID,
      label: "route",
      value: { type: "key", key: "sk-route" },
    })
    expect(created.status).toBe(200)
    expect((await created.json()).data).toMatchObject({ id: "cred_route_fixture", integrationID: ID, active: true })

    const conflict = await call("POST", "/api/credential", {
      id: "cred_route_fixture",
      integrationID: ID,
      value: { type: "key", key: "sk-other" },
    })
    expect(conflict.status).toBe(409)
    expect((await conflict.json())._tag).toBe("ConflictError")

    const listed = await call("GET", "/api/credential")
    expect(listed.status).toBe(200)
    expect((await listed.json()).data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "cred_route_fixture", active: true })]),
    )

    expect((await call("PATCH", "/api/credential/cred_route_fixture", { label: "renamed" })).status).toBe(204)
    expect((await call("POST", "/api/credential/cred_route_fixture/activate")).status).toBe(204)

    const missing = await call("PATCH", "/api/credential/cred_missing", { label: "x" })
    expect(missing.status).toBe(404)
    expect((await call("POST", "/api/credential/cred_missing/activate")).status).toBe(404)

    expect((await call("DELETE", "/api/credential/cred_route_fixture")).status).toBe(204)
    expect((await call("DELETE", "/api/credential/cred_route_fixture")).status).toBe(204)
    expect(await Auth.get(ID)).toBeUndefined()
  } finally {
    await Credentials.remove("cred_route_fixture")
    await Auth.remove(ID)
    await server.stop()
  }
})
