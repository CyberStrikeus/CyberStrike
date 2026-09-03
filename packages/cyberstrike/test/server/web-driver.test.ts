import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { SessionRoutes } from "../../src/server/routes/session"
import { WebDriver } from "../../src/session/web/driver"
import { WebControl } from "../../src/session/web/control"
import { WebCoDrive } from "../../src/session/web/codrive"
import { PageState } from "../../src/session/web/page-state"
import { Crawl } from "../../src/session/web/crawl"
import { Effect } from "../../src/session/web/effect"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

async function withApp(fn: (app: Hono) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      WebDriver._reset()
      WebControl._reset()
      WebCoDrive._reset()
      PageState._reset()
      Crawl._reset()
      Effect._reset()
      await fn(new Hono().route("/session", SessionRoutes()))
    },
  })
}

const setDriver = (app: Hono, sid: string, driver: string) =>
  app.request(`/session/${sid}/web/driver`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ driver }),
  })

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

describe("driver route drives the co-driving loop (end-to-end, in-process)", () => {
  // A one-link site so the loop auto-advances (single candidate) — no planner/model call.
  function attachBrowser(sid: string) {
    let current = "https://h/a"
    let clock = 1
    const site: Record<string, { id: string; tag: string; role: string; label: string; href: string }[]> = {
      "https://h/a": [{ id: "E0", tag: "a", role: "link", label: "B", href: "/b" }],
      "https://h/b": [],
    }
    const observe = (url: string) => {
      current = url
      PageState.set(sid, { url, title: url, clickables: site[url] ?? [], forms: [], links: [], observed_at: ++clock })
    }
    WebControl.connect(sid, {
      send(data: string) {
        const msg = JSON.parse(data)
        if (msg.op === "click") {
          const el = (site[current] ?? []).find((c) => c.id === msg.elementId)
          if (el) observe(new URL(el.href, current).href)
        }
        WebControl.onAck(JSON.stringify({ id: msg.id, ok: true }))
      },
    })
    observe("https://h/a")
  }

  test("POST ai starts the loop (it crawls); POST human stops it", async () => {
    await withApp(async (app) => {
      attachBrowser("s1")
      const res = await setDriver(app, "s1", "ai")
      expect(await res.json()).toEqual({ ok: true, driver: "ai" })

      // Loop runs in the background (default humanized think-delays apply) — wait for coverage.
      const start = Date.now()
      while (WebCoDrive.isRunning("s1") && Date.now() - start < 8000) await new Promise((r) => setTimeout(r, 10))
      expect(Crawl.isPageVisited("s1", "https://h/b")).toBe(true)
      expect(Crawl.summary("s1").actions).toBeGreaterThanOrEqual(1)

      // Human takeover stops the loop + flips the interlock.
      await setDriver(app, "s1", "human")
      expect(WebCoDrive.isRunning("s1")).toBe(false)
      expect(WebDriver.isHuman("s1")).toBe(true)
    })
  })
})
