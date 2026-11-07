import { describe, expect, test, afterEach } from "bun:test"
import { MemoryStore, injectPoints, type Transaction, type SendResult, type Sender } from "@cyberstrike-io/vortex"
import { Ssrf } from "../../../src/session/web/ssrf-probe"
import type { OobStore } from "../../../src/oob/store"

function tx(id: string, url: string): Transaction {
  return { id, session: "s", source: "browser", host: "app.test", request: { method: "GET", url, headers: [] }, response: { status: 200, headers: [], body: "ok" } }
}

// A network-free sender that records the mutation values it was asked to send.
function recorder(): { send: Sender; sent: { name?: string; value?: string }[] } {
  const sent: { name?: string; value?: string }[] = []
  const send: Sender = async (input, opts) => {
    const m = (opts as { mutations?: { name?: string; value?: string }[] } | undefined)?.mutations?.[0]
    if (m) sent.push({ name: m.name, value: m.value })
    return {
      transaction: input as Transaction,
      result: { response: { version: "HTTP/1.1", status: 200, reason: "OK", headers: [], body: new Uint8Array() }, timing: { totalMs: 1 }, attempts: 1 },
    } as SendResult
  }
  return { send, sent }
}

function storeWith(...txs: Transaction[]): MemoryStore {
  const store = new MemoryStore()
  for (const t of txs) {
    store.add(t)
    store.addInjectPoints(injectPoints(t))
  }
  return store
}

const SID = "ssrf_sess"
afterEach(() => Ssrf.clear(SID))

describe("Ssrf.probe — inject OOB URL into url-ish params (#89)", () => {
  test("injects a unique OOB host into a url-ish param + records pending + registers a callback canary", async () => {
    const store = storeWith(tx("t1", "https://app.test/fetch?url=https://example.com"))
    const r = recorder()
    const res = await Ssrf.probe(SID, store, r.send, { domain: "oob.test" })

    expect(res.sent).toBe(1)
    expect(Ssrf.pendingCount(SID)).toBe(1)
    // the injected value is an OOB URL under the configured domain
    const inj = r.sent.find((s) => s.name === "url")
    expect(inj?.value).toMatch(/^http:\/\/[a-z0-9]+\.oob\.test\/$/)
    // a callback canary was registered for traceability
    const cb = store.canaries().filter((c) => c.kind === "callback")
    expect(cb.length).toBe(1)
    expect(cb[0].vulnClass).toBe("ssrf")
  })

  test("targets ONLY url-ish params — a numeric id and a text param are not probed", async () => {
    const store = storeWith(tx("t2", "https://app.test/items?id=5&title=hello"))
    const r = recorder()
    const res = await Ssrf.probe(SID, store, r.send, { domain: "oob.test" })
    expect(res.sent).toBe(0)
    expect(Ssrf.pendingCount(SID)).toBe(0)
  })

  test("a point is probed once — a second pass does not re-inject it", async () => {
    const store = storeWith(tx("t3", "https://app.test/img?src=https://a/b.png"))
    const r = recorder()
    expect((await Ssrf.probe(SID, store, r.send, { domain: "oob.test" })).sent).toBe(1)
    expect((await Ssrf.probe(SID, store, r.send, { domain: "oob.test" })).sent).toBe(0) // already seen
  })

  test("no OOB domain configured ⇒ nothing is sent", async () => {
    const store = storeWith(tx("t4", "https://app.test/fetch?url=https://example.com"))
    const r = recorder()
    const res = await Ssrf.probe(SID, store, r.send, { domain: "" }) // explicit empty = unconfigured
    expect(res.sent).toBe(0)
  })
})

describe("Ssrf.reconcile — a captured OOB callback confirms blind SSRF (#89)", () => {
  async function seed(url: string): Promise<{ store: MemoryStore; token: string }> {
    const store = storeWith(tx("o1", url))
    const r = recorder()
    await Ssrf.probe(SID, store, r.send, { domain: "oob.test" })
    const token = r.sent.find((s) => s.name)!.value!.match(/\/\/([a-z0-9]+)\.oob\.test/)![1]!
    return { store, token }
  }

  test("a pending token with a captured interaction → one ssrf-oob signal, pending cleared", async () => {
    const { store, token } = await seed("https://app.test/fetch?url=https://example.com")
    const hit: OobStore.Interaction = { protocol: "dns", remoteAddr: "203.0.113.9", at: Date.now(), detail: "A url.oob.test" }
    const read = async (t: string) => (t === token ? [hit] : [])

    const sigs = await Ssrf.reconcile(SID, store, read)
    expect(sigs).toHaveLength(1)
    expect(sigs[0].ruleId).toBe("ssrf-oob")
    expect(sigs[0].category).toBe("injection")
    expect(sigs[0].param?.dotpath).toBe("url")
    expect(sigs[0].evidence).toContain("203.0.113.9")
    expect(Ssrf.pendingCount(SID)).toBe(0) // confirmed → stop polling it
    // persisted into the store (so it shows in vortexSignals + routes)
    expect(store.signals({ ruleId: "ssrf-oob" }).length).toBe(1)
  })

  test("no interaction yet → no signal, pending kept for the next poll", async () => {
    const { store } = await seed("https://app.test/fetch?url=https://example.com")
    const sigs = await Ssrf.reconcile(SID, store, async () => [])
    expect(sigs).toHaveLength(0)
    expect(Ssrf.pendingCount(SID)).toBe(1) // still waiting
  })
})
