// Issue #105 — a constructed-target exploit (an endpoint the crawl never captured, so the agent sends
// `target` not `request_id`) used to get only a synthetic `replay:` id and NO verification_token, so the
// finding it proved could never pass the triage gate and stayed stuck in draft. http_replay now PERSISTS
// a successful constructed-target send as a real captured request and mints a token keyed to it. Proven
// end-to-end through the real tool + a real local server + the real Verification gate.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Request } from "../../src/session/request"
import { HttpReplayTool } from "../../src/tool/http-replay"
import { Verification } from "../../src/inspection/verification"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

let server: ReturnType<typeof Bun.serve>
let origin: string

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      return Response.json({ ok: true, path: url.pathname + url.search })
    },
  })
  origin = `http://127.0.0.1:${server.port}`
})
afterAll(() => server.stop(true))

function mockCtx(sessionID: string): any {
  return { sessionID, messageID: "msg_test", agent: "test", abort: new AbortController().signal, messages: [], metadata: () => {}, ask: async () => {} }
}

describe("http_replay persists a constructed-target exploit (#105)", () => {
  test("a constructed target that gets a response is stored with a real request_id + verification_token", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        // Seed ONE captured request so the host is in scope — but a DIFFERENT path than we exploit.
        Request.add({ sessionID: session.id, method: "GET", normalizedPath: "/seed", host: "127.0.0.1" })
        const before = Request.get(session.id)
        expect(before.some((r) => r.normalized_path === "/api/uncaptured")).toBe(false)

        const tool = await HttpReplayTool.init()
        const res = await tool.execute(
          { target: { method: "GET", url: `${origin}/api/uncaptured?id=1` } },
          mockCtx(session.id),
        )
        const out = JSON.parse(res.output)

        // The send landed (echo server) and the exploit was persisted as a real, non-synthetic request.
        expect(out.status).toBe(200)
        expect(typeof out.request_id).toBe("string")
        expect(out.request_id.startsWith("replay:")).toBe(false)
        expect(typeof out.verification_token).toBe("string")

        // The constructed target is now a captured row (retestable), not lost.
        const stored = Request.get(session.id).find((r) => r.id === out.request_id)
        expect(stored).toBeDefined()
        expect(stored!.normalized_path).toContain("/api/uncaptured")

        // The minted token validates against the new id — exactly what the draft->triaged gate needs.
        const check = Verification.validate({
          sessionID: session.id,
          token: out.verification_token,
          evidenceRequestIds: [out.request_id],
        })
        expect(check.valid).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("an out-of-scope host is still refused and nothing is persisted", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        Request.add({ sessionID: session.id, method: "GET", normalizedPath: "/seed", host: "127.0.0.1" })

        const tool = await HttpReplayTool.init()
        const res = await tool.execute(
          { target: { method: "GET", url: "http://evil.example.com/x" } },
          mockCtx(session.id),
        )
        expect(res.title).toContain("out of scope")
        expect(Request.get(session.id).some((r) => r.host === "evil.example.com")).toBe(false)

        await Session.remove(session.id)
      },
    })
  })
})
