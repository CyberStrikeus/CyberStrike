import { describe, test, expect } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Vulnerability } from "../../src/session/vulnerability"
import { EscalationRunner } from "../../src/inspection/escalation"
import { VulnStatus } from "../../src/session/vulnerability-status"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

function run(fn: (sessionID: string) => Promise<void>) {
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

function addFinding(sid: string, title: string, status: Info_Status = VulnStatus.TRIAGED) {
  Vulnerability.add({ sessionID: sid, data: { severity: "high", title, description: "d", status } as any })
}
type Info_Status = Parameters<typeof Vulnerability.add>[0]["data"]["status"]

describe("EscalationRunner — code-enforced escalation coverage (#84)", () => {
  test("pendingEscalation lists un-examined real findings; rejected excluded; mark clears them", () =>
    run(async (sid) => {
      addFinding(sid, "A")
      addFinding(sid, "B")
      addFinding(sid, "rejected one", VulnStatus.REJECTED)
      let pending = Vulnerability.pendingEscalation(sid)
      expect(pending.map((v) => v.title).sort()).toEqual(["A", "B"]) // rejected not pending
      const ids = pending.map((v) => v.id!).filter(Boolean)
      Vulnerability.markEscalationExamined(sid, ids)
      expect(Vulnerability.pendingEscalation(sid).length).toBe(0) // all covered
    }))

  test("a completed hunt pass marks EVERY seed examined (coverage guarantee)", () =>
    run(async (sid) => {
      addFinding(sid, "A")
      addFinding(sid, "B")
      addFinding(sid, "C")
      const runner = new EscalationRunner(sid)
      const seen: string[][] = []
      // Simulate a DISPATCHED pass: records the seeds + marks them examined (what hunt's finally does).
      ;(runner as any).hunt = async (ids: string[]) => {
        seen.push([...ids])
        Vulnerability.markEscalationExamined(sid, ids)
      }
      await (runner as any).run()
      expect(Vulnerability.pendingEscalation(sid).length).toBe(0) // no finding left un-hunted
      expect(seen.flat().length).toBe(3) // all 3 entered a pass
    }))

  test("a PRE-dispatch failure does NOT infinite-loop; seeds stay pending for retry", () =>
    run(async (sid) => {
      addFinding(sid, "A")
      addFinding(sid, "B")
      const runner = new EscalationRunner(sid)
      let calls = 0
      ;(runner as any).hunt = async () => {
        calls++
        throw new Error("Session.create failed (pre-dispatch)")
      }
      await (runner as any).run() // must TERMINATE
      expect(calls).toBe(1) // tried once, then the no-progress guard stopped it (no tight loop)
      expect(Vulnerability.pendingEscalation(sid).length).toBe(2) // seeds NOT marked — a later wake retries
    }))

  test("findings that arrive mid-run are still covered (re-loops while progress is made)", () =>
    run(async (sid) => {
      addFinding(sid, "A")
      const runner = new EscalationRunner(sid)
      const seen: string[] = []
      ;(runner as any).hunt = async (ids: string[]) => {
        seen.push(...ids)
        Vulnerability.markEscalationExamined(sid, ids)
        if (seen.length === 1) addFinding(sid, "B") // a new finding arrives during the first pass
      }
      await (runner as any).run()
      expect(Vulnerability.pendingEscalation(sid).length).toBe(0) // B was picked up and covered too
      expect(seen.length).toBe(2)
    }))
})
