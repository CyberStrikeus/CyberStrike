import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { SessionRoutes } from "../../src/server/routes/session"
import { Session } from "../../src/session"
import { SignalStore } from "../../src/session/web/signal"
import { WebRetest } from "../../src/session/web/web-retest"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// Dry-run so the ingest handler skips the LLM enqueue; the signal fabric runs on the ingest path
// BEFORE the enqueue, so this verifies the real route → fabric → SignalStore wiring end-to-end.
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

describe("ingest → signal fabric (real route wiring)", () => {
  test("HTML error page: path-disclosure + stack-trace recorded (proves B1 — raw body scanned, not the stub)", async () => {
    await withSession(async (app, sid) => {
      const body = 'Traceback (most recent call last):\n  File "/var/www/app/main.py", line 42, in handler\n  raise ValueError'
      // content-type text/html → processResponse would store only the "This is an HTML response"
      // stub. Finding these signals proves the fabric ran on the RAW body at ingest.
      const resp = { status: 500, headers: { "content-type": "text/html" }, body }
      expect((await ingest(app, sid, "shop.example.com", "/boom", resp)).status).toBe(202)

      const signals = new SignalStore(sid).get()
      const types = signals.map((s) => s.signal_type)
      expect(types).toContain("stack_trace")
      expect(types).toContain("full_path_disclosure")
      // A new-shape signal links to the real request row id.
      const st = signals.find((s) => s.signal_type === "stack_trace")
      expect(st?.request_id.startsWith("req")).toBe(true)
    })
  })

  test("banner + weak cookie carry the correct owning specialist", async () => {
    await withSession(async (app, sid) => {
      const resp = {
        status: 200,
        headers: { "content-type": "application/json", server: "nginx/1.18.0", "set-cookie": "SID=abc; Path=/" },
        body: "{}",
      }
      expect((await ingest(app, sid, "api.example.com", "/v1/ping", resp)).status).toBe(202)

      const signals = new SignalStore(sid).get()
      const banner = signals.find((s) => s.signal_type === "server_banner")
      const cookie = signals.find((s) => s.signal_type === "weak_cookie_flags")
      // recon was merged into the security-misconfiguration specialist — server_banner now routes there.
      expect(banner?.owner).toBe("misconfiguration")
      expect(cookie?.owner).toBe("auth-session")
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
      expect(new SignalStore(sid).get()).toHaveLength(0)
    })
  })

  test("re-ingesting the same shape does not duplicate the signal (per-shape dedup via findId)", async () => {
    await withSession(async (app, sid) => {
      const resp = { status: 500, headers: { "content-type": "text/html" }, body: "Exception in thread main /etc/passwd" }
      // First = new shape (202). Second = duplicate (202, skipped) → runs the fabric with the
      // shape's canonical request id, so the signal dedups instead of piling up.
      expect((await ingest(app, sid, "shop.example.com", "/dup", resp)).status).toBe(202)
      expect((await ingest(app, sid, "shop.example.com", "/dup", resp)).status).toBe(202)

      const stackTraces = new SignalStore(sid).get().filter((s) => s.signal_type === "stack_trace")
      expect(stackTraces).toHaveLength(1)
    })
  })

  test("ingest with no response body is safe (no crash, no signals)", async () => {
    await withSession(async (app, sid) => {
      expect((await ingest(app, sid, "shop.example.com", "/nobody")).status).toBe(202)
      expect(new SignalStore(sid).get()).toHaveLength(0)
    })
  })

  test("a recorded signal enqueues a new_signal retest routed to the owning specialist (B4)", async () => {
    await withSession(async (app, sid) => {
      const resp = { status: 500, headers: { "content-type": "text/html" }, body: "You have an error in your SQL syntax near ''" }
      expect((await ingest(app, sid, "shop.example.com", "/q", resp)).status).toBe(202)

      const retest = WebRetest.getPending(sid).find((r) => (r.flags.signal ?? []).length > 0)
      expect(retest).toBeDefined()
      // Endpoint-keyed; the signal flag value encodes type:owner for routing.
      expect(retest?.key_hash).toBeTruthy()
      expect(retest?.flags.signal?.[0]).toContain("sql_error")
      expect(retest?.flags.signal?.[0]).toContain("injection")
      expect(retest?.priority).toBe("high")
    })
  })

  test("re-ingesting the same shape does not pile up retests (enqueue dedup)", async () => {
    await withSession(async (app, sid) => {
      const resp = { status: 500, headers: { "content-type": "text/html" }, body: "SQL syntax error near X" }
      await ingest(app, sid, "shop.example.com", "/q2", resp)
      await ingest(app, sid, "shop.example.com", "/q2", resp)
      const signalRetests = WebRetest.getPending(sid).filter((r) => (r.flags.signal ?? []).length > 0)
      expect(signalRetests).toHaveLength(1)
    })
  })
})
