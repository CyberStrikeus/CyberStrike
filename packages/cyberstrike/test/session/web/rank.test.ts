import { beforeEach, describe, expect, test } from "bun:test"
import { Rank } from "../../../src/session/web/rank"
import { PageState } from "../../../src/session/web/page-state"
import { Crawl } from "../../../src/session/web/crawl"

beforeEach(() => {
  PageState._reset()
  Crawl._reset()
})

// Build an annotated StatePayload via the real store so kind/policy match production.
function state(sid: string, url: string, clickables: PageState.Observation["clickables"]) {
  PageState.set(sid, { url, title: "", clickables, forms: [], links: [], observed_at: Date.now() })
  return PageState.get(sid, url)!
}

describe("Rank.candidates", () => {
  test("keeps only allow nav/query; excludes logout/destructive/mutating", () => {
    const st = state("s", "https://h/a", [
      { id: "e1", tag: "a", role: "link", label: "Section B", href: "/b" }, // nav
      { id: "e2", tag: "button", role: "", label: "Search", href: "" }, // query
      { id: "e3", tag: "button", role: "", label: "Log out", href: "" }, // logout → deny
      { id: "e4", tag: "a", role: "link", label: "Delete account", href: "/x" }, // destructive → confirm
      { id: "e5", tag: "button", role: "", label: "Save", href: "" }, // mutating → not navigable
    ])
    const ids = Rank.candidates("s", st).map((c) => c.id)
    expect(ids.sort()).toEqual(["e1", "e2"])
  })

  test("new-target + viewport + testid raise a candidate's rank", () => {
    const st = state("s", "https://h/a", [
      { id: "lo", tag: "a", role: "link", label: "Query it", href: "/a", in_viewport: false }, // query, same page (visited target), offscreen
      { id: "hi", tag: "a", role: "link", label: "New Area", href: "/new", in_viewport: true, testid: "nav-new" }, // nav, new target, viewport, testid
    ])
    Crawl.markPage("s", "https://h/a") // so /a is a visited target (no newTarget bonus for 'lo')
    const ordered = Rank.candidates("s", st).map((c) => c.id)
    expect(ordered[0]).toBe("hi")
  })

  test("strategy priorities boost matching candidates above default ranking", () => {
    const st = state("s", "https://h/a", [
      { id: "top", tag: "a", role: "link", label: "Dashboard", href: "/dash", in_viewport: true }, // higher base
      { id: "prio", tag: "a", role: "link", label: "Billing settings", href: "/billing" }, // lower base
    ])
    // Without priorities, the viewport one leads.
    expect(Rank.candidates("s", st)[0].id).toBe("top")
    // A "billing" priority (from the main model) lifts it to the front.
    expect(Rank.candidates("s", st, ["billing"])[0].id).toBe("prio")
  })

  test("excludes already-acted elements and dedupes by action-key", () => {
    const st = state("s", "https://h/a", [
      { id: "e1", tag: "a", role: "link", label: "B", href: "/b" },
      { id: "e2", tag: "a", role: "link", label: "B", href: "/b" }, // same role:label|href → same key → dedupe
    ])
    expect(Rank.candidates("s", st).length).toBe(1)
    Crawl.record("s", Rank.candidates("s", st)[0].actionKey)
    expect(Rank.candidates("s", st).length).toBe(0)
  })
})
