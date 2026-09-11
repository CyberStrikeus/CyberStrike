import { describe, expect, test } from "bun:test"
import { categoryToClass, signalPriority, shouldRoute } from "../../src/session/web/signal/vortex-route"

describe("categoryToClass", () => {
  test("maps every Vortex category to its owning WSTG class", () => {
    expect(categoryToClass("injection")).toBe("input-validation")
    expect(categoryToClass("misconfiguration")).toBe("config-deployment")
    expect(categoryToClass("access-control")).toBe("authorization")
    expect(categoryToClass("info-disclosure")).toBe("information-gathering")
    expect(categoryToClass("auth")).toBe("authentication")
    expect(categoryToClass("auth-session")).toBe("session-management")
    expect(categoryToClass("redirect")).toBe("client-side")
    expect(categoryToClass("vulnerable-component")).toBe("config-deployment")
  })

  test("an unknown category has no owner (surfaced, not routed)", () => {
    expect(categoryToClass("something-new")).toBeUndefined()
  })
})

describe("signalPriority", () => {
  test("collapses Vortex severity onto the 3-level queue priority", () => {
    expect(signalPriority("critical")).toBe("high")
    expect(signalPriority("high")).toBe("high")
    expect(signalPriority("medium")).toBe("medium")
    expect(signalPriority("low")).toBe("low")
    expect(signalPriority("info")).toBe("low")
  })
})

describe("shouldRoute — the volume gate", () => {
  test("medium+ with an owning class auto-routes", () => {
    expect(shouldRoute("injection", "high")).toBe(true)
    expect(shouldRoute("access-control", "medium")).toBe(true)
    expect(shouldRoute("misconfiguration", "critical")).toBe(true)
  })

  test("low/info never auto-route (sidebar-only)", () => {
    expect(shouldRoute("injection", "low")).toBe(false)
    expect(shouldRoute("misconfiguration", "info")).toBe(false)
  })

  test("an unmapped category never routes even at high severity", () => {
    expect(shouldRoute("something-new", "high")).toBe(false)
    expect(shouldRoute("something-new", "critical")).toBe(false)
  })
})
