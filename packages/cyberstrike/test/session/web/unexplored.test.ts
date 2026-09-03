import { beforeEach, describe, expect, test } from "bun:test"
import { Unexplored } from "../../../src/session/web/unexplored"
import { PageState } from "../../../src/session/web/page-state"
import { Crawl } from "../../../src/session/web/crawl"

beforeEach(() => {
  PageState._reset()
  Crawl._reset()
})

function state(sid: string, clickables: PageState.Observation["clickables"]) {
  PageState.set(sid, { url: "https://h/p", title: "", clickables, forms: [], links: [], observed_at: Date.now() })
  return PageState.get(sid, "https://h/p")!
}

describe("Unexplored.expanders", () => {
  test("selects `other` openers by real signals; skips nav/query and signalless cursor elements", () => {
    const st = state("s", [
      { id: "m", tag: "div", role: "button", label: "Menu", href: "", aria: { haspopup: "menu" } }, // other + haspopup
      { id: "t", tag: "div", role: "tab", label: "Details", href: "" }, // other + expander role
      { id: "L", tag: "div", role: "generic", label: "Box", href: "", why: "cursor" }, // other, cursor-only → skip
      { id: "n", tag: "a", role: "link", label: "Home", href: "/home" }, // nav → not here
    ])
    const ids = Unexplored.expanders("s", st).map((c) => c.id)
    expect(ids).toEqual(["m", "t"]) // haspopup(4)+button(1)=5 above tab-role(3); Box & Home excluded
  })

  test("aria-expanded=false and a detected listener also count as openers", () => {
    const st = state("s", [
      { id: "acc", tag: "div", role: "region", label: "Section", href: "", aria: { expanded: "false" } },
      { id: "js", tag: "div", role: "generic", label: "Widget", href: "", why: "cursor,listener" },
    ])
    expect(Unexplored.expanders("s", st).map((c) => c.id).sort()).toEqual(["acc", "js"])
  })

  test("an already-tried opener is not offered again", () => {
    const st = state("s", [{ id: "m", tag: "div", role: "button", label: "Menu", href: "", aria: { haspopup: "menu" } }])
    const key = Unexplored.expanders("s", st)[0].actionKey
    Crawl.record("s", key)
    expect(Unexplored.expanders("s", st).length).toBe(0)
  })
})
