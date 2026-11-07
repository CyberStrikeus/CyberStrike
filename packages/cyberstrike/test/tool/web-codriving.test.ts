import { describe, expect, test } from "bun:test"
import { WebGetPageStateTool } from "../../src/tool/web-get-page-state"
import { WebActionTool } from "../../src/tool/web-action"
import { PageState } from "../../src/session/web/page-state"
import { WebControl } from "../../src/session/web/control"
import { Crawl } from "../../src/session/web/crawl"
import { WebDriver } from "../../src/session/web/driver"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const ctxFor = (sessionID: string) => ({
  sessionID,
  messageID: "",
  callID: "",
  agent: "wstg-agent",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
})

// A fake extension socket that acks every command it is sent (success path), so
// WebControl.send resolves ok:true synchronously.
function ackingSocket() {
  return {
    send(data: string) {
      const msg = JSON.parse(data)
      WebControl.onAck(JSON.stringify({ id: msg.id, ok: true }))
    },
  }
}

async function withInstance(fn: (sid: string) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      PageState._reset()
      WebControl._reset()
      Crawl._reset()
      WebDriver._reset()
      const session = await Session.create({})
      await fn(session.id)
    },
  })
}

const richPage = (url: string): PageState.Observation => ({
  url,
  title: "Users",
  driver: "ai",
  credential: "admin",
  description: "User management table",
  location: ["Home", "Admin", "Users"],
  landmarks: [{ role: "navigation", label: "Primary" }],
  dynamic: true,
  clickables: [
    // destructive → confirm; cursor-discovered div, aria state, in a section
    { id: "E0", tag: "div", role: "button", label: "Delete User", href: "", why: "cursor,onclick", aria: { haspopup: "dialog" }, section: "Users table", in_viewport: true },
    { id: "E1", tag: "a", role: "link", label: "Home", href: "/home", why: "semantic", in_viewport: true },
    { id: "E2", tag: "button", role: "button", label: "Log out", href: "", why: "semantic", in_viewport: false },
    { id: "E3", tag: "button", role: "button", label: "Save changes", href: "", why: "semantic" }, // mutating → allow
  ],
  forms: [],
  links: [],
})

describe("web_get_page_state — the AI's eyes", () => {
  test("current() returns rich page context + kind/policy summary", async () => {
    await withInstance(async (sid) => {
      PageState.set(sid, { ...richPage("https://h/users"), observed_at: Date.now() })
      const tool = await WebGetPageStateTool.init()
      const res = await tool.execute({}, ctxFor(sid))
      const p = JSON.parse(res.output)
      expect(p.url).toBe("https://h/users")
      expect(p.credential).toBe("admin")
      expect(p.description).toBe("User management table")
      expect(p.location).toEqual(["Home", "Admin", "Users"])
      expect(p.dynamic).toBe(true)
      expect(p.summary.by_policy).toEqual({ confirm: 1, allow: 2, deny: 1 })
      const del = p.clickables.find((c: { id: string }) => c.id === "E0")
      expect(del.kind).toBe("destructive")
      expect(del.policy).toBe("confirm")
      expect(del.why).toBe("cursor,onclick")
      expect(del.aria).toEqual({ haspopup: "dialog" })
      const out = p.clickables.find((c: { id: string }) => c.id === "E2")
      expect(out.offscreen).toBe(true) // in_viewport:false surfaced as offscreen
    })
  })

  test("view filters to one kind", async () => {
    await withInstance(async (sid) => {
      PageState.set(sid, { ...richPage("https://h/users"), observed_at: Date.now() })
      const tool = await WebGetPageStateTool.init()
      const res = await tool.execute({ url: "https://h/users", view: "nav" }, ctxFor(sid))
      const p = JSON.parse(res.output)
      expect(p.clickables.map((c: { id: string }) => c.id)).toEqual(["E1"])
    })
  })

  test("no observation → guidance, not a crash", async () => {
    await withInstance(async (sid) => {
      const tool = await WebGetPageStateTool.init()
      const res = await tool.execute({}, ctxFor(sid))
      expect(res.title).toBe("No page state")
      expect(res.output).toContain("Attach a browser")
    })
  })
})

