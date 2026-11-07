// Auto-triage runner (#41). Verifies the logic that gates lifecycle completion — without a live LLM the
// actual agent dispatch is stubbed. The critical properties: triage runs only when un-reviewed drafts
// exist, is `active` while running (so the lifecycle waits), reviews each draft ONCE (a finding it left
// as draft is never re-triaged → no loop), and a NEW draft gets a fresh pass.
import { describe, test, expect } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Vulnerability } from "../../src/session/vulnerability"
import { Request } from "../../src/session/request"
import { normalizeStatus, VulnStatus } from "../../src/session/vulnerability-status"
import { TriageRunner } from "../../src/inspection/triage"
import { InspectionQueue } from "../../src/inspection/queue"
import { InspectionDispatcher } from "../../src/inspection/dispatcher"
import { SessionLifecycle } from "../../src/inspection/lifecycle"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

function run(fn: (sessionID: string) => void | Promise<void>) {
  return Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const session = await Session.create({})
      try {
        await fn(session.id)
      } finally {
        await Session.remove(session.id)
      }
    },
  })
}

// Stubs the agent dispatch: records which draft ids each pass received, and holds until released so the
// `active` window is observable.
class TestTriage extends TriageRunner {
  readonly passes: string[][] = []
  private gate: (() => void) | null = null
  protected override async run(drafts: Vulnerability.Info[]): Promise<void> {
    this.passes.push(drafts.map((d) => d.id!))
    await new Promise<void>((r) => {
      this.gate = r
    })
  }
  release(): void {
    const g = this.gate
    this.gate = null
    g?.()
  }
}

const addDraft = (sid: string, title: string) =>
  Vulnerability.add({ sessionID: sid, data: { severity: "high", title, description: `desc ${title}` } })

describe("TriageRunner (#41)", () => {
  test("no drafts → no triage pass, stays inactive", () =>
    run((sid) => {
      const t = new TestTriage(sid)
      t.wake()
      expect(t.active).toBe(false)
      expect(t.passes).toEqual([])
    }))

  test("CODE-ENFORCED: no finding left in draft after a pass, even when the agent triages nothing", () =>
    run(async (sid) => {
      const a = addDraft(sid, "A")
      const b = addDraft(sid, "B")
      const t = new TestTriage(sid)

      t.wake()
      expect(t.active).toBe(true) // in flight → lifecycle would wait
      expect(t.passes).toEqual([[a.id, b.id]])

      t.release()
      await Bun.sleep(5) // let run + finalize + re-arm run

      // The stub agent changed nothing, but the deterministic finalize promoted both OUT of draft.
      const statuses = Vulnerability.get(sid).map((v) => normalizeStatus(v.status ?? VulnStatus.DRAFT))
      expect(statuses.filter((s) => s === VulnStatus.DRAFT)).toEqual([]) // NO finding left in draft
      expect(statuses.filter((s) => s === VulnStatus.TRIAGED).length).toBe(2) // promoted, never rejected

      // Nothing left in draft → waking again does no work (no loop).
      t.wake()
      expect(t.passes.length).toBe(1)
      expect(t.active).toBe(false)
    }))

  test("a NEW draft after a pass gets its own fresh pass", () =>
    run(async (sid) => {
      const a = addDraft(sid, "A")
      const t = new TestTriage(sid)
      t.wake()
      t.release()
      await Bun.sleep(5)

      const c = addDraft(sid, "C") // arrives after the first pass
      t.wake()
      expect(t.passes).toEqual([[a.id], [c.id]])
    }))

  // #90 IMPACT GATE: the deterministic finalize lowers a high finding whose captured evidence does not
  // actually prove the claimed impact — even when the (stubbed) agent did nothing.
  const evid = (sid: string, status: number, location: string, origin: string, path: string) =>
    Request.add({ sessionID: sid, method: "GET", normalizedPath: path, origin, response: { status, headers: location ? { location } : {}, body: "" } })!.id

  test("impact gate LOWERS a high open-redirect whose realized 302 goes to the intended IdP (the #21 shape)", () =>
    run(async (sid) => {
      const rid = evid(sid, 302, "https://accounts.google.com/o/oauth2/v2/auth?x=1", "https://login.example.test", "/api/auth/signin/google")
      const f = Vulnerability.add({
        sessionID: sid,
        data: { severity: "high", title: "OAuth redirect to /support/impersonate activates support mode", description: "d", evidence_request_ids: [rid] },
      })
      const t = new TestTriage(sid)
      t.wake()
      t.release()
      await Bun.sleep(5)
      const cur = Vulnerability.get(sid).find((v) => v.id === f.id)!
      expect(cur.severity).toBe("low") // realized redirect stays on the IdP → not an open redirect
      expect(cur.description).toContain("[IMPACT GATE")
    }))

  test("impact gate LEAVES a proven off-site open redirect at high", () =>
    run(async (sid) => {
      const rid = evid(sid, 302, "https://evil.com/x", "https://app.test", "/go")
      const f = Vulnerability.add({
        sessionID: sid,
        data: { severity: "high", title: "Open redirect on /go", description: "d", evidence_request_ids: [rid] },
      })
      const t = new TestTriage(sid)
      t.wake()
      t.release()
      await Bun.sleep(5)
      const cur = Vulnerability.get(sid).find((v) => v.id === f.id)!
      expect(cur.severity).toBe("high") // proven → untouched
      expect(cur.description ?? "").not.toContain("[IMPACT GATE")
    }))

  // INTEGRATION: the triage source actually holds the lifecycle out of "complete" until triage finishes.
  test("triage source holds off 'complete' until triage finishes (#41)", () =>
    run(async (sid) => {
      const q = new InspectionQueue(sid, "web")
      q.flag({ key: "ep1", label: "ep1", meta: {} }, { type: "s", value: "v", priority: "medium" })
      q.markExamined("ep1") // inspection queue drained (pending 0, one examined)
      addDraft(sid, "A") // …but a draft is awaiting triage
      const t = new TestTriage(sid)
      const lc = new SessionLifecycle(sid, "web", q)
      lc.addSource({ name: "triage", isActive: () => t.active }) // exact web-bridge wiring

      t.wake() // triage pass starts (stub holds it in flight)
      ;(lc as any).tick()
      expect(lc.phase).not.toBe("complete") // HOLD — triage in flight

      t.release()
      await Bun.sleep(5) // triage finishes
      ;(lc as any).tick()
      expect(lc.phase).toBe("complete") // now scanned AND triaged
    }))

  // WIRING: the dispatcher invokes onDrain when the queue fully drains (the seam triage hooks).
  test("dispatcher fires onDrain when the queue drains (#41)", () =>
    run(async (sid) => {
      const q = new InspectionQueue(sid, "web")
      const router = { resolve: async () => [], prompt: () => "" } as unknown as ConstructorParameters<typeof InspectionDispatcher>[1]
      const d = new InspectionDispatcher(q, router)
      let drained = 0
      d.onDrain = () => {
        drained++
      }
      d.wake() // empty queue → loop returns, finally sees pending 0 → onDrain
      await Bun.sleep(200)
      expect(drained).toBeGreaterThan(0)
    }))
})
