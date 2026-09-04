import { beforeEach, describe, expect, test } from "bun:test"
import { WebHold } from "../../../src/session/web/hold"

beforeEach(() => WebHold._reset())

describe("WebHold", () => {
  test("set/held/clear are per-session", () => {
    expect(WebHold.held("s1")).toBe(false)
    WebHold.set("s1", true)
    expect(WebHold.held("s1")).toBe(true)
    expect(WebHold.held("s2")).toBe(false) // isolated
    WebHold.set("s1", false)
    expect(WebHold.held("s1")).toBe(false)
  })

  test("clearSession releases a hold", () => {
    WebHold.set("s1", true)
    WebHold.clearSession("s1")
    expect(WebHold.held("s1")).toBe(false)
  })
})
