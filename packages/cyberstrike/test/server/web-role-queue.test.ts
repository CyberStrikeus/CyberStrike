import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { SessionRoutes } from "../../src/server/routes/session"
import { RoleQueue } from "../../src/session/web/role-queue"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// capture-started's SPAWN branch launches a real browser, so it is NOT exercised here.
// We test the queue routes and the drain (no-next) path; the advance-and-spawn logic is
// covered by RoleQueue unit tests + spawn.buildProfileArgs tests.
async function withApp(fn: (app: Hono, sid: string) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      RoleQueue._reset()
      await fn(new Hono().route("/session", SessionRoutes()), "s1")
    },
  })
}
const post = (app: Hono, path: string, body: unknown) =>
  app.request(`/session/s1/web/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

describe("role-queue routes", () => {
  test("POST role-queue enqueues (dedup) and returns status", async () => {
    await withApp(async (app) => {
      await post(app, "role-queue", { roles: ["user", "admin"] })
      const res = await post(app, "role-queue", { roles: ["admin", "viewer"] }) // admin dup
      const s = await res.json()
      expect(s.roles.map((r: { label: string }) => r.label)).toEqual(["user", "admin", "viewer"])
      expect(s.setup).toBeNull()
    })
  })

  test("GET queue-status reflects the queue", async () => {
    await withApp(async (app) => {
      await post(app, "role-queue", { roles: ["user"] })
      const res = await app.request("/session/s1/web/queue-status")
      expect(res.status).toBe(200)
      expect((await res.json()).roles).toEqual([{ label: "user", phase: "pending" }])
    })
  })

  test("capture-started with no next role returns {next:null} and marks it capturing", async () => {
    await withApp(async (app) => {
      // Only the orchestrator role, nothing queued after it → no spawn.
      const res = await post(app, "capture-started", { role: "Anonymous", url: "https://x" })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ next: null, spawned: false })
      const st = await (await app.request("/session/s1/web/queue-status")).json()
      expect(st.roles).toEqual([{ label: "Anonymous", phase: "capturing" }])
    })
  })

  test("capture-started body without url is rejected (400)", async () => {
    await withApp(async (app) => {
      const res = await post(app, "capture-started", { role: "Anonymous" })
      expect(res.status).toBe(400)
    })
  })
})
