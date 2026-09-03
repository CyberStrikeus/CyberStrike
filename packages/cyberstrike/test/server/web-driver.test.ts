import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { SessionRoutes } from "../../src/server/routes/session"
import { WebDriver } from "../../src/session/web/driver"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

async function withApp(fn: (app: Hono) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      WebDriver._reset()
      await fn(new Hono().route("/session", SessionRoutes()))
    },
  })
}

describe("POST/GET /session/:id/web/driver", () => {
  test("POST sets the driver; GET reads it back", async () => {
    await withApp(async (app) => {
      const post = await app.request("/session/s1/web/driver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driver: "human" }),
      })
      expect(post.status).toBe(200)
      expect(await post.json()).toEqual({ ok: true, driver: "human" })
      expect(WebDriver.get("s1")).toBe("human")

      const get = await app.request("/session/s1/web/driver")
      expect(await get.json()).toEqual({ driver: "human" })
    })
  })

  test("GET on an unreported session → null", async () => {
    await withApp(async (app) => {
      const get = await app.request("/session/none/web/driver")
      expect(await get.json()).toEqual({ driver: null })
    })
  })

  test("POST with an invalid driver → 400", async () => {
    await withApp(async (app) => {
      const post = await app.request("/session/s1/web/driver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driver: "bogus" }),
      })
      expect(post.status).toBe(400)
    })
  })
})
