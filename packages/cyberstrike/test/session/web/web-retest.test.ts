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

  test("a NEW object_value on an examined endpoint is recorded but does NOT re-open (anti-redundancy)", async () => {
    await withSession(async (sid) => {
      WebRetest.flag({ sessionID: sid, keyHash: K, type: "object_value", value: "id-1" })
      WebRetest.markExamined(sid, K)
      expect(WebRetest.getPending(sid).length).toBe(0)

      // more object values keep arriving (fresh UUIDs seen on the endpoint) — the first IDOR pass
      // already swept a representative set, so these must NOT re-run the specialist.
      expect(WebRetest.flag({ sessionID: sid, keyHash: K, type: "object_value", value: "id-2" })).toBe(false)
      expect(WebRetest.flag({ sessionID: sid, keyHash: K, type: "object_value", value: "id-3" })).toBe(false)
      expect(WebRetest.getPending(sid).length).toBe(0) // stayed examined — no re-dispatch

      // but the values ARE recorded so a later brief still lists them
      expect(WebRetest.getFlags(sid, K)?.object_value).toEqual(["id-1", "id-2", "id-3"])

      // a NEW credential is a genuinely new test dimension → still re-opens
      expect(WebRetest.flag({ sessionID: sid, keyHash: K, type: "credential", value: "org2" })).toBe(true)
      expect(WebRetest.getPending(sid).length).toBe(1)
    })
  })
})

describe("WebRetest.flagMatching — TARGETED session-wide (relevance-filtered, deduped)", () => {
  const anyEndpoint = () => true

  test("flags matching endpoints once; same value again adds nothing; a new value accumulates", async () => {
    await withSession(async (sid) => {
      Request.add({ sessionID: sid, method: "GET", normalizedPath: "/a", keyHash: "k_a" })
      Request.add({ sessionID: sid, method: "POST", normalizedPath: "/b", keyHash: "k_b" })
      const n1 = WebRetest.flagMatching({ sessionID: sid, type: "credential", value: "org1", priority: "high", match: anyEndpoint })
      expect(n1).toBe(2) // one entry per distinct endpoint
      expect(WebRetest.getPending(sid).length).toBe(2)
      // same credential again → no change (already flagged)
      expect(WebRetest.flagMatching({ sessionID: sid, type: "credential", value: "org1", match: anyEndpoint })).toBe(0)
      expect(WebRetest.getPending(sid).length).toBe(2)
      // a DIFFERENT credential → accumulates on the same 2 entries, still 2 rows
      expect(WebRetest.flagMatching({ sessionID: sid, type: "credential", value: "org2", match: anyEndpoint })).toBe(2)
      expect(WebRetest.getPending(sid).length).toBe(2)
      const a = WebRetest.getPending(sid).find((r) => r.endpoint === "/a")!
      expect(a.flags.credential).toEqual(["org1", "org2"])
    })
  })

  test("access-control surface EXCLUDES static assets (a credential no longer floods js/css/images)", async () => {
    await withSession(async (sid) => {
      Request.add({ sessionID: sid, method: "GET", normalizedPath: "/api/users/me", keyHash: "k_api" })
      Request.add({ sessionID: sid, method: "GET", normalizedPath: "/static/app.bundle.js", keyHash: "k_js" })
      Request.add({ sessionID: sid, method: "GET", normalizedPath: "/assets/logo.png", keyHash: "k_img" })
      const n = WebRetest.flagMatching({ sessionID: sid, type: "credential", value: "org1", match: WebRetest.isAccessControlSurface })
      expect(n).toBe(1) // only the API endpoint — the .js and .png are skipped
      expect(WebRetest.getPending(sid).map((r) => r.endpoint)).toEqual(["/api/users/me"])
    })
  })

  test("object_value flags ONLY object-referencing endpoints (path param / api / query), not plain pages", async () => {
    await withSession(async (sid) => {
      Request.add({ sessionID: sid, method: "GET", normalizedPath: "/api/orders/{id}", keyHash: "k_ord" }) // path param → yes
      Request.add({ sessionID: sid, method: "GET", normalizedPath: "/api/users/me", keyHash: "k_me" }) // /api/ → yes
      Request.add({ sessionID: sid, method: "GET", normalizedPath: "/about", keyHash: "k_about" }) // plain page, no param → no
      Request.add({ sessionID: sid, method: "GET", normalizedPath: "/app.js", keyHash: "k_js2" }) // static → no
      const n = WebRetest.flagMatching({ sessionID: sid, type: "object_value", value: "456", match: WebRetest.isObjectReferencing })
      expect(n).toBe(2)
      expect(WebRetest.getPending(sid).map((r) => r.endpoint).sort()).toEqual(["/api/orders/{id}", "/api/users/me"])
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
