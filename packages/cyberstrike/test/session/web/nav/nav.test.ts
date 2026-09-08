import { beforeEach, describe, expect, test } from "bun:test"
import { CoDriveSession } from "../../../../src/session/web/nav/co-drive-session"
import { DeterministicNavigator } from "../../../../src/session/web/nav/deterministic-navigator"
import { WebActExecutor } from "../../../../src/session/web/nav/web-act-executor"
import { Guardrails, PageStateObserver } from "../../../../src/session/web/nav/guardrails"
import { snapshotSignature } from "../../../../src/session/web/nav/types"
import type { Navigator, Observer, Executor, Action, ActionResult, PageSnapshot } from "../../../../src/session/web/nav/types"
import { PageState } from "../../../../src/session/web/page-state"
import { WebControl } from "../../../../src/session/web/control"
import { WebAct } from "../../../../src/session/web/act"
import { WebDriver } from "../../../../src/session/web/driver"
import { Crawl } from "../../../../src/session/web/crawl"
import { WebScope } from "../../../../src/session/web/scope"
import { WebStrategy } from "../../../../src/session/web/strategy"
import { Effect } from "../../../../src/session/web/effect"
import { WebHold } from "../../../../src/session/web/hold"

beforeEach(() => {
  PageState._reset()
  WebControl._reset()
  WebDriver._reset()
  Crawl._reset()
  WebScope._reset()
  WebStrategy._reset()
  Effect._reset()
  WebHold._reset()
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

describe("CoDriveSession — a multi-step input plan runs to completion", () => {
  test("[type, type, click] all execute — a type's 'revealed' effect does NOT abort the plan", async () => {
    const sid = "s"
    WebControl.connect(sid, { send: () => {} }) // guardrails: something is connected
    WebScope.ensure(sid, "https://h/login")
    PageState.set(sid, {
      url: "https://h/login",
      title: "",
      clickables: [
        { id: "email", tag: "input", role: "textbox", label: "Email", href: "" },
        { id: "pw", tag: "input", role: "", label: "Password", href: "" },
        { id: "go", tag: "button", role: "", label: "Sign in", href: "" },
      ],
      forms: [],
      links: [],
      observed_at: 1,
    })

    const recorded: string[] = []
    let planCall = 0
    const navigator: Navigator = {
      async plan(): Promise<{ rationale: string; actions: Action[] }> {
        planCall++
        if (planCall === 1)
          return {
            rationale: "login",
            actions: [
              { kind: "type", elementId: "email", text: "u@x.test", label: "Email" },
              { kind: "type", elementId: "pw", text: "pw", label: "Password" },
              { kind: "click", elementId: "go", label: "Sign in" },
            ],
          }
        return { rationale: "done", actions: [{ kind: "done", reason: "explored" }] }
      },
    }
    const observer: Observer = { observe: () => PageState.get(sid, "https://h/login") as PageSnapshot }
    const executor: Executor = {
      async run(_sid: string, action: Action): Promise<ActionResult> {
        recorded.push(`${action.kind}:${"elementId" in action ? action.elementId : ""}`)
        // Typing mutates the DOM → "revealed" (the exact effect that used to abort the plan and make
        // the crawler re-type the first field forever). The submit click navigates.
        return { ok: true, status: "ok", effect: action.kind === "click" ? "navigated" : "revealed" }
      },
    }
    const session = new CoDriveSession({ observer, navigator, executor, guardrails: new Guardrails() }, { pollMs: 1, maxIdle: 3 })
    await session.run(sid)
    expect(recorded).toEqual(["type:email", "type:pw", "click:go"])
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

  test("held → the loop waits without acting; releasing it resumes the crawl", async () => {
    const sid = "s"
    browser(sid, { "https://h/a": [{ id: "E0", tag: "a", role: "link", label: "B", href: "/b" }], "https://h/b": [] }, "https://h/a")
    WebHold.set(sid, true) // user is engaging the panel → pause
    let ticks = 0
    // Hold for the first 5 iterations (no action taken), then release → the crawl completes.
    const reason = await CoDriveSession.withDefaults(fast).run(sid, () => {
      if (++ticks === 5) {
        expect(Crawl.summary(sid).actions).toBe(0) // nothing acted while held
        WebHold.set(sid, false)
      }
      return true
    })
    expect(reason).toBe("coverage-complete")
    expect(Crawl.isPageVisited(sid, "https://h/b")).toBe(true)
  })

  test("a cancel signal (driver flipped) ends the loop between steps", async () => {
    const sid = "s"
    browser(sid, { "https://h/a": [{ id: "E0", tag: "a", role: "link", label: "B", href: "/b" }], "https://h/b": [] }, "https://h/a")
    expect(await CoDriveSession.withDefaults(fast).run(sid, () => false)).toBe("stopped")
  })
})

describe("CoDriveSession.run — LLM 'done' must not drop the frontier (regression)", () => {
  test("a navigator that always says done still backtracks to discovered-but-unvisited pages", async () => {
    const sid = "done-frontier"
    // /a links to /b; both in scope. The navigator ALWAYS returns a `done` action — the LLM
    // judging the app "fully explored". Before the fix, `done` broke immediately and /b (in the
    // frontier, discovered but never visited) was silently dropped. Now `done` drains the frontier.
    browser(
      sid,
      { "https://h/a": [{ id: "E0", tag: "a", role: "link", label: "B", href: "/b" }], "https://h/b": [] },
      "https://h/a",
    )
    WebScope.ensure(sid, "https://h/a") // so /b is in-scope and enters the frontier
    const alwaysDone: Navigator = {
      async plan() {
        return { rationale: "looks fully explored", actions: [{ kind: "done", reason: "explored" }] }
      },
    }
    const session = new CoDriveSession(
      {
        observer: new PageStateObserver(),
        navigator: alwaysDone,
        executor: new WebActExecutor({ settleMs: 15, pollMs: 2 }),
        guardrails: new Guardrails(),
      },
      { pollMs: 2, maxIdle: 3 },
    )
    const reason = await session.run(sid)
    expect(reason).toBe("coverage-complete")
    // The fix: /b was discovered (frontier) but unvisited when "done" fired — it must be visited.
    expect(Crawl.isPageVisited(sid, "https://h/b")).toBe(true)
  })
})

describe("CoDriveSession.run — revisit-on-nav-away covers every SPA list row (list→detail→back→next)", () => {
  test("clicking row1 client-routes to its detail page; the loop returns to the list and clicks row2", async () => {
    const sid = "spa"
    const list = "https://h/modules"
    WebControl.connect(sid, { send: () => {} }) // guardrails: something connected
    WebScope.ensure(sid, list)
    // Two list rows with NO href — they client-route via JS (the case the frontier can't seed).
    const rows: Click[] = [
      { id: "r1", tag: "div", role: "button", label: "Row 1", href: "" },
      { id: "r2", tag: "div", role: "button", label: "Row 2", href: "" },
    ]
    const detailFor: Record<string, string> = { r1: "https://h/modules/1", r2: "https://h/modules/2" }
    let url = list

    const observer: Observer = {
      observe: () =>
        ({
          url,
          title: url,
          clickables: url === list ? rows : [], // detail pages are dead-ends here
          forms: [],
          links: [],
          observed_at: Date.now(),
        }) as PageSnapshot,
    }
    // Exhaustive-style: plan every row not yet acted; a detail page has nothing to do.
    const navigator: Navigator = {
      async plan(_sid: string, snap: PageSnapshot): Promise<{ rationale: string; actions: Action[] }> {
        if (snap.url !== list) return { rationale: "detail dead-end", actions: [] }
        const actions = rows
          .filter((r) => !Crawl.isActed(sid, Crawl.actionKey(list, r)))
          .map((r) => ({ kind: "click", elementId: r.id, label: r.label }) as Action)
        return { rationale: "exercise rows", actions }
      },
    }
    const clicked: string[] = []
    const executor: Executor = {
      async run(_sid: string, action: Action): Promise<ActionResult> {
        if (action.kind === "navigate") {
          url = action.url // backtrack to the list
          return { ok: true, status: "ok", effect: "navigated" }
        }
        if (action.kind === "click" && "elementId" in action) {
          clicked.push(action.elementId)
          const row = rows.find((r) => r.id === action.elementId)!
          Crawl.record(sid, Crawl.actionKey(list, row)) // mimic WebAct's acted-tracking
          url = detailFor[action.elementId] // the click client-routes to the detail page
          return { ok: true, status: "ok", effect: "navigated" }
        }
        return { ok: true, status: "ok", effect: "noop" }
      },
    }
    const session = new CoDriveSession({ observer, navigator, executor, guardrails: new Guardrails() }, { pollMs: 1, maxIdle: 3 }, true)
    const reason = await session.run(sid)
    // Without the revisit queue the crawl clicks r1, routes to its detail page, and never returns —
    // r2's detail endpoints are never captured. With it, BOTH rows are exercised.
    expect(clicked).toEqual(["r1", "r2"])
    expect(reason).toBe("coverage-complete")
  })

  test("revisitOnNavAway=false (LLM default): a mid-plan route does NOT re-queue the origin page", async () => {
    const sid = "norevisit"
    const list = "https://h/modules"
    WebControl.connect(sid, { send: () => {} })
    WebScope.ensure(sid, list)
    const rows: Click[] = [
      { id: "r1", tag: "div", role: "button", label: "Row 1", href: "" },
      { id: "r2", tag: "div", role: "button", label: "Row 2", href: "" },
    ]
    let url = list
    const observer: Observer = {
      observe: () =>
        ({ url, title: url, clickables: url === list ? rows : [], forms: [], links: [], observed_at: Date.now() }) as PageSnapshot,
    }
    const navigator: Navigator = {
      async plan(_sid: string, snap: PageSnapshot): Promise<{ rationale: string; actions: Action[] }> {
        if (snap.url !== list) return { rationale: "dead-end", actions: [] }
        const actions = rows
          .filter((r) => !Crawl.isActed(sid, Crawl.actionKey(list, r)))
          .map((r) => ({ kind: "click", elementId: r.id, label: r.label }) as Action)
        return { rationale: "rows", actions }
      },
    }
    const clicked: string[] = []
    const executor: Executor = {
      async run(_sid: string, action: Action): Promise<ActionResult> {
        if (action.kind === "click" && "elementId" in action) {
          clicked.push(action.elementId)
          Crawl.record(sid, Crawl.actionKey(list, rows.find((r) => r.id === action.elementId)!))
          url = "https://h/modules/1"
          return { ok: true, status: "ok", effect: "navigated" }
        }
        return { ok: true, status: "ok", effect: "noop" }
      },
    }
    // Third arg omitted → revisitOnNavAway defaults false (the production LLM brain's behavior).
    const session = new CoDriveSession({ observer, navigator, executor, guardrails: new Guardrails() }, { pollMs: 1, maxIdle: 3 })
    await session.run(sid)
    expect(clicked).toEqual(["r1"]) // routed away after r1; NOT re-queued, so r2 is never reached
  })
})

describe("WebAct.perform — aggressive gate (exhaustive crawl clicks destructive; logout still denied)", () => {
  test("confirm-policy (destructive) is blocked by default, allowed with aggressive; deny (logout) always blocked", async () => {
    const sid = "s"
    let sent = 0
    WebControl.connect(sid, {
      send(data: string) {
        const m = JSON.parse(data)
        if (m.op === "click") sent++
        WebControl.onAck(JSON.stringify({ id: m.id, ok: true }))
      },
    })
    WebScope.ensure(sid, "https://h/")
    PageState.set(sid, {
      url: "https://h/",
      title: "",
      clickables: [
        { id: "del", tag: "button", role: "", label: "Delete account", href: "" }, // destructive → confirm
        { id: "lo", tag: "a", role: "link", label: "Log out", href: "/logout" }, // logout → deny
      ],
      forms: [],
      links: [],
      observed_at: 1,
    })
    // default: destructive needs confirmation → blocked
    expect((await WebAct.perform(sid, { op: "click", url: "https://h/", elementId: "del" })).status).toBe("confirm")
    // aggressive: destructive goes through
    expect((await WebAct.perform(sid, { op: "click", url: "https://h/", elementId: "del", aggressive: true })).ok).toBe(true)
    // logout is denied even with aggressive
    expect((await WebAct.perform(sid, { op: "click", url: "https://h/", elementId: "lo", aggressive: true })).status).toBe("denied")
  })
})
