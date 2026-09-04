import { beforeEach, describe, expect, test } from "bun:test"
import { LlmNavigator, clickPool, buildContext, mapActions } from "../../../../src/session/web/nav/llm-navigator"
import { PageState } from "../../../../src/session/web/page-state"
import { WebFormFill } from "../../../../src/session/web/formfill"
import { Crawl } from "../../../../src/session/web/crawl"
import { WebScope } from "../../../../src/session/web/scope"
import { WebStrategy } from "../../../../src/session/web/strategy"
import { Effect } from "../../../../src/session/web/effect"
import { DataCollector } from "../../../../src/session/web/data-collector"
import { JsMiner } from "../../../../src/session/web/js-miner"

beforeEach(() => {
  PageState._reset()
  Crawl._reset()
  WebScope._reset()
  WebStrategy._reset()
  Effect._reset()
  DataCollector._reset()
  JsMiner._reset()
})

type Click = PageState.Observation["clickables"][number]
type Form = PageState.Observation["forms"][number]
function page(sid: string, url: string, clickables: Click[], forms: Form[] = [], links: string[] = []): PageState.StatePayload {
  PageState.set(sid, { url, title: url, clickables, forms, links, observed_at: 1 })
  return PageState.get(sid, url)!
}
// Seed the strategy cache with a stub so LlmNavigator.plan's background WebStrategy.ensure sees a
// fresh plan for this host and never fires a live main-model call (keeps plan() tests hermetic).
const seedStrategy = (sid: string, snap: PageState.StatePayload, priorities: string[] = []) =>
  WebStrategy.ensure(sid, snap, async () => ({ purpose: "", priorities }))

describe("clickPool — the safe, actionable universe the model chooses from", () => {
  test("includes allow links + script widgets; excludes logout/destructive/disabled/out-of-scope/acted", () => {
    const sid = "s"
    WebScope.ensure(sid, "https://app.example.com/")
    const snap = page(sid, "https://app.example.com/", [
      { id: "n1", tag: "a", role: "link", label: "Accounts", href: "/accounts" }, // nav → allow
      { id: "o1", tag: "div", role: "button", label: "Open menu", href: "", why: "role" }, // other widget → allow
      { id: "lo", tag: "a", role: "link", label: "Log out", href: "/logout" }, // logout → deny
      { id: "del", tag: "button", role: "", label: "Delete account", href: "" }, // destructive → confirm
      { id: "dis", tag: "a", role: "link", label: "Later", href: "/later", disabled: true }, // disabled
      { id: "ext", tag: "a", role: "link", label: "GitHub", href: "https://github.com/x/y" }, // out of scope
    ])
    // Mark n1 already acted → excluded as frontier.
    const acted = Crawl.actionKey("https://app.example.com/", { role: "link", label: "Accounts", href: "/accounts" })
    Crawl.record(sid, acted)

    const ids = clickPool(sid, snap).map((p) => p.id)
    expect(ids).toContain("o1")
    expect(ids).not.toContain("n1") // acted
    expect(ids).not.toContain("lo") // deny
    expect(ids).not.toContain("del") // confirm
    expect(ids).not.toContain("dis") // disabled
    expect(ids).not.toContain("ext") // out of scope
  })

  test("orders unvisited targets before visited ones", () => {
    const sid = "s"
    WebScope.ensure(sid, "https://app.example.com/")
    Crawl.markPage(sid, "https://app.example.com/seen")
    const snap = page(sid, "https://app.example.com/", [
      { id: "v", tag: "a", role: "link", label: "Seen", href: "/seen" },
      { id: "u", tag: "a", role: "link", label: "Fresh", href: "/fresh" },
    ])
    expect(clickPool(sid, snap).map((p) => p.id)).toEqual(["u", "v"])
  })
})

describe("mapActions — validate raw model output against the live snapshot", () => {
  test("keeps known clicks, dedupes, drops unknown ids, and `done` terminates the plan", () => {
    const sid = "s"
    WebScope.ensure(sid, "https://h.test/")
    const snap = page(sid, "https://h.test/", [
      { id: "n1", tag: "a", role: "link", label: "A", href: "/a1" },
      { id: "n2", tag: "a", role: "link", label: "B", href: "/b1" },
    ])
    const picks = clickPool(sid, snap)
    const actions = mapActions(
      sid,
      snap,
      [
        { kind: "click", element_id: "n1" },
        { kind: "click", element_id: "n1" }, // duplicate → dropped
        { kind: "click", element_id: "ghost" }, // unknown → dropped
        { kind: "done" },
        { kind: "click", element_id: "n2" }, // after done → ignored
      ],
      picks,
      [],
    )
    expect(actions).toEqual([
      { kind: "click", elementId: "n1", label: "A" },
      { kind: "done", reason: "explored" },
    ])
  })

  test("navigate is accepted only for an in-scope url present on the page", () => {
    const sid = "s"
    WebScope.ensure(sid, "https://demo.testfire.net/")
    const links = ["https://demo.testfire.net/app", "https://github.com/x/y"]
    const snap = page(sid, "https://demo.testfire.net/", [], [], links)
    const actions = mapActions(
      sid,
      snap,
      [
        { kind: "navigate", url: "/app" }, // in scope + known → kept (resolved)
        { kind: "navigate", url: "https://github.com/x/y" }, // known but out of scope → dropped
        { kind: "navigate", url: "https://demo.testfire.net/unknown" }, // in scope but not on page → dropped
      ],
      [],
      [],
    )
    expect(actions).toEqual([{ kind: "navigate", url: "https://demo.testfire.net/app" }])
  })

  test("form is accepted by in-range index; out-of-range dropped", () => {
    const sid = "s"
    const snap = page(
      sid,
      "https://h.test/",
      [{ id: "sb", tag: "button", role: "", label: "Search", href: "" }],
      [{ action: "/search", method: "get", fields: [{ id: "q", name: "q", type: "text", required: false }], submit_id: "sb" }],
    )
    const forms = WebFormFill.candidates(sid, snap)
    expect(forms.length).toBe(1)
    const actions = mapActions(sid, snap, [{ kind: "form", form_index: 0 }, { kind: "form", form_index: 9 }], [], forms)
    expect(actions).toEqual([{ kind: "form", form: forms[0] }])
  })
})