describe("web_action — the AI's hands (guard enforced)", () => {
  test("logout element is denied (never relayed)", async () => {
    await withInstance(async (sid) => {
      PageState.set(sid, { ...richPage("https://h/users"), observed_at: Date.now() })
      WebControl.connect(sid, ackingSocket())
      const tool = await WebActionTool.init()
      const res = await tool.execute({ op: "click", element_id: "E2" }, ctxFor(sid))
      expect(res.metadata.ok).toBe(false)
      expect(res.metadata.policy).toBe("deny")
      expect(res.title).toContain("BLOCKED")
    })
  })

  test("destructive element needs human confirmation (skipped)", async () => {
    await withInstance(async (sid) => {
      PageState.set(sid, { ...richPage("https://h/users"), observed_at: Date.now() })
      WebControl.connect(sid, ackingSocket())
      const tool = await WebActionTool.init()
      const res = await tool.execute({ op: "click", element_id: "E0" }, ctxFor(sid))
      expect(res.metadata.policy).toBe("confirm")
      expect(res.title).toContain("CONFIRMATION")
    })
  })

  test("allowed element with a connected browser is relayed + acked", async () => {
    await withInstance(async (sid) => {
      PageState.set(sid, { ...richPage("https://h/users"), observed_at: Date.now() })
      WebControl.connect(sid, ackingSocket())
      const tool = await WebActionTool.init()
      const res = await tool.execute({ op: "click", element_id: "E1" }, ctxFor(sid))
      expect(res.metadata.ok).toBe(true)
      expect(res.output).toContain("Home")
    })
  })

  test("no browser attached → clear message, no throw", async () => {
    await withInstance(async (sid) => {
      PageState.set(sid, { ...richPage("https://h/users"), observed_at: Date.now() })
      const tool = await WebActionTool.init()
      const res = await tool.execute({ op: "click", element_id: "E1" }, ctxFor(sid))
      expect(res.metadata.error).toBe("no-extension")
      expect(res.title).toBe("No browser attached")
    })
  })

  test("unknown element → re-read guidance", async () => {
    await withInstance(async (sid) => {
      PageState.set(sid, { ...richPage("https://h/users"), observed_at: Date.now() })
      WebControl.connect(sid, ackingSocket())
      const tool = await WebActionTool.init()
      const res = await tool.execute({ op: "click", element_id: "E9", url: "https://h/users" }, ctxFor(sid))
      expect(res.metadata.error).toBe("unknown-element")
    })
  })

  test("navigate requires a url", async () => {
    await withInstance(async (sid) => {
      WebControl.connect(sid, ackingSocket())
      const tool = await WebActionTool.init()
      const res = await tool.execute({ op: "navigate" }, ctxFor(sid))
      expect(res.metadata.ok).toBe(false)
      expect(res.title).toBe("url required")
    })
  })
})

