import { describe, test, expect } from "bun:test"
import { buildCompletePayload } from "../../src/inspection/notify"

describe("buildCompletePayload — assessment-complete webhook payload", () => {
  test("summarizes findings by severity + endpoint counts", () => {
    const p = buildCompletePayload(
      "ses_1",
      "web",
      { examined: 5, total: 6 },
      [{ severity: "high" }, { severity: "high" }, { severity: "medium" }, { severity: "info" }],
      1_700_000_000_000,
    )
    expect(p.event).toBe("assessment.complete")
    expect(p.sessionID).toBe("ses_1")
    expect(p.domain).toBe("web")
    expect(p.endpoints).toEqual({ examined: 5, total: 6 })
    expect(p.findings.total).toBe(4)
    expect(p.findings.bySeverity).toEqual({ high: 2, medium: 1, info: 1 })
    expect(p.at).toBe(new Date(1_700_000_000_000).toISOString())
  })

  test("no findings → total 0, empty breakdown", () => {
    const p = buildCompletePayload("ses_2", "web", { examined: 0, total: 0 }, [])
    expect(p.findings.total).toBe(0)
    expect(p.findings.bySeverity).toEqual({})
  })
})
