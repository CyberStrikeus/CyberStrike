import { beforeEach, describe, expect, test } from "bun:test"
import { CoDriveSession } from "../../../../src/session/web/nav/co-drive-session"
import { DeterministicNavigator } from "../../../../src/session/web/nav/deterministic-navigator"
import { WebActExecutor } from "../../../../src/session/web/nav/web-act-executor"
import { Guardrails, PageStateObserver } from "../../../../src/session/web/nav/guardrails"
import { snapshotSignature } from "../../../../src/session/web/nav/types"
import { PageState } from "../../../../src/session/web/page-state"
import { WebControl } from "../../../../src/session/web/control"
import { WebDriver } from "../../../../src/session/web/driver"
import { Crawl } from "../../../../src/session/web/crawl"
import { WebScope } from "../../../../src/session/web/scope"
import { WebStrategy } from "../../../../src/session/web/strategy"
import { Effect } from "../../../../src/session/web/effect"

beforeEach(() => {
  PageState._reset()
  WebControl._reset()
  WebDriver._reset()
  Crawl._reset()
  WebScope._reset()
  WebStrategy._reset()
  Effect._reset()
})

type Click = PageState.Observation["clickables"][number]
// A scripted site + fake extension socket: clicking a link (or navigating) moves the browser to
// the target page and re-observes it — the same shape the real extension produces.
function browser(sid: string, site: Record<string, Click[]>, startUrl: string, visited?: string[]) {
  let current = startUrl
  let clock = 1
  const observe = (url: string) => {
    current = url
    visited?.push(url)
    const cl = site[url] ?? []
    const links = cl.filter((c) => c.tag === "a" && c.href).map((c) => new URL(c.href, url).href)
    PageState.set(sid, { url, title: url, clickables: cl, forms: [], links, observed_at: ++clock })
  }
  WebControl.connect(sid, {
    send(data: string) {
      const m = JSON.parse(data)
      if (m.op === "navigate" && m.url) observe(m.url)
      else if (m.op === "click") {
        const el = (site[current] ?? []).find((c) => c.id === m.elementId)
        if (el && el.href) observe(new URL(el.href, current).href)
      }
      WebControl.onAck(JSON.stringify({ id: m.id, ok: true }))
    },
  })
  observe(startUrl)
}
const fast = { settleMs: 15, pollMs: 2, maxIdle: 3 }
const snap = (sid: string, url: string) => PageState.get(sid, url)!

describe("snapshotSignature (material-change detection)", () => {
  test("stable across a no-op; changes on new content or navigation", () => {
    PageState.set("s", { url: "https://h/a", title: "", clickables: [{ id: "e1", tag: "a", role: "link", label: "X", href: "/x" }], forms: [], links: [], observed_at: 1 })
    const a1 = snapshotSignature(snap("s", "https://h/a"))
    // same DOM again → same signature
    PageState.set("s", { url: "https://h/a", title: "", clickables: [{ id: "e9", tag: "a", role: "link", label: "X", href: "/x" }], forms: [], links: [], observed_at: 2 })
    expect(snapshotSignature(snap("s", "https://h/a"))).toBe(a1) // id changed but role:label|href identical
    // a new element appears → different
    PageState.set("s", { url: "https://h/a", title: "", clickables: [{ id: "e1", tag: "a", role: "link", label: "X", href: "/x" }, { id: "e2", tag: "a", role: "link", label: "Y", href: "/y" }], forms: [], links: [], observed_at: 3 })
    expect(snapshotSignature(snap("s", "https://h/a"))).not.toBe(a1)
  })
})

describe("DeterministicNavigator.plan", () => {
  test("plans the top nav link; empty plan when the page is exhausted", async () => {
    PageState.set("s", { url: "https://h/a", title: "", clickables: [{ id: "e1", tag: "a", role: "link", label: "Home", href: "/home" }], forms: [], links: [], observed_at: 1 })
    const nav = new DeterministicNavigator()
    const plan = await nav.plan("s", snap("s", "https://h/a"))
    expect(plan.actions).toEqual([{ kind: "click", elementId: "e1", label: "Home" }])

    PageState.set("s", { url: "https://h/leaf", title: "", clickables: [], forms: [], links: [], observed_at: 2 })
    expect((await nav.plan("s", snap("s", "https://h/leaf"))).actions).toEqual([])
  })
})

