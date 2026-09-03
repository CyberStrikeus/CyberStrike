import { beforeEach, describe, expect, test } from "bun:test"
import { WebDriver } from "../../../src/session/web/driver"

beforeEach(() => WebDriver._reset())

describe("WebDriver store", () => {
  test("unset → undefined; interlock treats unset as not-human", () => {
    expect(WebDriver.get("s")).toBeUndefined()
    expect(WebDriver.isHuman("s")).toBe(false)
    expect(WebDriver.isAI("s")).toBe(false)
  })
  test("set + read back", () => {
    WebDriver.set("s", "human")
    expect(WebDriver.get("s")).toBe("human")
    expect(WebDriver.isHuman("s")).toBe(true)
    WebDriver.set("s", "ai")
    expect(WebDriver.get("s")).toBe("ai")
    expect(WebDriver.isAI("s")).toBe(true)
    expect(WebDriver.isHuman("s")).toBe(false)
  })
  test("anything not 'human' normalizes to 'ai'", () => {
    // @ts-expect-error — guarding the runtime path against bad input
    WebDriver.set("s", "bogus")
    expect(WebDriver.get("s")).toBe("ai")
  })
  test("per-session isolation + clearSession", () => {
    WebDriver.set("a", "human")
    WebDriver.set("b", "ai")
    WebDriver.clearSession("a")
    expect(WebDriver.get("a")).toBeUndefined()
    expect(WebDriver.get("b")).toBe("ai")
  })
})
