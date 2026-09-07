import { describe, expect, test } from "bun:test"
import { WebRetest } from "../../../src/session/web/web-retest"
import { Request } from "../../../src/session/request"
import { Session } from "../../../src/session"
import { Instance } from "../../../src/project/instance"
import { tmpdir } from "../../fixture/fixture"

async function withSession(fn: (sid: string) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({ directory: dir.path, fn: async () => fn((await Session.create({})).id) })
}

// The queue is keyed by simplified endpoint (key_hash). flag() takes a key_hash directly.
const K = "keyhash_abc"

describe("WebRetest.flag — endpoint-keyed, flags accumulate", () => {
  test("first flag on an endpoint creates ONE pending entry with that value", async () => {
    await withSession(async (sid) => {
      expect(WebRetest.flag({ sessionID: sid, keyHash: K, type: "role", value: "Admin" })).toBe(true)
      const p = WebRetest.getPending(sid)
      expect(p.length).toBe(1)
      expect(p[0].key_hash).toBe(K)
      expect(p[0].flags.role).toEqual(["Admin"])
    })
  })

  test("more flag VALUES on a pending endpoint accumulate — no second entry", async () => {
    await withSession(async (sid) => {
      WebRetest.flag({ sessionID: sid, keyHash: K, type: "role", value: "Admin" })
      WebRetest.flag({ sessionID: sid, keyHash: K, type: "role", value: "Owner" })
      WebRetest.flag({ sessionID: sid, keyHash: K, type: "credential", value: "org1" })
      const p = WebRetest.getPending(sid)
      expect(p.length).toBe(1) // still ONE endpoint entry
      expect(p[0].flags.role).toEqual(["Admin", "Owner"])
      expect(p[0].flags.credential).toEqual(["org1"])
    })
  })

  test("a re-seen value is a no-op (returns false, no dup)", async () => {
    await withSession(async (sid) => {
      WebRetest.flag({ sessionID: sid, keyHash: K, type: "role", value: "Admin" })
      expect(WebRetest.flag({ sessionID: sid, keyHash: K, type: "role", value: "Admin" })).toBe(false)
      expect(WebRetest.getPending(sid)[0].flags.role).toEqual(["Admin"])
    })
  })

  test("high priority bumps a medium entry", async () => {
    await withSession(async (sid) => {
      WebRetest.flag({ sessionID: sid, keyHash: K, type: "object_value", value: "v1", priority: "medium" })
      WebRetest.flag({ sessionID: sid, keyHash: K, type: "credential", value: "org1", priority: "high" })
      expect(WebRetest.getPending(sid)[0].priority).toBe("high")
    })
  })
})

describe("WebRetest.markExamined / re-open", () => {
  test("examined endpoint leaves the pending list; a NEW value re-opens it, a re-seen one does not", async () => {
    await withSession(async (sid) => {
      WebRetest.flag({ sessionID: sid, keyHash: K, type: "role", value: "Admin" })
      WebRetest.markExamined(sid, K)
      expect(WebRetest.getPending(sid).length).toBe(0)
      expect(WebRetest.count(sid).examined).toBe(1)

      // a value already in the examined snapshot → stays examined
      expect(WebRetest.flag({ sessionID: sid, keyHash: K, type: "role", value: "Admin" })).toBe(false)
      expect(WebRetest.getPending(sid).length).toBe(0)

      // a genuinely new value → re-opens (pending again)
      expect(WebRetest.flag({ sessionID: sid, keyHash: K, type: "role", value: "Owner" })).toBe(true)
      const p = WebRetest.getPending(sid)
      expect(p.length).toBe(1)
      expect(p[0].flags.role).toEqual(["Admin", "Owner"])
    })
  })
})

describe("WebRetest.flagAll — session-wide (one entry per endpoint, deduped)", () => {
  test("flags every captured endpoint once; same value again adds nothing", async () => {
    await withSession(async (sid) => {
      Request.add({ sessionID: sid, method: "GET", normalizedPath: "/a", keyHash: "k_a" })
      Request.add({ sessionID: sid, method: "POST", normalizedPath: "/b", keyHash: "k_b" })
      const n1 = WebRetest.flagAll({ sessionID: sid, type: "credential", value: "org1", priority: "high" })
      expect(n1).toBe(2) // one entry per distinct endpoint
      expect(WebRetest.getPending(sid).length).toBe(2)
      // same credential again → no change (already flagged)
      expect(WebRetest.flagAll({ sessionID: sid, type: "credential", value: "org1" })).toBe(0)
      expect(WebRetest.getPending(sid).length).toBe(2)
      // a DIFFERENT credential → accumulates on the same 2 entries, still 2 rows
      expect(WebRetest.flagAll({ sessionID: sid, type: "credential", value: "org2" })).toBe(2)
      expect(WebRetest.getPending(sid).length).toBe(2)
      const a = WebRetest.getPending(sid).find((r) => r.endpoint === "/a")!
      expect(a.flags.credential).toEqual(["org1", "org2"])
    })
  })

  test("getPending resolves method + endpoint from the request row", async () => {
    await withSession(async (sid) => {
      Request.add({ sessionID: sid, method: "GET", normalizedPath: "/api/orders/{id}", keyHash: "k_o" })
      WebRetest.flag({ sessionID: sid, keyHash: "k_o", type: "object_value", value: "456" })
      const p = WebRetest.getPending(sid)[0]
      expect(p.method).toBe("GET")
      expect(p.endpoint).toBe("/api/orders/{id}")
    })
  })
})

describe("WebRetest.completeForRequest — drains by endpoint", () => {
  test("testing a request marks its endpoint examined (via key_hash)", async () => {
    await withSession(async (sid) => {
      const req = Request.add({ sessionID: sid, method: "GET", normalizedPath: "/x", keyHash: "k_x" })!
      WebRetest.flag({ sessionID: sid, keyHash: "k_x", type: "signal", value: "sql_error:injection" })
      expect(WebRetest.getPending(sid).length).toBe(1)
      expect(WebRetest.completeForRequest(sid, req.id)).toBe(true)
      expect(WebRetest.getPending(sid).length).toBe(0)
      expect(WebRetest.completeForRequest(sid, req.id)).toBe(false) // already examined
    })
  })
})
