// Issue #101 — `triaged` and `pending_fix` share the same bar (the draft->triaged verification gate IS
// the pending_fix bar), so `triaged` is a vestigial intermediate state that left verified findings
// stuck. The triage_vulnerability tool now stores `pending_fix` directly when asked for `triaged`, so a
// verified finding never persists as `triaged` regardless of which agent triaged it. Proven end-to-end
// through the real tool + the real verification gate.
import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Vulnerability } from "../../src/session/vulnerability"
import { TriageVulnerabilityTool } from "../../src/tool/triage-vulnerability"
import { Verification } from "../../src/inspection/verification"
import { VulnStatus, normalizeStatus } from "../../src/session/vulnerability-status"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

function mockCtx(sessionID: string): any {
  return { sessionID, messageID: "msg_test", agent: "test", abort: new AbortController().signal, messages: [], metadata: () => {}, ask: async () => {} }
}

describe("triage_vulnerability collapses triaged -> pending_fix (#101)", () => {
  test("a replay-verified draft->triaged transition is stored as pending_fix, never triaged", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const req = "req-evidence-1"
        const finding = Vulnerability.add({
          sessionID: session.id,
          data: { severity: "high", title: "IDOR on /api/orders/{id}", description: "d", evidence_request_ids: [req] },
        })
        // mint the exact verification token the draft->triaged gate requires (http_replay would do this)
        const token = Verification.record({ sessionID: session.id, requestId: req, responseStatus: 200, bodyPrefix: "x" })

        const tool = await TriageVulnerabilityTool.init()
        const res = await tool.execute({ id: finding.id!, status: "triaged", verification_token: token }, mockCtx(session.id))

        // the gate passed, but the finding is collapsed straight to pending_fix — triaged never persists
        const stored = Vulnerability.get(session.id).find((v) => v.id === finding.id)!
        expect(normalizeStatus(stored.status ?? VulnStatus.DRAFT)).toBe(VulnStatus.PENDING_FIX)
        expect(normalizeStatus(stored.status ?? VulnStatus.DRAFT)).not.toBe(VulnStatus.TRIAGED)
        expect(res.output).toContain("pending_fix")

        await Session.remove(session.id)
      },
    })
  })

  test("a missing verification token is still refused (the gate is intact)", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const finding = Vulnerability.add({
          sessionID: session.id,
          data: { severity: "high", title: "unverified", description: "d", evidence_request_ids: ["req-x"] },
        })
        const tool = await TriageVulnerabilityTool.init()
        const res = await tool.execute({ id: finding.id!, status: "triaged" }, mockCtx(session.id))

        // no token → refused → finding stays draft (NOT silently promoted)
        const stored = Vulnerability.get(session.id).find((v) => v.id === finding.id)!
        expect(normalizeStatus(stored.status ?? VulnStatus.DRAFT)).toBe(VulnStatus.DRAFT)
        expect(res.title).toContain("verification required")

        await Session.remove(session.id)
      },
    })
  })
})
