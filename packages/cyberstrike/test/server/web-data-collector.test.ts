import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { SessionRoutes } from "../../src/server/routes/session"
import { Session } from "../../src/session"
import { DataCollector } from "../../src/session/web/data-collector"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// Dry-run so the ingest handler skips the LLM enqueue; DataCollector.record still runs (it's on
// the ingest path before the enqueue), so we verify the real route→collector wiring end-to-end.
const prev = process.env.CYBERSTRIKE_INGEST_DRY_RUN
beforeAll(() => {
  process.env.CYBERSTRIKE_INGEST_DRY_RUN = "true"
})
afterAll(() => {
  if (prev === undefined) delete process.env.CYBERSTRIKE_INGEST_DRY_RUN
  else process.env.CYBERSTRIKE_INGEST_DRY_RUN = prev
})

async function withSession(fn: (app: Hono, sid: string) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const session = await Session.create({})
      await fn(new Hono().route("/session", SessionRoutes()), session.id)
    },
  })
}

// Post a captured request the way the extension does: a raw HTTP request line + Host, plus the
// optional response (status/headers/body).
const ingest = (app: Hono, sid: string, host: string, target: string, response?: { status: number; headers: Record<string, string>; body: string }) =>
  app.request(`/session/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionID: sid, text: `GET ${target} HTTP/1.1\r\nHost: ${host}\r\n\r\n`, response }),
  })

describe("ingest → DataCollector (real route wiring)", () => {
  test("captured traffic populates the per-session collected view", async () => {
    await withSession(async (app, sid) => {
      const host = "demo.testfire.net"
      const html = { status: 200, headers: { "content-type": "text/html", "x-powered-by": "PHP/8.2.0", "set-cookie": "PHPSESSID=abc; Path=/" }, body: "" }
      const js = { status: 200, headers: { "content-type": "application/javascript" }, body: "" }
      const api = { status: 200, headers: { "content-type": "application/json" }, body: "{}" }

      expect((await ingest(app, sid, host, "/account", html)).status).toBe(202)
      expect((await ingest(app, sid, host, "/static/app.js", js)).status).toBe(202)
      expect((await ingest(app, sid, host, "/api/users", api)).status).toBe(202)

      const d = DataCollector.latest(sid)
      // html + api became endpoints; js became a URL.
      const paths = d.endpoints.map((e) => `${e.kind} ${e.path}`)
      expect(paths).toContain("html /account")
      expect(paths).toContain("api /api/users")
      expect(d.jsUrls.some((u) => u.endsWith("/static/app.js"))).toBe(true)
      // server-side tech signals came through the response headers.
      expect(d.server.headers["x-powered-by"]).toBe("PHP/8.2.0")
      expect(d.server.cookies).toContain("PHPSESSID")
    })
  })
})
