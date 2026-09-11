import { describe, expect, test } from "bun:test"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { CanaryRegistry, DbCanaryStore, SignalStore } from "../../src/session/web/signal"
import type { Signal } from "../../src/session/web/signal"

// Run a body inside a real instance (DB initialised + migrations applied) with a fresh session.
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

// Two sessions in one instance — for isolation assertions.
async function withTwoSessions(fn: (a: string, b: string) => Promise<void> | void) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const a = await Session.create({})
      const b = await Session.create({})
      await fn(a.id, b.id)
    },
  })
}

const sig = (over: Partial<Signal> = {}): Signal => ({
  type: over.type ?? "sql_error",
  owner: over.owner ?? "input-validation",
  requestId: over.requestId ?? "req_1",
  evidence: over.evidence ?? "DBMS error",
  meta: over.meta,
})

describe("DbCanaryStore + CanaryRegistry (real DB)", () => {
  test("registered canary persists and is found cross-site by a fresh store", async () => {
    await withSession((sid) => {
      const reg = new CanaryRegistry(new DbCanaryStore(sid))
      const c = reg.register({ originRequestId: "req_A", endpoint: "POST /comment", field: "body", agent: "injection", vulnClass: "xss" })

      // A brand-new registry over the SAME session must see the persisted canary.
      const reg2 = new CanaryRegistry(new DbCanaryStore(sid))
      const signals = reg2.scan({ requestId: "req_B", url: "https://shop.example.com/feed", body: `<p>${c.token}</p>` })
      expect(signals).toHaveLength(1)
      expect(signals[0].type).toBe("stored_reflection")
      expect(signals[0].meta?.injectSite).toBe("req_A")
      expect(signals[0].meta?.renderSite).toBe("req_B")
    })
  })

  test("same-site render is not stored_reflection (DB path)", async () => {
    await withSession((sid) => {
      const reg = new CanaryRegistry(new DbCanaryStore(sid))
      const c = reg.register({ originRequestId: "req_A", endpoint: "POST /echo", field: "q", agent: "injection", vulnClass: "xss" })
      expect(reg.scan({ requestId: "req_A", body: `echo ${c.token}` })).toHaveLength(0)
    })
  })

  test("duplicate token is deduped by the unique index", async () => {
    await withSession((sid) => {
      const store = new DbCanaryStore(sid)
      const base = { kind: "reflect" as const, originRequestId: "a", endpoint: "e", field: "f", agent: "x", vulnClass: "xss", createdAt: Date.now() }
      expect(store.add({ ...base, token: "csDUP" })).toBe(true)
      expect(store.add({ ...base, token: "csDUP" })).toBe(false) // conflict → not inserted
      expect(store.all().filter((c) => c.token === "csDUP")).toHaveLength(1)
    })
  })

  test("canaries are isolated per session", async () => {
    await withTwoSessions((a, b) => {
      const regA = new CanaryRegistry(new DbCanaryStore(a))
      const c = regA.register({ originRequestId: "req_A", endpoint: "e", field: "f", agent: "injection", vulnClass: "xss" })
      // Session B must NOT see session A's canary.
      const regB = new CanaryRegistry(new DbCanaryStore(b))
      expect(regB.scan({ requestId: "req_B", body: `x ${c.token} y` })).toHaveLength(0)
      // Sanity: A still sees it.
      expect(regA.scan({ requestId: "req_B", body: `x ${c.token} y` })).toHaveLength(1)
    })
  })
})

describe("SignalStore (real DB)", () => {
  test("record then get round-trips, meta preserved", async () => {
    await withSession((sid) => {
      const store = new SignalStore(sid)
      const r = store.record(sig({ meta: { foo: "bar", n: 3 } }))
      expect(r.deduped).toBe(false)
      const all = store.get()
      expect(all).toHaveLength(1)
      expect(all[0].signal_type).toBe("sql_error")
      expect(all[0].owner).toBe("input-validation")
      expect(all[0].status).toBe("pending")
      expect(all[0].meta).toEqual({ foo: "bar", n: 3 })
    })
  })

  test("same (type,request) is deduped; second record returns the existing id", async () => {
    await withSession((sid) => {
      const store = new SignalStore(sid)
      const first = store.record(sig())
      const second = store.record(sig()) // identical dedup identity
      expect(first.deduped).toBe(false)
      expect(second.deduped).toBe(true)
      expect(second.id).toBe(first.id)
      expect(store.get()).toHaveLength(1)
    })
  })

  test("stored_reflection dedup keys on the canary token — different tokens, same request, both persist", async () => {
    await withSession((sid) => {
      const store = new SignalStore(sid)
      store.record(sig({ type: "stored_reflection", requestId: "req_B", meta: { token: "csAAA" } }))
      store.record(sig({ type: "stored_reflection", requestId: "req_B", meta: { token: "csBBB" } }))
      expect(store.get()).toHaveLength(2)
    })
  })

  test("pending() filters, updateStatus() moves a signal out of pending", async () => {
    await withSession((sid) => {
      const store = new SignalStore(sid)
      const r = store.record(sig())
      expect(store.pending()).toHaveLength(1)
      store.updateStatus(r.id, "confirmed")
      expect(store.pending()).toHaveLength(0)
      expect(store.get()[0].status).toBe("confirmed")
    })
  })

  test("signals are isolated per session", async () => {
    await withTwoSessions((a, b) => {
      new SignalStore(a).record(sig())
      expect(new SignalStore(a).get()).toHaveLength(1)
      expect(new SignalStore(b).get()).toHaveLength(0)
    })
  })
})
