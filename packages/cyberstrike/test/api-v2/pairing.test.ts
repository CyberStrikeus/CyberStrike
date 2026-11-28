import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { listen } from "../../src/api-v2/server"
import { pairing } from "../../src/api-v2/pairing"

const MINUTE = 60_000
const PASSWORD = "pairing-pw"
const AUTH = `Basic ${Buffer.from(`cyberstrike:${PASSWORD}`).toString("base64")}`
// A forwarded header turns off local trust, so the request is judged by its credentials.
const REMOTE = { "x-forwarded-for": "203.0.113.7" }

describe("pairing store", () => {
  test("a code expires five minutes after it is issued", () => {
    let now = 0
    const store = pairing(() => now)
    const { code, expires_in } = store.issue()
    expect(expires_in).toBe(300)
    now = 5 * MINUTE - 1
    const expiring = store.redeem(code, "peer")
    expect(typeof expiring).toBe("string")

    now = 0
    const second = store.issue().code
    now = 5 * MINUTE
    expect(store.redeem(second, "peer")).toBeUndefined()
  })

  test("a code is single use", () => {
    const store = pairing()
    const { code } = store.issue()
    expect(typeof store.redeem(code, "peer")).toBe("string")
    expect(store.redeem(code, "peer")).toBeUndefined()
  })

  test("a wrong code is refused and leaves the real code usable", () => {
    const store = pairing()
    const { code } = store.issue()
    expect(store.redeem("not-a-code", "peer")).toBeUndefined()
    expect(typeof store.redeem(code, "peer")).toBe("string")
  })

  test("the outstanding codes are capped, evicting the oldest", () => {
    const store = pairing()
    const first = store.issue().code
    for (let i = 0; i < 9; i++) store.issue()
    const last = store.issue().code
    expect(store.redeem(first, "peer")).toBeUndefined()
    expect(typeof store.redeem(last, "peer")).toBe("string")
  })

  test("repeated failures limit a peer for one minute and not other peers", () => {
    let now = 0
    const store = pairing(() => now)
    for (let i = 0; i < 4; i++) store.redeem("wrong", "attacker")
    expect(store.limited("attacker")).toBe(false)
    store.redeem("wrong", "attacker")
    expect(store.limited("attacker")).toBe(true)
    expect(store.limited("other")).toBe(false)
    now = MINUTE
    expect(store.limited("attacker")).toBe(false)
  })

  test("a token authorizes until it expires after thirty days", () => {
    let now = 0
    const store = pairing(() => now)
    const { code } = store.issue()
    const token = store.redeem(code, "peer")
    if (token === undefined) throw new Error("redeem failed")
    expect(store.valid(token)).toBe(true)
    expect(store.valid("bad-token")).toBe(false)
    now = 30 * 24 * 60 * MINUTE
    expect(store.valid(token)).toBe(false)
  })
})

describe("pairing over HTTP", () => {
  let base: string
  let stop: () => Promise<void>

  beforeAll(async () => {
    const server = await listen({ hostname: "127.0.0.1", port: 0, password: PASSWORD })
    base = server.url.toString().replace(/\/$/, "")
    stop = server.stop
  })

  afterAll(async () => {
    await stop()
  })

  const json = async (res: Response) => (await res.json().catch(() => null)) as Record<string, any> | null

  test("a pairing code is issued to an authorized client", async () => {
    const res = await fetch(`${base}/api/pair`, { method: "POST", headers: { authorization: AUTH } })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(typeof body?.code).toBe("string")
    expect(body?.code.length).toBe(22)
    expect(body?.expires_in).toBe(300)
  })

  test("issuing a code requires credentials for a remote client", async () => {
    const res = await fetch(`${base}/api/pair`, { method: "POST", headers: REMOTE })
    expect(res.status).toBe(401)
  })

  test("redeeming a code yields a token that authorizes requests, and the code cannot be reused", async () => {
    const { code } = (await json(await fetch(`${base}/api/pair`, { method: "POST", headers: { authorization: AUTH } }))) as {
      code: string
    }
    const connected = await fetch(`${base}/auth/connect/${code}`, { headers: REMOTE })
    expect(connected.status).toBe(200)
    const token = (await json(connected))?.token
    expect(typeof token).toBe("string")

    expect((await fetch(`${base}/api/info`, { headers: { ...REMOTE, authorization: `Bearer ${token}` } })).status).toBe(200)
    expect((await fetch(`${base}/api/info`, { headers: { ...REMOTE, authorization: "Bearer bad-token" } })).status).toBe(401)
    expect((await fetch(`${base}/api/info`, { headers: REMOTE })).status).toBe(401)
    expect((await fetch(`${base}/auth/connect/${code}`, { headers: REMOTE })).status).toBe(401)
  })

  test("basic auth keeps working", async () => {
    expect((await fetch(`${base}/api/info`, { headers: { ...REMOTE, authorization: AUTH } })).status).toBe(200)
  })

  test("repeated wrong codes lock out redemption, even of a valid code", async () => {
    const { code } = (await json(await fetch(`${base}/api/pair`, { method: "POST", headers: { authorization: AUTH } }))) as {
      code: string
    }
    for (let i = 0; i < 6; i++) {
      expect((await fetch(`${base}/auth/connect/wrong-${i}`, { headers: REMOTE })).status).toBe(401)
    }
    const locked = await fetch(`${base}/auth/connect/${code}`, { headers: REMOTE })
    expect(locked.status).toBe(401)
    expect((await json(locked))?.message).toBe("Too many failed attempts")
  })
})
