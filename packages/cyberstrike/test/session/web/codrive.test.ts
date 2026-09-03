import { beforeEach, describe, expect, test } from "bun:test"
import { WebCoDrive } from "../../../src/session/web/codrive"
import { PageState } from "../../../src/session/web/page-state"
import { WebControl } from "../../../src/session/web/control"
import { WebDriver } from "../../../src/session/web/driver"
import { Crawl } from "../../../src/session/web/crawl"
import { Rank } from "../../../src/session/web/rank"

beforeEach(() => {
  PageState._reset()
  WebControl._reset()
  WebDriver._reset()
  Crawl._reset()
  WebCoDrive._reset()
})

type Click = { id: string; tag: string; role: string; label: string; href: string }
// A scripted site + a fake extension socket. Clicking a link (or navigating) moves the
// "browser" to the target page and re-observes it, exactly like the real extension would.
function browser(sid: string, site: Record<string, Click[]>, startUrl: string, visitLog?: string[]) {
  let current = startUrl
  let clock = 1
  const observe = (url: string) => {
    current = url
    visitLog?.push(url)
    PageState.set(sid, { url, title: url, clickables: site[url] ?? [], forms: [], links: [], observed_at: ++clock })
  }
  const socket = {
    send(data: string) {
      const msg = JSON.parse(data)
      if (msg.op === "navigate" && msg.url) observe(msg.url)
      else if (msg.op === "click") {
        const el = (site[current] ?? []).find((c) => c.id === msg.elementId)
        if (el && el.href) observe(new URL(el.href, current).href)
      }
      WebControl.onAck(JSON.stringify({ id: msg.id, ok: true }))
    },
  }
  WebControl.connect(sid, socket)
  observe(startUrl)
}

// Deterministic + fast: no LLM planner, no main-model strategist, no human delays/jitter.
const fast = {
  planner: WebCoDrive.DeterministicPlanner,
  strategist: async () => [] as string[],
  pollMs: 2,
  settleMs: 15,
  maxIdle: 3,
  humanize: false,
}
async function untilStopped(sid: string, timeoutMs = 3000) {
  const start = Date.now()
  while (WebCoDrive.isRunning(sid) && Date.now() - start < timeoutMs) await new Promise((r) => setTimeout(r, 3))
  if (WebCoDrive.isRunning(sid)) {
    WebCoDrive.stop(sid)
    throw new Error("loop did not terminate")
  }
}

