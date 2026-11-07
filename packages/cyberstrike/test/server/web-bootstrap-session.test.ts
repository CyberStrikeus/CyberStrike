import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { SessionRoutes } from "../../src/server/routes/session"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// The extension's ensureSession() does exactly this: POST /session with an empty body
// to create the shared session up front (the "Browse anonymous" / "Add credential"
// chicken-egg fix). This locks that server contract.
async function withInstance(fn: (app: Hono) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const app = new Hono().route("/session", SessionRoutes())
      await fn(app)
    },
  })
}

describe("POST /session — ensureSession contract", () => {
  test("empty body creates a session and returns a string id", async () => {
    await withInstance(async (app) => {
      const res = await app.request("/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      expect(res.status).toBe(200)
      const session = await res.json()
      expect(typeof session.id).toBe("string")
      expect(session.id.length).toBeGreaterThan(0)
    })
  })
})
