import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { SessionRoutes } from "../../src/server/routes/session"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// The happy path spawns a real Chrome window, so it is NOT exercised here (that would
// pop a browser on the test host). The Chrome invocation itself is covered
// deterministically by hackbrowser's buildProfileArgs tests. Here we only assert the
// route's request contract.
async function withSession(fn: (app: Hono, sid: string) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const session = await Session.create({})
      const app = new Hono().route("/session", SessionRoutes())
      await fn(app, session.id)
    },
  })
}

describe("POST /session/:id/web/spawn-profile — contract", () => {
  test("rejects a body with no url (400)", async () => {
    await withSession(async (app, sid) => {
      const res = await app.request(`/session/${sid}/web/spawn-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user" }),
      })
      expect(res.status).toBe(400)
    })
  })
})