describe("crawl loop — visited tracking + budget (Phase D)", () => {
  test("get_page_state marks the page visited and reports unvisited nav/query", async () => {
    await withInstance(async (sid) => {
      PageState.set(sid, { ...richPage("https://h/users"), observed_at: Date.now() })
      const tool = await WebGetPageStateTool.init()
      const p = JSON.parse((await tool.execute({}, ctxFor(sid))).output)
      // richPage has one nav (E1 Home, allow); destructive/logout/mutating don't count.
      expect(p.crawl.unvisited_nav_query).toBe(1)
      expect(p.crawl.pages_visited).toBe(1)
      expect(p.crawl.actions).toBe(0)
      expect(Crawl.isPageVisited(sid, "https://h/users")).toBe(true)
    })
  })

  test("after acting on a nav element it is marked visited and drops from the unvisited count", async () => {
    await withInstance(async (sid) => {
      PageState.set(sid, { ...richPage("https://h/users"), observed_at: Date.now() })
      WebControl.connect(sid, ackingSocket())
      const act = await WebActionTool.init()
      await act.execute({ op: "click", element_id: "E1" }, ctxFor(sid))
      const state = await WebGetPageStateTool.init()
      const p = JSON.parse((await state.execute({}, ctxFor(sid))).output)
      expect(p.crawl.actions).toBe(1)
      expect(p.crawl.unvisited_nav_query).toBe(0)
      const home = p.clickables.find((c: { id: string }) => c.id === "E1")
      expect(home.visited).toBe(true)
    })
  })

  test("budget is a HARD stop — over budget refuses to act", async () => {
    await withInstance(async (sid) => {
      PageState.set(sid, { ...richPage("https://h/users"), observed_at: Date.now() })
      WebControl.connect(sid, ackingSocket())
      Crawl.setBudget(sid, 1)
      const act = await WebActionTool.init()
      const first = await act.execute({ op: "click", element_id: "E1" }, ctxFor(sid))
      expect(first.metadata.ok).toBe(true) // 1/1
      const second = await act.execute({ op: "click", element_id: "E3" }, ctxFor(sid))
      expect(second.metadata.error).toBe("budget-exhausted")
      expect(second.title).toBe("Crawl budget exhausted")
    })
  })

  test("a repeated action is flagged as a possible cycle", async () => {
    await withInstance(async (sid) => {
      PageState.set(sid, { ...richPage("https://h/users"), observed_at: Date.now() })
      WebControl.connect(sid, ackingSocket())
      const act = await WebActionTool.init()
      await act.execute({ op: "click", element_id: "E1" }, ctxFor(sid))
      const again = await act.execute({ op: "click", element_id: "E1" }, ctxFor(sid))
      expect(again.metadata.ok).toBe(true)
      expect(again.metadata.repeat).toBe(true)
      expect(again.output).toContain("cycle")
    })
  })

  test("a guard-blocked action does NOT consume budget", async () => {
    await withInstance(async (sid) => {
      PageState.set(sid, { ...richPage("https://h/users"), observed_at: Date.now() })
      WebControl.connect(sid, ackingSocket())
      const act = await WebActionTool.init()
      await act.execute({ op: "click", element_id: "E2" }, ctxFor(sid)) // logout → deny
      await act.execute({ op: "click", element_id: "E0" }, ctxFor(sid)) // destructive → confirm
      expect(Crawl.summary(sid).actions).toBe(0)
    })
  })

  test("navigate records the destination as a visited page", async () => {
    await withInstance(async (sid) => {
      WebControl.connect(sid, ackingSocket())
      const act = await WebActionTool.init()
      const res = await act.execute({ op: "navigate", url: "https://h/next" }, ctxFor(sid))
      expect(res.metadata.ok).toBe(true)
      expect(Crawl.isPageVisited(sid, "https://h/next")).toBe(true)
      expect(Crawl.summary(sid).actions).toBe(1)
    })
  })
})

describe("driver interlock — AI must not act while a human drives (Phase E)", () => {
  test("human-driver mode blocks web_action before guard/budget", async () => {
    await withInstance(async (sid) => {
      PageState.set(sid, { ...richPage("https://h/users"), observed_at: Date.now() })
      WebControl.connect(sid, ackingSocket())
      WebDriver.set(sid, "human")
      const act = await WebActionTool.init()
      const res = await act.execute({ op: "click", element_id: "E1" }, ctxFor(sid))
      expect(res.metadata.error).toBe("human-driving")
      expect(res.title).toBe("Human is driving")
      expect(Crawl.summary(sid).actions).toBe(0) // blocked → no budget consumed
    })
  })

  test("AI-driver mode allows web_action", async () => {
    await withInstance(async (sid) => {
      PageState.set(sid, { ...richPage("https://h/users"), observed_at: Date.now() })
      WebControl.connect(sid, ackingSocket())
      WebDriver.set(sid, "ai")
      const act = await WebActionTool.init()
      const res = await act.execute({ op: "click", element_id: "E1" }, ctxFor(sid))
      expect(res.metadata.ok).toBe(true)
    })
  })

  test("unset driver is allowed (manual use / tests are not blocked)", async () => {
    await withInstance(async (sid) => {
      PageState.set(sid, { ...richPage("https://h/users"), observed_at: Date.now() })
      WebControl.connect(sid, ackingSocket())
      const act = await WebActionTool.init()
      const res = await act.execute({ op: "click", element_id: "E1" }, ctxFor(sid))
      expect(res.metadata.ok).toBe(true)
    })
  })
})
