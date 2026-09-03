import { describe, expect, test, beforeEach } from "bun:test"
import { PageState } from "../../../src/session/web/page-state"

const cl = (id: string, label: string, href = "", tag = "button", role = "") => ({ id, tag, role, label, href })
const obs = (url: string, clickables: ReturnType<typeof cl>[]): PageState.Observation => ({
  url,
  title: "t",
  clickables,
  forms: [],
  links: [],
})

beforeEach(() => PageState._reset())

describe("PageState.set", () => {
  test("annotates clickables with kind and returns counts", () => {
    const counts = PageState.set("s1", obs("/u", [cl("e1", "Delete User"), cl("e2", "Home", "/home", "a"), cl("e3", "Log out")]))
    expect(counts.destructive).toBe(1)
    expect(counts.nav).toBe(1)
    expect(counts.logout).toBe(1)
  })
})

describe("PageState.get (get_page_state)", () => {
  test("clickables carry their action policy (guard)", () => {
    PageState.set("s1", obs("/u", [cl("e1", "Delete User"), cl("e2", "Home", "/home", "a"), cl("e3", "Log out")]))
    const st = PageState.get("s1", "/u")!
    const byId = Object.fromEntries(st.clickables.map((c) => [c.id, c.policy]))
    expect(byId.e1).toBe("confirm") // destructive
    expect(byId.e3).toBe("deny") // logout
    expect(byId.e2).toBe("allow") // nav
  })
  test("view filters to one kind", () => {
    PageState.set("s1", obs("/u", [cl("e1", "Delete User"), cl("e2", "Home", "/home", "a")]))
    const nav = PageState.get("s1", "/u", "nav")!
    expect(nav.clickables.map((c) => c.id)).toEqual(["e2"])
  })
  test("unknown url → null", () => {
    expect(PageState.get("s1", "/nope")).toBeNull()
  })
})

describe("PageState.elementPolicy (used by /web/action)", () => {
  test("returns kind + policy + label for a known element", () => {
    PageState.set("s1", obs("/u", [cl("e1", "Log out")]))
    expect(PageState.elementPolicy("s1", "/u", "e1")).toEqual({ kind: "logout", policy: "deny", label: "Log out" })
  })
  test("unknown element or url → null", () => {
    PageState.set("s1", obs("/u", [cl("e1", "Home", "/home", "a")]))
    expect(PageState.elementPolicy("s1", "/u", "nope")).toBeNull()
    expect(PageState.elementPolicy("s1", "/other", "e1")).toBeNull()
  })
})

describe("isolation", () => {
  test("sessions do not share page-state", () => {
    PageState.set("a", obs("/x", [cl("e1", "Home", "/h", "a")]))
    expect(PageState.get("b", "/x")).toBeNull()
    expect(PageState.urls("a")).toEqual(["/x"])
  })
})
