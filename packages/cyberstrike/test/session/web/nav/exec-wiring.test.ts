import { beforeEach, describe, expect, test } from "bun:test"
import { WebAct } from "../../../../src/session/web/act"
import { WebActExecutor } from "../../../../src/session/web/nav/web-act-executor"
import { WebFormFill } from "../../../../src/session/web/formfill"
import { PageState } from "../../../../src/session/web/page-state"
import { WebControl } from "../../../../src/session/web/control"
import { WebDriver } from "../../../../src/session/web/driver"
import { Crawl } from "../../../../src/session/web/crawl"
import type { TechStack } from "../../../../src/session/web/tech"

beforeEach(() => {
  PageState._reset()
  WebControl._reset()
  WebDriver._reset()
  Crawl._reset()
})

type Click = PageState.Observation["clickables"][number]
type Form = PageState.Observation["forms"][number]
// A recording socket: captures every op the server relays and acks it ok.
function recSocket(sid: string): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = []
  WebControl.connect(sid, {
    send(data: string) {
      const m = JSON.parse(data)
      sent.push(m)
      WebControl.onAck(JSON.stringify({ id: m.id, ok: true }))
    },
  })
  return sent
}
function setPage(sid: string, url: string, clickables: Click[], tech?: TechStack, forms: Form[] = []) {
  PageState.set(sid, { url, title: url, clickables, forms, links: [], tech, observed_at: 1 })
}
const snap = (sid: string, url: string) => PageState.get(sid, url)!
const reactTech: TechStack = { client: ["React"], server: [], rendering: "spa", signals: [] }
const nextTech: TechStack = { client: ["React"], metaFramework: "Next.js", server: [], rendering: "spa", signals: [] }

describe("WebAct type — framework-adaptive mode (P5)", () => {
  test("a React page → the relayed type cmd carries mode=native-setter", async () => {
    const sid = "s"
    const sent = recSocket(sid)
    setPage(sid, "https://h/a", [{ id: "f1", tag: "input", role: "textbox", label: "Username", href: "" }], reactTech)
    const r = await WebAct.perform(sid, { op: "type", url: "https://h/a", elementId: "f1", text: "bob" })
    expect(r.ok).toBe(true)
    expect(sent.find((c) => c.op === "type")?.mode).toBe("native-setter")
  })

  test("a plain page (no tech) → mode=standard", async () => {
    const sid = "s"
    const sent = recSocket(sid)
    setPage(sid, "https://h/a", [{ id: "f1", tag: "input", role: "textbox", label: "Username", href: "" }])
    await WebAct.perform(sid, { op: "type", url: "https://h/a", elementId: "f1", text: "bob" })
    expect(sent.find((c) => c.op === "type")?.mode).toBe("standard")
  })
})

describe("WebActExecutor — WaitHydrated for meta-frameworks (P5)", () => {
  test("sends a wait:hydrated op before acting on a meta-framework page, once per page", async () => {
    const sid = "s"
    const sent = recSocket(sid)
    setPage(sid, "https://h/a", [{ id: "E0", tag: "a", role: "link", label: "B", href: "/b" }], nextTech)
    const ex = new WebActExecutor({ settleMs: 15, pollMs: 2, hydrateMs: 20 })

    await ex.run(sid, { kind: "click", elementId: "E0" }, snap(sid, "https://h/a"))
    const waits = sent.filter((c) => c.op === "wait" && c.until === "hydrated")
    expect(waits.length).toBe(1)
    // A second action on the SAME page url does not re-wait.
    sent.length = 0
    await ex.run(sid, { kind: "click", elementId: "E0" }, snap(sid, "https://h/a"))
    expect(sent.some((c) => c.op === "wait")).toBe(false)
  })

  test("does NOT wait on a plain page, and never waits before a navigate", async () => {
    const sid = "s"
    const sent = recSocket(sid)
    setPage(sid, "https://h/a", [{ id: "E0", tag: "a", role: "link", label: "B", href: "/b" }]) // no tech
    const ex = new WebActExecutor({ settleMs: 15, pollMs: 2 })
    await ex.run(sid, { kind: "click", elementId: "E0" }, snap(sid, "https://h/a"))
    expect(sent.some((c) => c.op === "wait")).toBe(false)

    // Even on a meta-framework page, navigate (loading a NEW page) is exempt from the wait.
    setPage(sid, "https://h/x", [], nextTech)
    sent.length = 0
    await ex.run(sid, { kind: "navigate", url: "https://h/y" }, snap(sid, "https://h/x"))
    expect(sent.some((c) => c.op === "wait")).toBe(false)
  })
})

describe("ViewState / CSRF preservation by construction (P5, §6.4)", () => {
  test("form fill never types into hidden postback tokens; submit is the real button", () => {
    const sid = "s"
    setPage(
      sid,
      "https://h/settings",
      [{ id: "sb", tag: "input", role: "button", label: "Save Settings", href: "" }],
      { client: [], server: ["ASP.NET WebForms"], rendering: "ssr", signals: [] },
      [
        {
          action: "/settings",
          method: "post",
          fields: [
            { id: "vs", name: "__VIEWSTATE", type: "hidden", required: false },
            { id: "ev", name: "__EVENTVALIDATION", type: "hidden", required: false },
            { id: "nick", name: "nickname", type: "text", required: false },
          ],
          submit_id: "sb",
        },
      ],
    )
    const cands = WebFormFill.candidates(sid, snap(sid, "https://h/settings"))
    expect(cands.length).toBe(1)
    // Hidden postback tokens are NOT typed into (they stay in the DOM and the native submit resends
    // them). Only the real text field is filled, and submit is the actual button element.
    const filledIds = cands[0].fills.map((f) => f.id)
    expect(filledIds).toContain("nick")
    expect(filledIds).not.toContain("vs")
    expect(filledIds).not.toContain("ev")
    expect(cands[0].submitId).toBe("sb")
  })
})
