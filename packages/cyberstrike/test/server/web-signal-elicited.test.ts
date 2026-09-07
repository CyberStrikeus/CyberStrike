import { describe, expect, test } from "bun:test"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { scanElicitedResponse, scanCapturedResponse, SignalStore } from "../../src/session/web/signal"
import { WebRetest } from "../../src/session/web/web-retest"
import type { ReplayResponse } from "../../src/replay/response"

async function withSession(fn: (sid: string) => Promise<void> | void) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const session = await Session.create({})
      await fn(session.id)
    },
  })
}

// Build a synthetic replay Result. `response: null` models a transport error.
function result(over: {
  status?: number
  headers?: ReplayResponse.Header[]
  body?: string
  error?: boolean
}): ReplayResponse.Result {
  if (over.error) return { error: { kind: "timeout", message: "timed out" }, timing: { totalMs: 5 } }
  return {
    response: {
      version: "HTTP/1.1",
      status: over.status ?? 200,
      reason: "OK",
      headers: over.headers ?? [],
      body: new TextEncoder().encode(over.body ?? ""),
    },
    timing: { totalMs: 5 },
  }
}

describe("scanElicitedResponse — http_replay write-back (B2)", () => {
  test("an elicited error page is persisted as a signal, linked to the source request", async () => {
    await withSession((sid) => {
      const n = scanElicitedResponse({
        sessionID: sid,
        requestId: "req_src",
        method: "GET",
        url: "https://shop.example.com/item?id=1",
        result: result({ status: 500, body: "You have an error in your SQL syntax near ''" }),
      })
      expect(n).toBeGreaterThan(0)
      const signals = new SignalStore(sid).get()
      const sqlErr = signals.find((s) => s.signal_type === "sql_error")
      expect(sqlErr).toBeDefined()
      expect(sqlErr?.owner).toBe("injection")
      expect(sqlErr?.request_id).toBe("req_src")
    })
  })

  test("multiple Set-Cookie headers survive the replay path (no Record collapse)", async () => {
    await withSession((sid) => {
      scanElicitedResponse({
        sessionID: sid,
        requestId: "req_c",
        method: "GET",
        url: "https://shop.example.com/login",
        result: result({
          status: 200,
          headers: [
            { name: "set-cookie", value: "A=1; Path=/" },
            { name: "set-cookie", value: "B=2; Path=/" },
          ],
        }),
      })
      const cookie = new SignalStore(sid).get().find((s) => s.signal_type === "weak_cookie_flags")
      expect(cookie).toBeDefined()
      expect(cookie?.owner).toBe("auth-session")
    })
  })

  test("transport error (no response) does not crash and records nothing", async () => {
    await withSession((sid) => {
      const n = scanElicitedResponse({
        sessionID: sid,
        requestId: "req_e",
        method: "GET",
        url: "https://shop.example.com/x",
        result: result({ error: true }),
      })
      expect(n).toBe(0)
      expect(new SignalStore(sid).get()).toHaveLength(0)
    })
  })

  test("a target-based replay (sourceIsCaptured false) records the signal but enqueues NO retest", async () => {
    await withSession((sid) => {
      scanElicitedResponse({
        sessionID: sid,
        requestId: "replay:shop.example.com/x",
        method: "GET",
        url: "https://shop.example.com/x",
        result: result({ status: 500, body: "SQL syntax error near ''" }),
        // sourceIsCaptured omitted → false
      })
      expect(new SignalStore(sid).get().some((s) => s.signal_type === "sql_error")).toBe(true)
      expect(WebRetest.getPending(sid).filter((r) => (r.flags.signal ?? []).length > 0)).toHaveLength(0)
    })
  })

  test("sourceIsCaptured true but the request row does not exist: FK-guarded — signal still persists, no crash, no retest", async () => {
    await withSession((sid) => {
      // req_ghost is not a real row; the retest enqueue hits the FK and is swallowed, but the
      // signal was already persisted BEFORE the enqueue attempt, so it must survive.
      const n = scanElicitedResponse({
        sessionID: sid,
        requestId: "req_ghost",
        method: "GET",
        url: "https://shop.example.com/y",
        result: result({ status: 500, body: "SQL syntax error near ''" }),
        sourceIsCaptured: true,
      })
      expect(n).toBeGreaterThan(0)
      expect(new SignalStore(sid).get().some((s) => s.signal_type === "sql_error")).toBe(true)
      expect(WebRetest.getPending(sid).filter((r) => (r.flags.signal ?? []).length > 0)).toHaveLength(0)
    })
  })
})

describe("marker → canary registration (replay half of B3)", () => {
  test("marker injected via replay is caught when a LATER captured page renders it (cross-page)", async () => {
    await withSession((sid) => {
      // 1) Replay injects a marked payload at req_A; its own response does not reflect it.
      scanElicitedResponse({
        sessionID: sid,
        requestId: "req_A",
        method: "POST",
        url: "https://shop.example.com/comment",
        result: result({ status: 200, body: "saved" }),
        marker: { value: "csINJmarker42", endpoint: "POST /comment", field: "body", agent: "injection", vulnClass: "xss" },
      })

      // 2) A DIFFERENT page is later captured and renders the marker → stored reflection.
      scanCapturedResponse({
        sessionID: sid,
        requestId: "req_B",
        method: "GET",
        url: "https://shop.example.com/feed",
        response: { status: 200, headers: { "content-type": "text/html" }, body: "<div>csINJmarker42</div>" },
      })

      const stored = new SignalStore(sid).get().find((s) => s.signal_type === "stored_reflection")
      expect(stored).toBeDefined()
      expect(stored?.owner).toBe("injection")
      expect(stored?.meta?.injectSite).toBe("req_A")
      expect(stored?.meta?.renderSite).toBe("req_B")
    })
  })

  test("marker reflected in its OWN response is NOT stored_reflection (same-site excluded)", async () => {
    await withSession((sid) => {
      scanElicitedResponse({
        sessionID: sid,
        requestId: "req_A",
        method: "POST",
        url: "https://shop.example.com/echo",
        result: result({ status: 200, body: "echo csSAMEtoken99" }),
        marker: { value: "csSAMEtoken99", endpoint: "POST /echo", field: "q", agent: "injection", vulnClass: "xss" },
      })
      const stored = new SignalStore(sid).get().filter((s) => s.signal_type === "stored_reflection")
      expect(stored).toHaveLength(0)
    })
  })
})
