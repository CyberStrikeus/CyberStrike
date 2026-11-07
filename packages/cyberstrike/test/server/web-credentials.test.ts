import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { SessionRoutes } from "../../src/server/routes/session"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("POST /session/:id/web/credentials — reused flag", () => {
  test("first register is new; a case-variant re-register is reused, same credential", async () => {
    await using dir = await tmpdir({ git: true })
    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const sid = (await Session.create({})).id
        const app = new Hono().route("/session", SessionRoutes())
        const post = (label: string) =>
          app.request(`/session/${sid}/web/credentials`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label }),
          })

        const r1 = await (await post("Anonymous")).json()
        expect(r1.reused).toBe(false)

        const r2 = await (await post("anonymous")).json() // different casing → same role
        expect(r2.reused).toBe(true)
        expect(r2.id).toBe(r1.id)

        const list = await (await app.request(`/session/${sid}/web/credentials`)).json()
        expect(list.length).toBe(1) // one role, not two
        expect(list[0].label).toBe("Anonymous") // canonical casing kept
      },
    })
  })
})
