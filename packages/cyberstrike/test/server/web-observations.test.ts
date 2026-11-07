import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { SessionRoutes } from "../../src/server/routes/session"
import { Session } from "../../src/session"
import { UiObservation } from "../../src/session/web/ui-observation"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

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

const post = (app: Hono, sid: string, body: unknown) =>
  app.request(`/session/${sid}/web/observations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

describe("POST /session/:id/web/observations", () => {
  test("persists UI observations and reports new count", async () => {
    await withSession(async (app, sid) => {
      const res = await post(app, sid, {
        credential_id: "admin",
        page_url: "https://h.tld/users?tab=1",
        elements: [
          { role: "button", label: "Delete User" },
          { role: "button", label: "Edit" },
        ],
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ observed: 2 })

      const rows = UiObservation.forPage(sid, "https://h.tld/users")
      expect(rows.length).toBe(2)
      expect(rows.map((r) => r.label).sort()).toEqual(["Delete User", "Edit"])
      expect(rows.every((r) => r.credentialID === "admin")).toBe(true)
    })
  })

  test("dedup: re-posting the same observations records zero new", async () => {
    await withSession(async (app, sid) => {
      const body = {
        credential_id: "user",
        page_url: "https://h.tld/users",
        elements: [{ role: "button", label: "Edit" }],
      }
      expect(await (await post(app, sid, body)).json()).toEqual({ observed: 1 })
      expect(await (await post(app, sid, body)).json()).toEqual({ observed: 0 })
      expect(UiObservation.forPage(sid, "https://h.tld/users").length).toBe(1)
    })
  })

  test("anonymous (no credential_id) is accepted", async () => {
    await withSession(async (app, sid) => {
      const res = await post(app, sid, {
        page_url: "https://h.tld/x",
        elements: [{ role: "link", label: "Home" }],
      })
      expect(res.status).toBe(200)
      const rows = UiObservation.forPage(sid, "https://h.tld/x")
      expect(rows[0].credentialID).toBeNull()
    })
  })

  test("malformed body (missing page_url) is rejected", async () => {
    await withSession(async (app, sid) => {
      const res = await post(app, sid, { elements: [{ role: "button", label: "X" }] })
      expect(res.status).toBe(400)
    })
  })
})
