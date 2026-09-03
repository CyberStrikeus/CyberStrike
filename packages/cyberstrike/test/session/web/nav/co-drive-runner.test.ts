import { beforeEach, describe, expect, test } from "bun:test"
import { CoDrive } from "../../../../src/session/web/nav/co-drive-runner"
import { CoDriveSession } from "../../../../src/session/web/nav/co-drive-session"
import { PageState } from "../../../../src/session/web/page-state"
import { WebControl } from "../../../../src/session/web/control"
import { WebDriver } from "../../../../src/session/web/driver"
import { Crawl } from "../../../../src/session/web/crawl"
import { WebScope } from "../../../../src/session/web/scope"
import { WebStrategy } from "../../../../src/session/web/strategy"
import { Effect } from "../../../../src/session/web/effect"

beforeEach(() => {
  CoDrive._reset()
  PageState._reset()
  WebControl._reset()
  WebDriver._reset()
  Crawl._reset()
  WebScope._reset()
  WebStrategy._reset()
  Effect._reset()
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitUntil(pred: () => boolean, ms = 4000) {
  const start = Date.now()
  while (!pred() && Date.now() - start < ms) await sleep(5)
}
// A stub session (cast — CoDriveSession has private fields) that runs until cancelled, so the
// runner's start/stop/generation machinery can be tested without any real navigation or model.
function stubSession(onRun: () => void): CoDriveSession {
  return {
    async run(_sid: string, alive: () => boolean) {
      onRun()
      while (alive()) await sleep(2)
      return "stopped" as const
    },
  } as unknown as CoDriveSession
}

type Click = PageState.Observation["clickables"][number]
function attachBrowser(sid: string) {
  let current = "https://h/a"
  let clock = 1
  const site: Record<string, Click[]> = { "https://h/a": [{ id: "E0", tag: "a", role: "link", label: "B", href: "/b" }], "https://h/b": [] }
  const observe = (url: string) => {
    current = url
    PageState.set(sid, { url, title: url, clickables: site[url] ?? [], forms: [], links: [], observed_at: ++clock })
  }
  WebControl.connect(sid, {
    send(data: string) {
      const m = JSON.parse(data)
      if (m.op === "click") {
        const el = (site[current] ?? []).find((c) => c.id === m.elementId)
        if (el) observe(new URL(el.href, current).href)
      }
      WebControl.onAck(JSON.stringify({ id: m.id, ok: true }))
    },
  })
  observe("https://h/a")
}

describe("CoDrive runner — lifecycle", () => {
  test("start runs the injected session to completion (real deterministic crawl)", async () => {
    const sid = "s"
    attachBrowser(sid)
    CoDrive.start(sid, CoDriveSession.withDefaults({ settleMs: 15, pollMs: 2, maxIdle: 3 }))
    expect(CoDrive.isRunning(sid)).toBe(true)
    await waitUntil(() => !CoDrive.isRunning(sid))
    expect(CoDrive.isRunning(sid)).toBe(false)
    expect(Crawl.isPageVisited(sid, "https://h/b")).toBe(true)
  })

  test("start is idempotent while a loop is running", async () => {
    const sid = "s"
    let runs = 0
    CoDrive.start(sid, stubSession(() => runs++))
    CoDrive.start(sid, stubSession(() => runs++)) // no-op — already running
    await sleep(20)
    expect(runs).toBe(1)
    expect(CoDrive.isRunning(sid)).toBe(true)
    CoDrive.stop(sid)
    await waitUntil(() => !CoDrive.isRunning(sid))
    expect(CoDrive.isRunning(sid)).toBe(false)
  })

  test("stop cancels a running loop", async () => {
    const sid = "s"
    CoDrive.start(sid, stubSession(() => {}))
    expect(CoDrive.isRunning(sid)).toBe(true)
    CoDrive.stop(sid)
    await waitUntil(() => !CoDrive.isRunning(sid))
    expect(CoDrive.isRunning(sid)).toBe(false)
  })

  test("stop + restart runs a fresh loop; the old generation never clears the new one", async () => {
    const sid = "s"
    let aRan = false
    let bRan = false
    CoDrive.start(sid, stubSession(() => (aRan = true)))
    await waitUntil(() => aRan)
    CoDrive.stop(sid) // gen A cancelled; its run() resolves and its finally must NOT wipe gen B
    CoDrive.start(sid, stubSession(() => (bRan = true)))
    await waitUntil(() => bRan)
    await sleep(20) // give gen A's finally time to (wrongly) fire
    expect(bRan).toBe(true)
    expect(CoDrive.isRunning(sid)).toBe(true) // B still running — not cleared by A's completion
    CoDrive.stop(sid)
    await waitUntil(() => !CoDrive.isRunning(sid))
  })
})
