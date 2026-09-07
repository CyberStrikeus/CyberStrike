import { describe, expect, test } from "bun:test"
import { WebWriteFunctionTool } from "../../src/tool/web-write-function"
import { Request } from "../../src/session/request"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const ctxFor = (sessionID: string) => ({
  sessionID,
  messageID: "",
  callID: "",
  agent: "hunt-analyzer",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
})

async function withSession(fn: (sid: string) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({ directory: dir.path, fn: async () => fn((await Session.create({})).id) })
}

describe("web_write_function — request_id FK guard", () => {
  test("an unknown request_id returns a clean tool error, not a raw SQLite FK crash", async () => {
    await withSession(async (sid) => {
      const tool = await WebWriteFunctionTool.init()
      // Must not throw (the FK error used to surface as a raw SQLiteError in the UI).
      const res = await tool.execute(
        { name: "List_Items", action_type: "read", request_id: "req_DOESNOTEXIST" } as any,
        ctxFor(sid),
      )
      expect(res.title).toContain("unknown request_id")
      expect(res.output).toContain("req_DOESNOTEXIST")
    })
  })

  test("a real captured request_id records the function", async () => {
    await withSession(async (sid) => {
      const req = Request.add({ sessionID: sid, method: "GET", normalizedPath: "/api/agents" })!
      const tool = await WebWriteFunctionTool.init()
      const res = await tool.execute(
        { name: "List_Agents", action_type: "read", request_id: req.id } as any,
        ctxFor(sid),
      )
      expect(res.title).toContain("List_Agents")
      expect((res.metadata as any)?.function?.request_id).toBe(req.id)
    })
  })
})