describe("Guardrails.terminal", () => {
  test("stops on human / no-extension / budget, else continues", () => {
    const g = new Guardrails()
    const sid = "s"
    expect(g.terminal(sid)).toBe("no-extension-connected") // nothing connected
    WebControl.connect(sid, { send: () => {} })
    expect(g.terminal(sid)).toBeNull()
    Crawl.setBudget(sid, 1)
    Crawl.record(sid, "k")
    expect(g.terminal(sid)).toBe("budget-exhausted")
    Crawl._reset()
    WebDriver.set(sid, "human")
    expect(g.terminal(sid)).toBe("human-took-over")
  })
})

describe("WebActExecutor.run — effect detection", () => {
  test("a link click that navigates reports 'navigated'", async () => {
    const sid = "s"
    browser(sid, { "https://h/a": [{ id: "E0", tag: "a", role: "link", label: "B", href: "/b" }], "https://h/b": [] }, "https://h/a")
    const ex = new WebActExecutor(fast)
    const r = await ex.run(sid, { kind: "click", elementId: "E0" }, snap(sid, "https://h/a"))
    expect(r.ok).toBe(true)
    expect(r.effect).toBe("navigated")
  })
})

describe("CoDriveSession.run — end-to-end (behavior parity)", () => {
  test("crawls a small site to full coverage (frontier backtrack)", async () => {
    const sid = "s"
    browser(sid, {
      "https://h/a": [
        { id: "E0", tag: "a", role: "link", label: "B", href: "/b" },
        { id: "E1", tag: "a", role: "link", label: "C", href: "/c" },
      ],
      "https://h/b": [],
      "https://h/c": [],
    }, "https://h/a")
    const reason = await CoDriveSession.withDefaults(fast).run(sid)
    expect(reason).toBe("coverage-complete")
    for (const u of ["https://h/a", "https://h/b", "https://h/c"]) expect(Crawl.isPageVisited(sid, u)).toBe(true)
  })

  test("budget is a hard stop", async () => {
    const sid = "s"
    const links = Array.from({ length: 10 }, (_, i) => ({ id: `E${i}`, tag: "a", role: "link", label: `P${i}`, href: `/p${i}` }) as Click)
    const site: Record<string, Click[]> = { "https://h/a": links }
    for (let i = 0; i < 10; i++) site[`https://h/p${i}`] = []
    browser(sid, site, "https://h/a")
    Crawl.setBudget(sid, 3)
    const reason = await CoDriveSession.withDefaults(fast).run(sid)
    expect(reason).toBe("budget-exhausted")
    expect(Crawl.summary(sid).actions).toBe(3)
  })

  test("human-driver mode stops immediately without acting", async () => {
    const sid = "s"
    browser(sid, { "https://h/a": [{ id: "E0", tag: "a", role: "link", label: "B", href: "/b" }], "https://h/b": [] }, "https://h/a")
    WebDriver.set(sid, "human")
    expect(await CoDriveSession.withDefaults(fast).run(sid)).toBe("human-took-over")
    expect(Crawl.summary(sid).actions).toBe(0)
  })

  test("stays in scope — never follows an external link", async () => {
    const sid = "s"
    const visited: string[] = []
    browser(sid, {
      "https://demo.testfire.net/": [
        { id: "E0", tag: "a", role: "link", label: "Account", href: "/account" },
        { id: "E1", tag: "a", role: "link", label: "GitHub", href: "https://github.com/x/y" },
      ],
      "https://demo.testfire.net/account": [],
    }, "https://demo.testfire.net/", visited)
    const reason = await CoDriveSession.withDefaults(fast).run(sid)
    expect(reason).toBe("coverage-complete")
    expect(Crawl.isPageVisited(sid, "https://demo.testfire.net/account")).toBe(true)
    expect(visited.some((u) => u.includes("github.com"))).toBe(false)
  })

  test("a cancel signal (driver flipped) ends the loop between steps", async () => {
    const sid = "s"
    browser(sid, { "https://h/a": [{ id: "E0", tag: "a", role: "link", label: "B", href: "/b" }], "https://h/b": [] }, "https://h/a")
    expect(await CoDriveSession.withDefaults(fast).run(sid, () => false)).toBe("stopped")
  })
})
