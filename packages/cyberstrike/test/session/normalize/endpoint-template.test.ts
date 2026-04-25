import { describe, expect, test } from "bun:test"
import { Instance } from "../../../src/project/instance"
import { Log } from "../../../src/util/log"
import { Session } from "../../../src/session"
import { EndpointTemplate, DBTemplateStore } from "../../../src/session/web/endpoint-template"
import { tmpdir } from "../../fixture/fixture"

Log.init({ print: false })

const ORIGIN = "https://api.example.com:443"

async function withSession(fn: (sessionID: string) => Promise<void>): Promise<void> {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.createNext({ directory: tmp.path })
      await fn(session.id)
    },
  })
}

describe("EndpointTemplate.upsert / find", () => {
  test("upsert inserts new row with hit_count=1 and ept_ id", async () => {
    await withSession(async (sessionID) => {
      const t = EndpointTemplate.upsert({
        sessionID, origin: ORIGIN, method: "GET",
        template: "/users/{id}", segmentCount: 3, source: "tier1", confidence: 1,
      })
      expect(t.hit_count).toBe(1)
      expect(t.id.startsWith("ept_")).toBe(true)
      expect(t.template).toBe("/users/{id}")
    })
  })

  test("upsert is idempotent on (sessionID, origin, method, template)", async () => {
    await withSession(async (sessionID) => {
      const a = EndpointTemplate.upsert({
        sessionID, origin: ORIGIN, method: "GET",
        template: "/users/{id}", segmentCount: 3, source: "tier1", confidence: 1,
      })
      const b = EndpointTemplate.upsert({
        sessionID, origin: ORIGIN, method: "GET",
        template: "/users/{id}", segmentCount: 3, source: "tier1", confidence: 1,
      })
      expect(b.id).toBe(a.id)
      expect(b.hit_count).toBe(2)
      expect(EndpointTemplate.get(sessionID)).toHaveLength(1)
    })
  })

  test("find buckets by (sessionID, origin, method, segmentCount)", async () => {
    await withSession(async (sessionID) => {
      EndpointTemplate.upsert({
        sessionID, origin: ORIGIN, method: "GET",
        template: "/users/{id}", segmentCount: 3, source: "tier1", confidence: 1,
      })
      EndpointTemplate.upsert({
        sessionID, origin: ORIGIN, method: "GET",
        template: "/orders/{id}", segmentCount: 3, source: "tier1", confidence: 1,
      })
      EndpointTemplate.upsert({
        sessionID, origin: ORIGIN, method: "POST",
        template: "/users/{id}", segmentCount: 3, source: "tier1", confidence: 1,
      })

      const getBucket = EndpointTemplate.find({
        sessionID, origin: ORIGIN, method: "GET", segmentCount: 3,
      })
      expect(getBucket).toHaveLength(2)

      const postBucket = EndpointTemplate.find({
        sessionID, origin: ORIGIN, method: "POST", segmentCount: 3,
      })
      expect(postBucket).toHaveLength(1)

      const otherSegCount = EndpointTemplate.find({
        sessionID, origin: ORIGIN, method: "GET", segmentCount: 4,
      })
      expect(otherSegCount).toHaveLength(0)
    })
  })

  test("find isolates by origin (api.example.com vs app.example.com)", async () => {
    await withSession(async (sessionID) => {
      EndpointTemplate.upsert({
        sessionID, origin: "https://api.example.com:443", method: "GET",
        template: "/users/{id}", segmentCount: 3, source: "tier1", confidence: 1,
      })
      EndpointTemplate.upsert({
        sessionID, origin: "https://app.example.com:443", method: "GET",
        template: "/users/{id}", segmentCount: 3, source: "tier1", confidence: 1,
      })

      const apiBucket = EndpointTemplate.find({
        sessionID, origin: "https://api.example.com:443", method: "GET", segmentCount: 3,
      })
      const appBucket = EndpointTemplate.find({
        sessionID, origin: "https://app.example.com:443", method: "GET", segmentCount: 3,
      })
      expect(apiBucket).toHaveLength(1)
      expect(appBucket).toHaveLength(1)
      expect(apiBucket[0]!.id).not.toBe(appBucket[0]!.id)
    })
  })

  test("incrementHit bumps hit_count", async () => {
    await withSession(async (sessionID) => {
      const t = EndpointTemplate.upsert({
        sessionID, origin: ORIGIN, method: "GET",
        template: "/x", segmentCount: 2, source: "tier1", confidence: 1,
      })
      EndpointTemplate.incrementHit(t.id)
      EndpointTemplate.incrementHit(t.id)
      const all = EndpointTemplate.get(sessionID)
      expect(all[0]!.hit_count).toBe(3)
    })
  })

  test("incrementHit on unknown id is a no-op", async () => {
    await withSession(async (sessionID) => {
      EndpointTemplate.incrementHit("ept_does_not_exist")
      expect(EndpointTemplate.get(sessionID)).toHaveLength(0)
    })
  })

  test("templates are scoped to their session", async () => {
    await withSession(async (sessionA) => {
      EndpointTemplate.upsert({
        sessionID: sessionA, origin: ORIGIN, method: "GET",
        template: "/users/{id}", segmentCount: 3, source: "tier1", confidence: 1,
      })
      // A different session in the same DB should see no templates
      const sessionB = (await Session.createNext({ directory: "." })).id
      const found = EndpointTemplate.find({
        sessionID: sessionB, origin: ORIGIN, method: "GET", segmentCount: 3,
      })
      expect(found).toHaveLength(0)
    })
  })
})

describe("DBTemplateStore — TemplateStore adapter contract", () => {
  test("find returns pipeline-shaped EndpointTemplate rows", async () => {
    await withSession(async (sessionID) => {
      const store = new DBTemplateStore()
      store.upsert({
        sessionID, origin: ORIGIN, method: "GET",
        template: "/users/{id}", segmentCount: 3, source: "tier1", confidence: 1,
      })
      const rows = store.find(sessionID, ORIGIN, "GET", 3)
      expect(rows).toHaveLength(1)
      const row = rows[0]!
      // Pipeline shape uses camelCase + pre-split segments
      expect(row.sessionID).toBe(sessionID)
      expect(row.segmentCount).toBe(3)
      expect(row.hitCount).toBe(1)
      expect(row.segments).toEqual(["", "users", "{id}"])
    })
  })

  test("upsert via adapter is idempotent and bumps hitCount", async () => {
    await withSession(async (sessionID) => {
      const store = new DBTemplateStore()
      const a = store.upsert({
        sessionID, origin: ORIGIN, method: "GET",
        template: "/users/{id}", segmentCount: 3, source: "tier1", confidence: 1,
      })
      const b = store.upsert({
        sessionID, origin: ORIGIN, method: "GET",
        template: "/users/{id}", segmentCount: 3, source: "tier1", confidence: 1,
      })
      expect(b.id).toBe(a.id)
      expect(b.hitCount).toBe(2)
    })
  })

  test("incrementHit via adapter persists across find calls", async () => {
    await withSession(async (sessionID) => {
      const store = new DBTemplateStore()
      const t = store.upsert({
        sessionID, origin: ORIGIN, method: "GET",
        template: "/x", segmentCount: 2, source: "tier1", confidence: 1,
      })
      store.incrementHit(t.id)
      const refreshed = store.find(sessionID, ORIGIN, "GET", 2)
      expect(refreshed[0]!.hitCount).toBe(2)
    })
  })
})