describe("WebCoDrive loop", () => {
  test("crawls a small site to full coverage (dead-ends backtrack via the frontier)", async () => {
    const sid = "s"
    const B = "https://h/b"
    const C = "https://h/c"
    browser(sid, {
      "https://h/a": [
        { id: "E0", tag: "a", role: "link", label: "B", href: "/b" },
        { id: "E1", tag: "a", role: "link", label: "C", href: "/c" },
      ],
      "https://h/b": [], // leaf
      "https://h/c": [], // leaf
    }, "https://h/a")

    WebCoDrive.start(sid, fast)
    await untilStopped(sid)

    // A reached B by clicking, then C via the frontier (A's other discovered target).
    expect(Crawl.isPageVisited(sid, "https://h/a")).toBe(true)
    expect(Crawl.isPageVisited(sid, B)).toBe(true)
    expect(Crawl.isPageVisited(sid, C)).toBe(true)
    expect(Crawl.summary(sid).actions).toBeGreaterThanOrEqual(2)
    expect(WebCoDrive.isRunning(sid)).toBe(false)
  })

  test("budget is a hard cap on the loop", async () => {
    const sid = "s"
    // A big fan-out so it would run long without a cap.
    const links = Array.from({ length: 20 }, (_, i) => ({ id: `E${i}`, tag: "a", role: "link", label: `P${i}`, href: `/p${i}` }))
    const site: Record<string, Click[]> = { "https://h/a": links }
    for (let i = 0; i < 20; i++) site[`https://h/p${i}`] = []
    browser(sid, site, "https://h/a")
    Crawl.setBudget(sid, 3)

    WebCoDrive.start(sid, fast)
    await untilStopped(sid)
    expect(Crawl.summary(sid).actions).toBe(3)
  })

  test("human-driver mode never lets the loop act", async () => {
    const sid = "s"
    browser(sid, { "https://h/a": [{ id: "E0", tag: "a", role: "link", label: "B", href: "/b" }], "https://h/b": [] }, "https://h/a")
    WebDriver.set(sid, "human")
    WebCoDrive.start(sid, fast)
    await untilStopped(sid)
    expect(Crawl.summary(sid).actions).toBe(0)
  })

  test("no browser attached → the loop stops without acting", async () => {
    const sid = "s"
    // No WebControl.connect → not connected.
    WebCoDrive.start(sid, fast)
    await untilStopped(sid)
    expect(Crawl.summary(sid).actions).toBe(0)
    expect(WebCoDrive.isRunning(sid)).toBe(false)
  })

  test("LlmPlanner falls back to the deterministic top pick when no model resolves", async () => {
    // No provider/model is configured in the test env, so the model call fails — the planner
    // must NOT throw and must return the top-ranked candidate so the crawl keeps moving.
    const sid = "s"
    PageState.set(sid, {
      url: "https://h/a",
      title: "",
      clickables: [
        { id: "E0", tag: "a", role: "link", label: "B", href: "/b" },
        { id: "E1", tag: "a", role: "link", label: "C", href: "/c" },
      ],
      forms: [],
      links: [],
      observed_at: Date.now(),
    })
    const state = PageState.get(sid, "https://h/a")!
    const candidates = Rank.candidates(sid, state)
    const chosen = await WebCoDrive.LlmPlanner.choose({ sessionID: sid, state, candidates })
    expect(chosen).not.toBeNull()
    expect(chosen!.id).toBe(candidates[0].id)
  })

  test("main-model strategy priorities steer which area is explored first", async () => {
    const sid = "s"
    const log: string[] = []
    browser(sid, {
      "https://h/a": [
        { id: "E0", tag: "a", role: "link", label: "Reports", href: "/r" },
        { id: "E1", tag: "a", role: "link", label: "Admin Panel", href: "/admin" },
      ],
      "https://h/r": [],
      "https://h/admin": [],
    }, "https://h/a", log)

    // Strategist (stands in for the main model) prioritizes "admin".
    WebCoDrive.start(sid, { ...fast, strategist: async () => ["admin"] })
    await untilStopped(sid)

    // First navigation is the start page; the first CLICK target must be the admin area.
    const firstClick = log.find((u) => u !== "https://h/a")
    expect(firstClick).toBe("https://h/admin")
  })

  test("humanized driving still reaches full coverage (jitter changes order, not completeness)", async () => {
    const sid = "s"
    browser(sid, {
      "https://h/a": [
        { id: "E0", tag: "a", role: "link", label: "One", href: "/1" },
        { id: "E1", tag: "a", role: "link", label: "Two", href: "/2" },
        { id: "E2", tag: "a", role: "link", label: "Three", href: "/3" },
      ],
      "https://h/1": [],
      "https://h/2": [],
      "https://h/3": [],
    }, "https://h/a")

    // humanize on, but delays 0 and a fixed rng so the test is deterministic + fast.
    WebCoDrive.start(sid, {
      planner: WebCoDrive.DeterministicPlanner,
      strategist: async () => [],
      pollMs: 2,
      settleMs: 15,
      maxIdle: 3,
      humanize: true,
      thinkMinMs: 0,
      thinkMaxMs: 0,
      jitterBand: 5,
      rng: () => 0.99,
    })
    await untilStopped(sid)
    for (const u of ["https://h/1", "https://h/2", "https://h/3"]) expect(Crawl.isPageVisited(sid, u)).toBe(true)
  })

  test("start is idempotent (a second start does not stack a loop)", async () => {
    const sid = "s"
    browser(sid, { "https://h/a": [{ id: "E0", tag: "a", role: "link", label: "B", href: "/b" }], "https://h/b": [] }, "https://h/a")
    WebCoDrive.start(sid, fast)
    WebCoDrive.start(sid, fast) // ignored while running
    await untilStopped(sid)
    // E0 clicked once; frontier had only /b (now visited) → coverage. Exactly one click.
    expect(Crawl.summary(sid).actions).toBe(1)
  })
})
