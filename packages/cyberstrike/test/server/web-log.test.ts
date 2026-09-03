import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { SessionRoutes } from "../../src/server/routes/session"
import { HBLog } from "../../src/session/web/hblog"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

async function withApp(fn: (app: Hono) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      HBLog._reset()
      await fn(new Hono().route("/session", SessionRoutes()))
    },
  })
}

describe("POST/GET /session/:id/web/log", () => {
  test("extension-posted events are read back with the file path", async () => {
    await withApp(async (app) => {
      const post = await app.request("/session/s1/web/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "control-ws-open", data: { note: "x" } }),
      })
      expect(post.status).toBe(200)
      expect(await post.json()).toEqual({ ok: true })

      const got = await (await app.request("/session/s1/web/log")).json()
      expect(got.file).toContain("s1.jsonl")
      expect(got.entries.length).toBe(1)
      expect(got.entries[0].source).toBe("extension") // default source when unspecified
      expect(got.entries[0].event).toBe("control-ws-open")
    })
  })

  test("GET on a session with no events → empty list", async () => {
    await withApp(async (app) => {
      const got = await (await app.request("/session/none/web/log")).json()
      expect(got.entries).toEqual([])
    })
  })
})
