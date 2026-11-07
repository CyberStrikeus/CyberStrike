import { describe, expect, test } from "bun:test"
import { ingestBrowserTransaction } from "../../src/session/web/vortex-bridge"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Identifier } from "../../src/id/id"

// #77 — only a transaction that produced a SPAWNING Vortex signal (routable, owned, non-observational)
// is `actionable` and so may enter the LLM loop. Technology-only and no-signal traffic stays Vortex-only.
describe("ingestBrowserTransaction actionable gate (#77)", () => {
  async function run(fn: (sid: string) => void) {
    await using dir = await tmpdir({ git: true })
    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const session = await Session.create({})
        fn(session.id)
      },
    })
  }

  function feed(sid: string, url: string, response: { status?: number; headers?: Record<string, string>; body?: string }) {
    return ingestBrowserTransaction({
      sessionID: sid,
      requestID: Identifier.ascending("request"),
      method: "GET",
      url,
      host: "shop.example.com",
      normalizedPath: new URL(url).pathname,
      keyHash: "kh-" + Identifier.ascending("request"),
      rawRequest: `GET ${new URL(url).pathname} HTTP/1.1\nHost: shop.example.com\n`,
      response,
    })
  }

  test("injection signal (SQL error) → actionable: true", async () => {
    await run((sid) => {
      const r = feed(sid, "https://shop.example.com/q", {
        status: 500,
        headers: { "content-type": "text/html" },
        body: "You have an error in your SQL syntax near ''",
      })
      expect(r.actionable).toBe(true)
    })
  })

  test("technology-only (/_next/ asset) → actionable: false", async () => {
    await run((sid) => {
      const r = feed(sid, "https://shop.example.com/_next/static/chunks/main.js", {
        status: 200,
        headers: { "content-type": "application/javascript" },
        body: "console.log('app')",
      })
      // a tech signal may fire, but technology is observational → not actionable
      expect(r.actionable).toBe(false)
    })
  })

  test("no signal (benign 200) → actionable: false", async () => {
    await run((sid) => {
      const r = feed(sid, "https://shop.example.com/about", {
        status: 200,
        headers: { "content-type": "text/html" },
        body: "<html><body>about us</body></html>",
      })
      expect(r.actionable).toBe(false)
    })
  })
})
