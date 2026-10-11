// Issue #107 — ONE canonical severity color scheme across TUI, web and desktop. The scheme (severity →
// role) is defined in the backend model and mirrored in the web model; these MUST stay identical or the
// platforms diverge again. This test locks the scheme AND guards the mirror byte-for-behavior.
import { describe, expect, test } from "bun:test"
import { severityRole as backendRole, severityBold as backendBold } from "../../src/session/vulnerability-status"
import { severityRole as webRole, severityBold as webBold } from "../../../app/src/utils/vulnerability-status"

const SEVERITIES = ["critical", "high", "medium", "low", "info", "unknown", "", undefined] as const

describe("canonical severity scheme (#107)", () => {
  test("the scheme is critical+high=red, medium=orange, low=yellow, info/unknown=gray", () => {
    expect(backendRole("critical")).toBe("red")
    expect(backendRole("high")).toBe("red")
    expect(backendRole("medium")).toBe("orange")
    expect(backendRole("low")).toBe("yellow")
    expect(backendRole("info")).toBe("gray")
    expect(backendRole("whatever")).toBe("gray")
    // critical/high are the loud (bold) tiers
    expect(backendBold("critical")).toBe(true)
    expect(backendBold("high")).toBe(true)
    expect(backendBold("medium")).toBe(false)
    expect(backendBold("low")).toBe(false)
  })

  test("the web mirror is identical to the backend model (no divergence)", () => {
    for (const s of SEVERITIES) {
      expect(webRole(s)).toBe(backendRole(s))
      expect(webBold(s)).toBe(backendBold(s))
    }
  })
})
