// Auto-triage runner (#41). Verifies the logic that gates lifecycle completion — without a live LLM the
// actual agent dispatch is stubbed. The critical properties: triage runs only when un-reviewed drafts
// exist, is `active` while running (so the lifecycle waits), reviews each draft ONCE (a finding it left
// as draft is never re-triaged → no loop), and a NEW draft gets a fresh pass.
import { describe, test, expect } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Vulnerability } from "../../src/session/vulnerability"
import { TriageRunner } from "../../src/inspection/triage"
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
  protected async run(drafts: Vulnerability.Info[]): Promise<void> {
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

  test("reviews all drafts once; a left-as-draft finding is NOT re-triaged (no loop)", () =>
    run(async (sid) => {
      const a = addDraft(sid, "A")
      const b = addDraft(sid, "B")
      const t = new TestTriage(sid)

      t.wake()
      expect(t.active).toBe(true) // in flight → lifecycle would wait
      expect(t.passes).toEqual([[a.id, b.id]])

      t.release()
      await Bun.sleep(5) // let the finally + re-arm run
      expect(t.active).toBe(false)

      // Both are still draft (the stub changed nothing). Waking again must NOT re-triage them.
      t.wake()
      expect(t.passes.length).toBe(1) // no second pass → no loop
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
})
