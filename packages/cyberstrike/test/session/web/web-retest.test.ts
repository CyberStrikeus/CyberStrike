import { describe, expect, test } from "bun:test"
import { WebRetest } from "../../../src/session/web/web-retest"
import { Request } from "../../../src/session/request"
import { Session } from "../../../src/session"
import { Instance } from "../../../src/project/instance"
import { tmpdir } from "../../fixture/fixture"

// request_id FKs to the request table, so retests must reference a real request.
async function withReq(fn: (sid: string, reqID: (path: string) => string) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const sid = (await Session.create({})).id
      const make = (path: string) => Request.add({ sessionID: sid, method: "GET", normalizedPath: path })!.id
      await fn(sid, make)
    },
  })
}

describe("WebRetest.enqueue — dedup keys on trigger_source", () => {
  test("same request, DIFFERENT trigger sources → distinct entries (cross-cred not swallowed)", async () => {
    await withReq(async (sid, make) => {
      const req = make("/a")
      // A request already pending for a signal detection …
      WebRetest.enqueue({ sessionID: sid, requestID: req, triggerType: "new_signal", triggerSource: "sig_a", priority: "medium" })
      // … then queued for a cross-credential retest (a different identity) must NOT be
      // swallowed into the signal entry — the org1 cross-cred intent has to surface.
      WebRetest.enqueue({ sessionID: sid, requestID: req, triggerType: "new_credential", triggerSource: "wcr_org1", priority: "high" })
      const forReq = WebRetest.getPending(sid).filter((r) => r.request_id === req)
      expect(forReq.length).toBe(2)
      expect(forReq.some((r) => r.trigger_type === "new_signal")).toBe(true)
      expect(forReq.some((r) => r.trigger_type === "new_credential")).toBe(true)
    })
  })

  test("same request, SAME trigger source → one entry, priority upgraded", async () => {
    await withReq(async (sid, make) => {
      const req = make("/b")
      WebRetest.enqueue({ sessionID: sid, requestID: req, triggerType: "new_credential", triggerSource: "wcr_org1", priority: "medium" })
      WebRetest.enqueue({ sessionID: sid, requestID: req, triggerType: "new_credential", triggerSource: "wcr_org1", priority: "high" })
      const forReq = WebRetest.getPending(sid).filter((r) => r.request_id === req)
      expect(forReq.length).toBe(1)
      expect(forReq[0].priority).toBe("high")
    })
  })

  test("two credentials (org1, org2) each get their own retest of the same endpoint", async () => {
    await withReq(async (sid, make) => {
      const req = make("/c")
      WebRetest.enqueue({ sessionID: sid, requestID: req, triggerType: "new_credential", triggerSource: "wcr_org1", priority: "high" })
      WebRetest.enqueue({ sessionID: sid, requestID: req, triggerType: "new_credential", triggerSource: "wcr_org2", priority: "high" })
      const forReq = WebRetest.getPending(sid).filter((r) => r.request_id === req)
      expect(forReq.length).toBe(2)
      expect(new Set(forReq.map((r) => r.trigger_source)).size).toBe(2)
    })
  })

  test("getPending resolves each retest's target endpoint (method + path)", async () => {
    await withReq(async (sid, make) => {
      const req = make("/api/user/1")
      WebRetest.enqueue({ sessionID: sid, requestID: req, triggerType: "new_credential", triggerSource: "org1", priority: "high" })
      const p = WebRetest.getPending(sid).find((r) => r.request_id === req)!
      expect(p.method).toBe("GET")
      expect(p.endpoint).toBe("/api/user/1")
    })
  })
})

describe("WebRetest.completeForRequest — deterministic completion drains the queue", () => {
  test("closes all pending retests for a request; others remain; idempotent", async () => {
    await withReq(async (sid, make) => {
      const a = make("/a")
      const b = make("/b")
      WebRetest.enqueue({ sessionID: sid, requestID: a, triggerType: "new_credential", triggerSource: "org1", priority: "high" })
      WebRetest.enqueue({ sessionID: sid, requestID: a, triggerType: "new_credential", triggerSource: "org2", priority: "high" })
      WebRetest.enqueue({ sessionID: sid, requestID: b, triggerType: "new_signal", triggerSource: "sig", priority: "medium" })
      expect(WebRetest.getPending(sid).length).toBe(3)

      expect(WebRetest.completeForRequest(sid, a)).toBe(2) // both org1 + org2 for /a
      const rest = WebRetest.getPending(sid)
      expect(rest.length).toBe(1)
      expect(rest[0].request_id).toBe(b) // /b untouched

      expect(WebRetest.completeForRequest(sid, a)).toBe(0) // already closed — idempotent
      expect(WebRetest.count(sid).completed).toBe(2)
    })
  })
})