describe("buildContext — the rich model prompt", () => {
  test("surfaces tech, focus areas, forms and elements", async () => {
    const sid = "s"
    const snap = page(
      sid,
      "https://h.test/",
      [
        { id: "sb", tag: "button", role: "", label: "Search", href: "" },
        { id: "n1", tag: "a", role: "link", label: "Accounts", href: "/accounts" },
      ],
      [{ action: "/search", method: "get", fields: [{ id: "q", name: "q", type: "text", required: false }], submit_id: "sb" }],
    )
    snap.tech = { client: ["React"], server: [], rendering: "spa", signals: [] }
    await seedStrategy(sid, snap, ["accounts"])
    // Traffic collected for this session feeds routes + server-side tech into the prompt.
    DataCollector.record(sid, { method: "GET", origin: "https://h.test", path: "/admin", contentType: "text/html" })
    DataCollector.record(sid, { method: "POST", origin: "https://h.test", path: "/api/transfer", contentType: "application/json" })
    DataCollector.record(sid, { method: "GET", origin: "https://h.test", path: "/", headers: { "x-powered-by": "PHP/8.2.0" } })
    DataCollector.addMined(sid, [{ method: "GET", url: "https://h.test/api/secret-route" }]) // P4.1 JS-mined
    const picks = clickPool(sid, snap)
    const forms = WebFormFill.candidates(sid, snap)
    const ctx = buildContext(sid, snap, picks, forms, DataCollector.latest(sid))
    expect(ctx).toContain("Tech:")
    expect(ctx).toContain("React") // client fingerprint
    expect(ctx).toContain("PHP") // merged server fingerprint (P2 seam)
    expect(ctx).toContain("Focus areas")
    expect(ctx).toContain("already captured") // reframed as context, not a click target
    expect(ctx).toContain("/admin") // the discovered UI route still appears
    expect(ctx).toContain("/api/transfer") // API surface still listed as context
    expect(ctx).toContain("/api/secret-route") // P4.1 JS-mined route as context
    expect(ctx).toContain("Forms (choose by form_index)")
    expect(ctx).toContain("Interactive elements")
    expect(ctx).toContain("n1")
  })
})

describe("LlmNavigator.plan — model plan + fallback", () => {
  test("maps a valid model plan into a typed Plan", async () => {
    const sid = "s"
    WebScope.ensure(sid, "https://h.test/")
    const snap = page(sid, "https://h.test/", [{ id: "n1", tag: "a", role: "link", label: "A", href: "/a1" }])
    await seedStrategy(sid, snap)
    const nav = new LlmNavigator(async () => ({ rationale: "go to A", actions: [{ kind: "click", element_id: "n1" }] }))
    const plan = await nav.plan(sid, snap)
    expect(plan.rationale).toBe("go to A")
    expect(plan.actions).toEqual([{ kind: "click", elementId: "n1", label: "A" }])
  })

  test("falls back to the deterministic pick when the model returns nothing usable", async () => {
    const sid = "s"
    WebScope.ensure(sid, "https://h.test/")
    const snap = page(sid, "https://h.test/", [{ id: "n1", tag: "a", role: "link", label: "Home", href: "/home" }])
    await seedStrategy(sid, snap)
    // null, a throw, and an all-invalid plan must all degrade to the deterministic top pick.
    for (const ask of [
      async () => null,
      async () => {
        throw new Error("provider down")
      },
      async () => ({ actions: [{ kind: "click" as const, element_id: "does-not-exist" }] }),
    ]) {
      Crawl._reset()
      const plan = await new LlmNavigator(ask).plan(sid, snap)
      expect(plan.actions).toEqual([{ kind: "click", elementId: "n1", label: "Home" }])
    }
  })

  test("a hanging model call times out → deterministic fallback (loop never freezes)", async () => {
    const sid = "s"
    WebScope.ensure(sid, "https://h.test/")
    const snap = page(sid, "https://h.test/", [{ id: "n1", tag: "a", role: "link", label: "Home", href: "/home" }])
    await seedStrategy(sid, snap)
    const hang: LlmNavigator.Ask = () => new Promise(() => {}) // never settles
    const nav = new LlmNavigator(hang, 60, 25) // 25ms timeout
    const start = Date.now()
    const plan = await nav.plan(sid, snap)
    expect(Date.now() - start).toBeLessThan(1000) // did not hang
    expect(plan.actions).toEqual([{ kind: "click", elementId: "n1", label: "Home" }]) // deterministic
  })

  test("returns an empty plan (never calls the model) when nothing is actionable", async () => {
    const sid = "s"
    WebScope.ensure(sid, "https://h.test/")
    const snap = page(sid, "https://h.test/", [{ id: "lo", tag: "a", role: "link", label: "Log out", href: "/logout" }])
    await seedStrategy(sid, snap)
    let called = false
    const nav = new LlmNavigator(async () => {
      called = true
      return null
    })
    const plan = await nav.plan(sid, snap)
    expect(plan.actions).toEqual([])
    expect(called).toBe(false)
  })
})
