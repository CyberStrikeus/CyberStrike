import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { SessionRoutes } from "../../src/server/routes/session"
import { Session } from "../../src/session"
import { vortexSignals } from "../../src/session/web/vortex-bridge"
import { WebInspect } from "../../src/session/web/web-inspect"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// Ingest → VORTEX (three-surface slice 1 parity proof). The ingest handler feeds every hit to Vortex,
// which runs the deterministic rules/canary and routes signals to the retest pipeline via the bridge.
// These assert that path end-to-end through the real route (dry-run skips the LLM enqueue). If they
// hold, Vortex is at parity with the CS fabric — the fabric can be retired with no detection loss.
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

const ingest = (
  app: Hono,
  sid: string,
  host: string,
  target: string,
  response?: { status: number; headers: Record<string, string>; body: string },
) =>
  app.request(`/session/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionID: sid, text: `GET ${target} HTTP/1.1\r\nHost: ${host}\r\n\r\n`, response }),
  })

const rules = (sid: string) => vortexSignals(sid).signals.map((s) => s.ruleId)

describe("ingest → Vortex (real route wiring, #15 slice 1 parity)", () => {
  test("HTML error page: full-path-disclosure + stack-trace recorded by Vortex on the raw body", async () => {
    await withSession(async (app, sid) => {
      const body = 'Traceback (most recent call last):\n  File "/var/www/app/main.py", line 42, in handler\n  raise ValueError'
      const resp = { status: 500, headers: { "content-type": "text/html" }, body }
      expect((await ingest(app, sid, "shop.example.com", "/boom", resp)).status).toBe(202)

      const ids = rules(sid)
      expect(ids).toContain("stack-trace-signature")
      expect(ids).toContain("full-path-disclosure")
    })
  })

  test("banner + weak cookie carry the correct owning specialist (per-rule owner overrides)", async () => {
    await withSession(async (app, sid) => {
      const resp = {
        status: 200,
        headers: { "content-type": "application/json", server: "nginx/1.18.0", "set-cookie": "SID=abc; Path=/" },
        body: "{}",
      }
      expect((await ingest(app, sid, "api.example.com", "/v1/ping", resp)).status).toBe(202)

      const sigs = vortexSignals(sid).signals
      expect(sigs.find((s) => s.ruleId === "server-banner")?.owner).toBe("config-deployment")
      expect(sigs.find((s) => s.ruleId === "weak-cookie-flags")?.owner).toBe("session-management")
    })
  })

  test("clean, well-secured HTML page produces no signals", async () => {
    await withSession(async (app, sid) => {
      const resp = {
        status: 200,
        headers: {
          "content-type": "text/html",
          "content-security-policy": "default-src 'self'",
          "strict-transport-security": "max-age=63072000",
          "x-frame-options": "DENY",
          "x-content-type-options": "nosniff",
        },
        body: "<html><body>welcome</body></html>",
      }
      expect((await ingest(app, sid, "safe.example.com", "/home", resp)).status).toBe(202)
      expect(vortexSignals(sid).signals).toHaveLength(0)
    })
  })

  test("re-ingesting the identical shape+value does not duplicate the signal (Vortex per-endpoint dedup)", async () => {
    await withSession(async (app, sid) => {
      const resp = { status: 500, headers: { "content-type": "text/html" }, body: "Exception in thread main\n  at app.Handler(Main.java:42)" }
      expect((await ingest(app, sid, "shop.example.com", "/dup", resp)).status).toBe(202)
      expect((await ingest(app, sid, "shop.example.com", "/dup", resp)).status).toBe(202)

      const stackTraces = vortexSignals(sid).signals.filter((s) => s.ruleId === "stack-trace-signature")
      expect(stackTraces).toHaveLength(1)
    })
  })

  test("ingest with no response body is safe (no crash, no signals)", async () => {
    await withSession(async (app, sid) => {
      expect((await ingest(app, sid, "shop.example.com", "/nobody")).status).toBe(202)
      expect(vortexSignals(sid).signals).toHaveLength(0)
    })
  })

  test("a Vortex signal enqueues a retest routed to the owning specialist", async () => {
    await withSession(async (app, sid) => {
      const resp = { status: 500, headers: { "content-type": "text/html" }, body: "You have an error in your SQL syntax near ''" }
      expect((await ingest(app, sid, "shop.example.com", "/q", resp)).status).toBe(202)

      const retest = WebInspect.getPending(sid).find((r) => (r.flags.signal ?? []).length > 0)
      expect(retest).toBeDefined()
      expect(retest?.key_hash).toBeTruthy()
      // Vortex routes the sql-error signal as `injection:input-validation` (WSTG 4.7 owner).
      expect(retest?.flags.signal?.some((v) => v.includes("input-validation"))).toBe(true)
      expect(retest?.priority).toBe("high")
    })
  })

})
