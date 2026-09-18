import { describe, test, expect } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { InspectionQueue } from "../../src/inspection/queue"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

const DOMAIN = "web"

function run(fn: (sessionID: string) => void | Promise<void>) {
  return Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const session = await Session.create({})
      try {
        await fn(session.id)
      } finally {
        await Session.remove(session.id)
      }
    },
  })
}

describe("InspectionQueue", () => {
  test("flag() creates a new pending target", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, DOMAIN)
      const changed = q.flag(
        { key: "GET /api/users", label: "GET /api/users", meta: { method: "GET" } },
        { type: "signal", value: "cors_misconfig:client-side", priority: "medium" },
      )
      expect(changed).toBe(true)
      const counts = q.count()
      expect(counts.pending).toBe(1)
      expect(counts.examined).toBe(0)
      expect(counts.total).toBe(1)
    }))

  test("flag() same value on pending target does not change queue", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, DOMAIN)
      q.flag(
        { key: "GET /api/users", label: "GET /api/users", meta: {} },
        { type: "signal", value: "cors_misconfig:client-side", priority: "medium" },
      )
      const changed = q.flag(
        { key: "GET /api/users", label: "GET /api/users", meta: {} },
        { type: "signal", value: "cors_misconfig:client-side", priority: "medium" },
      )
      expect(changed).toBe(false)
      expect(q.count().total).toBe(1)
    }))

  test("flag() new value on pending target appends evidence", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, DOMAIN)
      q.flag(
        { key: "GET /api/users", label: "GET /api/users", meta: {} },
        { type: "signal", value: "cors_misconfig:client-side", priority: "medium" },
      )
      const changed = q.flag(
        { key: "GET /api/users", label: "GET /api/users", meta: {} },
        { type: "credential", value: "cred_admin", priority: "high" },
      )
      expect(changed).toBe(true)
      const evidence = q.evidenceFor("GET /api/users")
      const types = evidence.map((e) => e.type)
      expect(types).toContain("signal")
      expect(types).toContain("credential")
    }))

  test("markExamined() transitions pending to examined", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, DOMAIN)
      q.flag(
        { key: "POST /api/login", label: "POST /api/login", meta: {} },
        { type: "signal", value: "auth_bypass:authentication", priority: "high" },
      )
      expect(q.count().pending).toBe(1)
      q.markExamined("POST /api/login")
      expect(q.count().pending).toBe(0)
      expect(q.count().examined).toBe(1)
    }))

  test("flag() re-opens examined target with new evidence", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, DOMAIN)
      q.flag(
        { key: "GET /api/data", label: "GET /api/data", meta: {} },
        { type: "signal", value: "sqli:input-validation", priority: "high" },
      )
      q.markExamined("GET /api/data")
      expect(q.count().pending).toBe(0)
      const changed = q.flag(
        { key: "GET /api/data", label: "GET /api/data", meta: {} },
        { type: "credential", value: "cred_user2", priority: "medium" },
      )
      expect(changed).toBe(true)
      expect(q.count().pending).toBe(1)
    }))

  test("flag() accumulateOnly does NOT re-open examined target", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, DOMAIN)
      q.flag(
        { key: "GET /api/obj", label: "GET /api/obj", meta: {} },
        { type: "object_value", value: "uuid-1", priority: "low" },
      )
      q.markExamined("GET /api/obj")
      const changed = q.flag(
        { key: "GET /api/obj", label: "GET /api/obj", meta: {} },
        { type: "object_value", value: "uuid-2", priority: "low", accumulateOnly: true },
      )
      expect(changed).toBe(false)
      expect(q.count().pending).toBe(0)
      const ev = q.evidenceFor("GET /api/obj")
      const objValues = ev.filter((e) => e.type === "object_value").map((e) => e.value)
      expect(objValues).toContain("uuid-1")
      expect(objValues).toContain("uuid-2")
    }))

  test("flag() does not re-open for already-examined evidence value", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, DOMAIN)
      q.flag(
        { key: "GET /x", label: "GET /x", meta: {} },
        { type: "signal", value: "xss:client-side", priority: "medium" },
      )
      q.markExamined("GET /x")
      const changed = q.flag(
        { key: "GET /x", label: "GET /x", meta: {} },
        { type: "signal", value: "xss:client-side", priority: "medium" },
      )
      expect(changed).toBe(false)
      expect(q.count().pending).toBe(0)
    }))

  test("pending() returns sorted by priority then creation time", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, DOMAIN)
      q.flag({ key: "a", label: "a", meta: {} }, { type: "s", value: "v1", priority: "low" })
      q.flag({ key: "b", label: "b", meta: {} }, { type: "s", value: "v2", priority: "high" })
      q.flag({ key: "c", label: "c", meta: {} }, { type: "s", value: "v3", priority: "medium" })
      const pending = q.pending()
      expect(pending.map((p) => p.target_key)).toEqual(["b", "c", "a"])
    }))

  test("flagMatching() flags all matching targets", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, DOMAIN)
      q.flag({ key: "GET /api/a", label: "GET /api/a", meta: {} }, { type: "signal", value: "v1", priority: "medium" })
      q.flag({ key: "POST /api/b", label: "POST /api/b", meta: {} }, { type: "signal", value: "v2", priority: "medium" })
      q.flag({ key: "GET /other", label: "GET /other", meta: {} }, { type: "signal", value: "v3", priority: "medium" })
      const count = q.flagMatching(
        { type: "credential", value: "cred_new", priority: "high" },
        (t) => t.key.startsWith("GET"),
      )
      expect(count).toBe(2)
    }))

  test("isEmpty() reflects queue state", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, DOMAIN)
      expect(q.isEmpty()).toBe(true)
      q.flag({ key: "x", label: "x", meta: {} }, { type: "s", value: "v", priority: "low" })
      expect(q.isEmpty()).toBe(false)
      q.markExamined("x")
      expect(q.isEmpty()).toBe(true)
    }))

  test("statusByTargetKey() returns correct map", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, DOMAIN)
      q.flag({ key: "ep1", label: "ep1", meta: {} }, { type: "s", value: "v1", priority: "medium" })
      q.flag({ key: "ep2", label: "ep2", meta: {} }, { type: "s", value: "v2", priority: "medium" })
      q.markExamined("ep1")
      const map = q.statusByTargetKey()
      expect(map.ep1).toBe("examined")
      expect(map.ep2).toBe("pending")
    }))

  test("priority bumps to higher level on new flag", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, DOMAIN)
      q.flag({ key: "bump", label: "bump", meta: {} }, { type: "s", value: "v1", priority: "low" })
      q.flag({ key: "bump", label: "bump", meta: {} }, { type: "s", value: "v2", priority: "high" })
      const pending = q.pending()
      expect(pending[0].priority).toBe("high")
    }))

  // ── Lease-based recovery (issue #38) ─────────────────────────────

  test("markDispatched: leaves pending() list but stays outstanding in count()", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, DOMAIN)
      q.flag({ key: "ep", label: "ep", meta: {} }, { type: "s", value: "v", priority: "medium" })
      q.markDispatched("ep")
      // excluded from the drain list → never double-dispatched
      expect(q.pending().length).toBe(0)
      // but still counted as outstanding → lifecycle won't report "complete" mid-flight
      expect(q.count().pending).toBe(1)
      expect(q.count().examined).toBe(0)
      expect(q.isEmpty()).toBe(false)
      expect(q.statusByTargetKey().ep).toBe("dispatched")
    }))

  test("resetToPending: re-opens a dispatched item for another drain pass", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, DOMAIN)
      q.flag({ key: "ep", label: "ep", meta: {} }, { type: "s", value: "v", priority: "medium" })
      q.markDispatched("ep")
      expect(q.pending().length).toBe(0)
      q.resetToPending("ep")
      expect(q.pending().length).toBe(1)
      expect(q.statusByTargetKey().ep).toBe("pending")
    }))

  test("markExamined transitions a dispatched item to examined (specialist finished)", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, DOMAIN)
      q.flag({ key: "ep", label: "ep", meta: {} }, { type: "s", value: "v", priority: "medium" })
      q.markDispatched("ep")
      q.markExamined("ep")
      expect(q.statusByTargetKey().ep).toBe("examined")
      expect(q.count().pending).toBe(0)
      expect(q.count().examined).toBe(1)
    }))

  test("reclaimStale: re-opens a dispatched item whose lease expired, keeps fresh ones", () =>
    run(async (sid) => {
      const q = new InspectionQueue(sid, DOMAIN)
      q.flag({ key: "ep", label: "ep", meta: {} }, { type: "s", value: "v", priority: "medium" })
      q.markDispatched("ep")
      await Bun.sleep(5)
      // a huge lease → the lease has NOT expired → not reclaimed
      expect(q.reclaimStale(60_000)).toBe(0)
      expect(q.statusByTargetKey().ep).toBe("dispatched")
      // a tiny lease → the 5ms-old lease is stale → reclaimed to pending (re-inspected, not skipped)
      expect(q.reclaimStale(1)).toBe(1)
      expect(q.statusByTargetKey().ep).toBe("pending")
      expect(q.pending().length).toBe(1)
    }))

  test("new evidence on a dispatched item accumulates without resetting the lease", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, DOMAIN)
      q.flag({ key: "ep", label: "ep", meta: {} }, { type: "s", value: "v1", priority: "medium" })
      q.markDispatched("ep")
      q.flag({ key: "ep", label: "ep", meta: {} }, { type: "s", value: "v2", priority: "high" })
      // still in-flight (not yanked back to pending mid-dispatch → no concurrent double-dispatch)
      expect(q.statusByTargetKey().ep).toBe("dispatched")
      expect(q.pending().length).toBe(0)
    }))
})
