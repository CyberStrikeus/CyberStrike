import { beforeEach, describe, expect, test } from "bun:test"
import { ExhaustiveNavigator } from "../../../../src/session/web/nav/exhaustive-navigator"
import { PageState } from "../../../../src/session/web/page-state"
import { Crawl } from "../../../../src/session/web/crawl"
import { WebScope } from "../../../../src/session/web/scope"
import { WebStrategy } from "../../../../src/session/web/strategy"

beforeEach(() => {
  PageState._reset()
  Crawl._reset()
  WebScope._reset()
  WebStrategy._reset()
})

type Click = PageState.Observation["clickables"][number]
function page(sid: string, url: string, clickables: Click[]): PageState.StatePayload {
  PageState.set(sid, { url, title: url, clickables, forms: [], links: [], observed_at: 1 })
  return PageState.get(sid, url)!
}

describe("ExhaustiveNavigator — 1.1.16-style: exercise every control", () => {
  test("plans EVERY allow-policy control (buttons + links + widgets), not just the top-ranked", async () => {
    const sid = "s"
    WebScope.ensure(sid, "https://app.example.com/")
    const snap = page(sid, "https://app.example.com/", [
      { id: "n1", tag: "a", role: "link", label: "Accounts", href: "/accounts" }, // nav → allow
      { id: "b1", tag: "button", role: "button", label: "Load data", href: "" }, // action → allow
      { id: "b2", tag: "button", role: "button", label: "Refresh", href: "" }, // action → allow
      { id: "w1", tag: "div", role: "button", label: "Open panel", href: "", why: "role" }, // widget → allow
    ])
    const ids = (await new ExhaustiveNavigator(false).plan(sid, snap)).actions.map((a) => (a.kind === "click" ? a.elementId : a.kind))
    // ALL four — a ranker would return only the top one; exhaustive returns every control.
    expect(ids.sort()).toEqual(["b1", "b2", "n1", "w1"])
  })

  test("logout is NEVER planned; destructive is planned ONLY in aggressive mode", async () => {
    const sid = "s"
    WebScope.ensure(sid, "https://app.example.com/")
    const snap = page(sid, "https://app.example.com/", [
      { id: "ok", tag: "button", role: "button", label: "Save", href: "" }, // mutating → allow (guard: "mutating")
      { id: "del", tag: "button", role: "", label: "Delete account", href: "" }, // destructive → confirm
      { id: "lo", tag: "a", role: "link", label: "Log out", href: "/logout" }, // logout → deny
    ])
    const safe = (await new ExhaustiveNavigator(false).plan(sid, snap)).actions.map((a) => (a.kind === "click" ? a.elementId : ""))
    expect(safe).toContain("ok")
    expect(safe).not.toContain("del") // destructive skipped when not aggressive
    expect(safe).not.toContain("lo") // logout always skipped

    const aggro = (await new ExhaustiveNavigator(true).plan(sid, snap)).actions.map((a) => (a.kind === "click" ? a.elementId : ""))
    expect(aggro).toContain("del") // destructive INCLUDED in aggressive mode
    expect(aggro).not.toContain("lo") // logout STILL skipped even aggressive
  })

  test("already-acted elements are not re-planned (page exhausts → empty plan → BFS backtrack)", async () => {
    const sid = "s"
    WebScope.ensure(sid, "https://app.example.com/")
    const snap = page(sid, "https://app.example.com/", [{ id: "b1", tag: "button", role: "button", label: "X", href: "" }])
    Crawl.record(sid, Crawl.actionKey("https://app.example.com/", { role: "button", label: "X", href: "" }))
    expect((await new ExhaustiveNavigator(false).plan(sid, snap)).actions).toEqual([])
  })
})
