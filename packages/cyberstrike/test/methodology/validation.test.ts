import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Intel } from "../../src/methodology/intel"
import { Validation } from "../../src/methodology/validation"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("Validation — Evidence Quality", () => {
  test("validates evidence with all required fields", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        Intel.add({
          sessionID: session.id,
          data: {
            type: "endpoint",
            severity: "high",
            title: "POST /api/admin/delete",
            detail: "Admin delete endpoint",
            asset: "target.com",
            source: "test",
            confidenceLevel: "confirmed",
            tags: [],
          },
        })

        const checks = Intel.getVrtChecks(session.id)
        if (checks.length > 0) {
          Intel.updateVrtCheck(session.id, checks[0].entryID, checks[0].category, {
            status: "tested_vulnerable",
            technique: "Manual testing with curl",
            testedBy: "test-agent",
            evidence: {
              requestSent: "POST /api/admin/delete HTTP/1.1",
              responseSummary:
                "HTTP/1.1 200 OK - User deleted successfully. The response indicates the operation completed.",
              reasoning:
                "The admin delete endpoint is accessible without authentication. Any user can delete other users by sending a POST request with the target user ID. This is an IDOR vulnerability.",
              requestCount: 3,
            },
          })
        }

        const results = Validation.validateEvidenceQuality(session.id)
        // With valid evidence, there should be no blocking violations for requestSent
        const allViolations = results.flatMap((r) => r.violations)
        expect(allViolations.every((v) => v.field !== "requestSent")).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("flags missing evidence fields", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        Intel.add({
          sessionID: session.id,
          data: {
            type: "endpoint",
            severity: "high",
            title: "GET /api/secret",
            detail: "Sensitive endpoint",
            asset: "target.com",
            source: "test",
            confidenceLevel: "confirmed",
            tags: [],
          },
        })

        const checks = Intel.getVrtChecks(session.id)
        if (checks.length > 0) {
          // Mark as vulnerable but with empty evidence
          Intel.updateVrtCheck(session.id, checks[0].entryID, checks[0].category, {
            status: "tested_vulnerable",
            technique: "test",
            testedBy: "test-agent",
            evidence: {},
          })
        }

        const results = Validation.validateEvidenceQuality(session.id)
        // Should flag missing evidence fields
        const allViolations = results.flatMap((r) => r.violations)
        expect(allViolations.length).toBeGreaterThan(0)

        await Session.remove(session.id)
      },
    })
  })
})

describe("Validation — Triager Checks", () => {
  test("runs triager checks without error", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const results = Validation.runTriagerChecks(session.id, [])
        expect(Array.isArray(results)).toBe(true)

        await Session.remove(session.id)
      },
    })
  })
})

describe("Validation — Combined Gates", () => {
  test("runAllGates returns structured result", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const result = Validation.runAllGates(session.id, [])
        expect(result).toBeDefined()
        expect(typeof result.summary).toBe("string")
        expect(typeof result.overallPassed).toBe("boolean")
        expect(Array.isArray(result.blockingViolations)).toBe(true)
        expect(Array.isArray(result.warningViolations)).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("empty session has no blocking violations", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const result = Validation.runAllGates(session.id, [])
        // Empty session should not have blocking violations
        expect(result.blockingViolations.length).toBe(0)

        await Session.remove(session.id)
      },
    })
  })
})
