import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { SessionRoutes } from "../../src/server/routes/session"
import { PageState } from "../../src/session/web/page-state"
import { WebControl } from "../../src/session/web/control"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// The /web/action "allow → relay" branch and the WS /web/control channel need a live WS
// client, so they are NOT exercised here (WebControl unit tests cover send/ack). We test
// observe → page-state, and the guard branches of /web/action (deny 403 / confirm 409 /
// no-extension 503) via Hono app.request.
async function withApp(fn: (app: Hono, sid: string) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      PageState._reset()
      WebControl._reset()
      await fn(new Hono().route("/session", SessionRoutes()), "s1")
    },
  })
}
const post = (app: Hono, path: string, body: unknown) =>
  app.request(`/session/s1/web/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

const clickables = [
  { id: "e1", tag: "button", role: "", label: "Delete User", href: "" }, // destructive → confirm
  { id: "e2", tag: "a", role: "", label: "Home", href: "/home" }, // nav → allow
  { id: "e3", tag: "button", role: "", label: "Log out", href: "" }, // logout → deny
]

describe("POST /web/observe → GET /web/page-state", () => {
  test("stores + annotates; page-state returns policies", async () => {
    await withApp(async (app) => {
      const res = await post(app, "observe", { url: "https://h/u", clickables })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.kinds.destructive).toBe(1)
      expect(body.kinds.logout).toBe(1)

      const st = await (await app.request(`/session/s1/web/page-state?url=${encodeURIComponent("https://h/u")}`)).json()
      const pol = Object.fromEntries(st.clickables.map((c: { id: string; policy: string }) => [c.id, c.policy]))
      expect(pol).toEqual({ e1: "confirm", e2: "allow", e3: "deny" })
    })
  })
  test("view filters clickables to a kind", async () => {
    await withApp(async (app) => {
      await post(app, "observe", { url: "https://h/u", clickables })
      const st = await (await app.request(`/session/s1/web/page-state?url=${encodeURIComponent("https://h/u")}&view=nav`)).json()
      expect(st.clickables.map((c: { id: string }) => c.id)).toEqual(["e2"])
    })
  })
  test("page-state for an unknown url → 404", async () => {
    await withApp(async (app) => {
      const res = await app.request("/session/s1/web/page-state?url=https://h/nope")
      expect(res.status).toBe(404)
    })
  })
})

describe("POST /web/action — guard enforcement", () => {
  test("logout element is denied (403)", async () => {
    await withApp(async (app) => {
      await post(app, "observe", { url: "https://h/u", clickables })
      const res = await post(app, "action", { op: "click", url: "https://h/u", element_id: "e3" })
      expect(res.status).toBe(403)
      expect((await res.json()).policy).toBe("deny")
    })
  })
  test("destructive element needs confirmation (409)", async () => {
    await withApp(async (app) => {
      await post(app, "observe", { url: "https://h/u", clickables })
      const res = await post(app, "action", { op: "click", url: "https://h/u", element_id: "e1" })
      expect(res.status).toBe(409)
      expect((await res.json()).policy).toBe("confirm")
    })
  })
  test("allowed element with no extension connected → 503 (no-extension)", async () => {
    await withApp(async (app) => {
      await post(app, "observe", { url: "https://h/u", clickables })
      const res = await post(app, "action", { op: "click", url: "https://h/u", element_id: "e2" })
      expect(res.status).toBe(503)
    })
  })
  test("navigate with no url → 400", async () => {
    await withApp(async (app) => {
      const res = await post(app, "action", { op: "navigate" })
      expect(res.status).toBe(400)
    })
  })
  test("click on unknown element → 404", async () => {
    await withApp(async (app) => {
      await post(app, "observe", { url: "https://h/u", clickables })
      const res = await post(app, "action", { op: "click", url: "https://h/u", element_id: "nope" })
      expect(res.status).toBe(404)
    })
  })
})
