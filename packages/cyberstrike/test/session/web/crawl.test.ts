import { beforeEach, describe, expect, test } from "bun:test"
import { Crawl } from "../../../src/session/web/crawl"

beforeEach(() => Crawl._reset())

describe("Crawl.actionKey — stable, normalized identity", () => {
  test("normalizes case + whitespace of label and role", () => {
    const a = Crawl.actionKey("https://h/u", { role: "Button", label: "  Delete   User ", href: "" })
    const b = Crawl.actionKey("https://h/u", { role: "button", label: "delete user", href: "" })
    expect(a).toBe(b)
  })
  test("same control on different pages is a different key", () => {
    const a = Crawl.actionKey("https://h/a", { role: "link", label: "Home", href: "/home" })
    const b = Crawl.actionKey("https://h/b", { role: "link", label: "Home", href: "/home" })
    expect(a).not.toBe(b)
  })
  test("href participates in identity", () => {
    const a = Crawl.actionKey("https://h/u", { role: "link", label: "Next", href: "/p/1" })
    const b = Crawl.actionKey("https://h/u", { role: "link", label: "Next", href: "/p/2" })
    expect(a).not.toBe(b)
  })
})

describe("Crawl budget", () => {
  test("default budget, record consumes it, overBudget trips at the limit", () => {
    Crawl.setBudget("s", 2)
    expect(Crawl.overBudget("s")).toBe(false)
    Crawl.record("s", "k1")
    expect(Crawl.overBudget("s")).toBe(false)
    Crawl.record("s", "k2")
    expect(Crawl.overBudget("s")).toBe(true) // 2/2 → no more actions allowed
    const s = Crawl.summary("s")
    expect(s).toEqual({ actions: 2, budget: 2, remaining: 0, over_budget: true, pages_visited: 0 })
  })
  test("unset session uses DEFAULT_BUDGET", () => {
    expect(Crawl.summary("fresh").budget).toBe(Crawl.DEFAULT_BUDGET)
  })
  test("setBudget rejects non-positive / non-finite", () => {
    Crawl.setBudget("s", 0)
    Crawl.setBudget("s", -5)
    Crawl.setBudget("s", Number.NaN)
    expect(Crawl.summary("s").budget).toBe(Crawl.DEFAULT_BUDGET)
  })
})

describe("Crawl visited tracking", () => {
  test("isActed reflects record; pages tracked separately", () => {
    expect(Crawl.isActed("s", "k")).toBe(false)
    Crawl.record("s", "k")
    expect(Crawl.isActed("s", "k")).toBe(true)
    expect(Crawl.isPageVisited("s", "https://h/u")).toBe(false)
    Crawl.markPage("s", "https://h/u")
    expect(Crawl.isPageVisited("s", "https://h/u")).toBe(true)
    expect(Crawl.summary("s").pages_visited).toBe(1)
  })
  test("clearSession wipes one session only", () => {
    Crawl.record("a", "k")
    Crawl.record("b", "k")
    Crawl.clearSession("a")
    expect(Crawl.isActed("a", "k")).toBe(false)
    expect(Crawl.isActed("b", "k")).toBe(true)
  })
})

describe("Crawl frontier (dead-end backtracking)", () => {
  test("discover queues unvisited urls; takeFrontier drains them once", () => {
    Crawl.discover("s", ["https://h/b", "https://h/c", undefined])
    const first = Crawl.takeFrontier("s")
    const second = Crawl.takeFrontier("s")
    expect([first, second].sort()).toEqual(["https://h/b", "https://h/c"])
    expect(Crawl.takeFrontier("s")).toBeUndefined() // drained
  })
  test("discover skips already-visited urls, and takeFrontier skips ones visited meanwhile", () => {
    Crawl.markPage("s", "https://h/b")
    Crawl.discover("s", ["https://h/b", "https://h/c"]) // /b already visited → not queued
    Crawl.markPage("s", "https://h/c") // visited after discovery
    expect(Crawl.takeFrontier("s")).toBeUndefined() // /b never queued, /c now visited
  })
})

describe("Crawl frontier — a marked-visited url cannot re-enter (redirect-spin guard)", () => {
  test("markPage(url) stops discover() from re-adding it, so a redirecting frontier url won't spin", () => {
    const sid = "s"
    // A page links to /review/ (which redirects to /review/dashboard when navigated).
    Crawl.discover(sid, ["https://h/review/"])
    // The loop takes it and marks the REQUESTED url visited (the fix) before navigating.
    const next = Crawl.takeFrontier(sid)
    expect(next).toBe("https://h/review/")
    Crawl.markPage(sid, next!)
    // Navigation lands on the redirect target; that page again links back to /review/.
    Crawl.markPage(sid, "https://h/review/dashboard")
    Crawl.discover(sid, ["https://h/review/"]) // re-seen link
    // /review/ must NOT re-enter the frontier — it's marked visited → no spin.
    expect(Crawl.takeFrontier(sid)).toBeUndefined()
  })
})
