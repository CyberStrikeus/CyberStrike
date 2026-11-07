import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { SessionRoutes } from "../../src/server/routes/session"
import { SpawnedProfiles } from "../../src/session/web/spawned-profiles"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// The routes read/close from the same SpawnedProfiles registry the spawn route writes to,
// so we seed it with mock procs (no real browser is launched or killed).
async function withApp(fn: (app: Hono) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      SpawnedProfiles._reset()
      await fn(new Hono().route("/session", SessionRoutes()))
    },
  })
}

describe("spawned role browser lifecycle routes", () => {
  test("GET web/spawned-count reflects tracked procs", async () => {
    await withApp(async (app) => {
      SpawnedProfiles.track("s1", { kill: () => {} })
      SpawnedProfiles.track("s1", { kill: () => {} })
      const res = await app.request("/session/s1/web/spawned-count")
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ count: 2 })
    })
  })

  test("POST web/close-profiles kills them and reports the count", async () => {
    await withApp(async (app) => {
      let killedA = 0
      let killedB = 0
      SpawnedProfiles.track("s1", { kill: () => (killedA += 1) })
      SpawnedProfiles.track("s1", { kill: () => (killedB += 1) })
      const res = await app.request("/session/s1/web/close-profiles", { method: "POST" })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ closed: 2 })
      expect(killedA).toBe(1)
      expect(killedB).toBe(1)
      // registry cleared → count is now 0
      const cnt = await app.request("/session/s1/web/spawned-count")
      expect(await cnt.json()).toEqual({ count: 0 })
    })
  })

  test("close-profiles on a session with none closes 0", async () => {
    await withApp(async (app) => {
      const res = await app.request("/session/empty/web/close-profiles", { method: "POST" })
      expect(await res.json()).toEqual({ closed: 0 })
    })
  })
})
