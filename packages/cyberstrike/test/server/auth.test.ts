import { describe, expect, test } from "bun:test"
import { ServerAuth } from "../../src/server/auth"

const header = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`

const input = (value?: string) => ({
  header: value,
  loopback: false,
  proxied: true,
  operator: { username: "cyberstrike", password: "operator-secret" },
  observer: { username: "observer", password: "observer-secret" },
})

describe("server roles", () => {
  test("trusts direct loopback as operator", () => {
    expect(ServerAuth.role({ ...input(), loopback: true, proxied: false })).toBe("operator")
  })

  test("authenticates operator and observer separately", () => {
    expect(ServerAuth.role(input(header("cyberstrike", "operator-secret")))).toBe("operator")
    expect(ServerAuth.role(input(header("observer", "observer-secret")))).toBe("observer")
    expect(ServerAuth.role(input(header("observer", "wrong")))).toBeUndefined()
  })

  test("never grants observer access without an observer password", () => {
    expect(
      ServerAuth.role({
        ...input(header("observer", "")),
        observer: { username: "observer" },
      }),
    ).toBeUndefined()
  })
})

describe("observer policy", () => {
  test("allows redacted activity and posture reads", () => {
    expect(
      ServerAuth.allows("observer", {
        method: "GET",
        path: "/event-log/session/ses_test",
      }),
    ).toBe(true)
    expect(
      ServerAuth.allows("observer", {
        method: "GET",
        path: "/methodology/session/ses_test/chains",
      }),
    ).toBe(true)
    expect(
      ServerAuth.allows("observer", {
        method: "GET",
        path: "/topology/session/ses_test",
      }),
    ).toBe(true)
  })

  test("denies mutations, PTYs, secrets, and raw event streams", () => {
    expect(ServerAuth.allows("observer", { method: "POST", path: "/session" })).toBe(false)
    expect(ServerAuth.allows("observer", { method: "GET", path: "/pty" })).toBe(false)
    expect(ServerAuth.allows("observer", { method: "GET", path: "/config" })).toBe(false)
    expect(ServerAuth.allows("observer", { method: "GET", path: "/global/event" })).toBe(false)
    expect(
      ServerAuth.allows("observer", {
        method: "GET",
        path: "/pty/pty_test/connect",
        upgrade: "websocket",
      }),
    ).toBe(false)
  })
})
