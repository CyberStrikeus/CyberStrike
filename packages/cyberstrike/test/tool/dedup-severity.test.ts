// Issue #108 — when two findings are the same issue, dedup must keep the STRONGER one active (higher
// severity, then more evidence) and link the weaker as its duplicate — NOT whichever the caller pointed
// at. So if the triager marks a critical as a duplicate of a low, the roles are swapped: the critical
// stays active, the low becomes the duplicate. Proven through the real triage_vulnerability tool.
import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Vulnerability } from "../../src/session/vulnerability"
import { TriageVulnerabilityTool } from "../../src/tool/triage-vulnerability"
import { VulnStatus, normalizeStatus } from "../../src/session/vulnerability-status"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

function mockCtx(sessionID: string): any {
  return { sessionID, messageID: "msg_test", agent: "test", abort: new AbortController().signal, messages: [], metadata: () => {}, ask: async () => {} }
}

const statusOf = (sid: string, id: string) =>
  normalizeStatus(Vulnerability.get(sid).find((v) => v.id === id)!.status ?? VulnStatus.DRAFT)
const dupOf = (sid: string, id: string) => Vulnerability.get(sid).find((v) => v.id === id)!.duplicate_of

describe("severity-first dedup (#108)", () => {
  test("marking a CRITICAL as duplicate of a LOW is swapped — the critical stays active", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const crit = Vulnerability.add({ sessionID: session.id, data: { severity: "critical", title: "SQLi (exploited)", description: "d" } })
        const low = Vulnerability.add({ sessionID: session.id, data: { severity: "low", title: "SQLi (glanced)", description: "d" } })

        const tool = await TriageVulnerabilityTool.init()
        // the triager wrongly points the CRITICAL at the LOW
        const res = await tool.execute({ id: crit.id!, status: "duplicate", duplicate_of: low.id! }, mockCtx(session.id))

        // swapped: the LOW is the duplicate, the CRITICAL stays active
        expect(statusOf(session.id, low.id!)).toBe(VulnStatus.DUPLICATE)
        expect(dupOf(session.id, low.id!)).toBe(crit.id)
        expect(statusOf(session.id, crit.id!)).not.toBe(VulnStatus.DUPLICATE)
        expect(res.output).toContain("stays active")

        await Session.remove(session.id)
      },
    })
  })

  test("marking a LOW as duplicate of a CRITICAL is honored (no swap)", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const crit = Vulnerability.add({ sessionID: session.id, data: { severity: "critical", title: "IDOR", description: "d" } })
        const low = Vulnerability.add({ sessionID: session.id, data: { severity: "low", title: "IDOR dup", description: "d" } })

        const tool = await TriageVulnerabilityTool.init()
        await tool.execute({ id: low.id!, status: "duplicate", duplicate_of: crit.id! }, mockCtx(session.id))

        expect(statusOf(session.id, low.id!)).toBe(VulnStatus.DUPLICATE)
        expect(dupOf(session.id, low.id!)).toBe(crit.id)
        expect(statusOf(session.id, crit.id!)).not.toBe(VulnStatus.DUPLICATE)

        await Session.remove(session.id)
      },
    })
  })

  test("reconcileDuplicates retroactively fixes a critical already mis-marked as duplicate of a low", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        // Simulate the pre-existing bad state: a low is active in pending_fix, the critical was wrongly
        // marked as its duplicate (buried) — exactly what the old first-seen/arbitrary dedup produced.
        const low = Vulnerability.add({ sessionID: session.id, data: { severity: "low", title: "SQLi (glanced)", description: "d" } })
        const crit = Vulnerability.add({ sessionID: session.id, data: { severity: "critical", title: "SQLi (exploited)", description: "d" } })
        Vulnerability.update({ sessionID: session.id, id: low.id!, status: VulnStatus.PENDING_FIX })
        Vulnerability.update({ sessionID: session.id, id: crit.id!, status: VulnStatus.DUPLICATE, duplicate_of: low.id! })

        const swapped = Vulnerability.reconcileDuplicates(session.id)
        expect(swapped).toBe(1)

        // The critical is promoted into the low's active slot (pending_fix); the low becomes the duplicate.
        expect(statusOf(session.id, crit.id!)).toBe(VulnStatus.PENDING_FIX)
        expect(dupOf(session.id, crit.id!)).toBeFalsy()
        expect(statusOf(session.id, low.id!)).toBe(VulnStatus.DUPLICATE)
        expect(dupOf(session.id, low.id!)).toBe(crit.id)

        // Idempotent: a second pass changes nothing.
        expect(Vulnerability.reconcileDuplicates(session.id)).toBe(0)

        await Session.remove(session.id)
      },
    })
  })

  test("same severity → the finding WITH evidence survives", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const evidenced = Vulnerability.add({ sessionID: session.id, data: { severity: "high", title: "XSS", description: "d", evidence_request_ids: ["req-1"] } })
        const bare = Vulnerability.add({ sessionID: session.id, data: { severity: "high", title: "XSS bare", description: "d" } })

        const tool = await TriageVulnerabilityTool.init()
        // caller points the evidenced one at the bare one — evidence wins, so it is swapped
        await tool.execute({ id: evidenced.id!, status: "duplicate", duplicate_of: bare.id! }, mockCtx(session.id))

        expect(statusOf(session.id, bare.id!)).toBe(VulnStatus.DUPLICATE)
        expect(dupOf(session.id, bare.id!)).toBe(evidenced.id)
        expect(statusOf(session.id, evidenced.id!)).not.toBe(VulnStatus.DUPLICATE)

        await Session.remove(session.id)
      },
    })
  })
})
