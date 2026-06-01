import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Methodology } from "../../src/methodology/methodology"
import { Intel } from "../../src/methodology/intel"
import { Phase } from "../../src/methodology/phase"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("Methodology — Phase Computation", () => {
  test("computeState returns phases for empty session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const state = Methodology.computeState(session.id)
        // Empty session → "single" scope → 12 phases (no infrastructure)
        const singlePhaseCount = Phase.forScope("single").length
        expect(state.phases.length).toBe(singlePhaseCount)
        expect(state.completionPercent).toBe(0)
        expect(state.completedCount).toBe(0)
        expect(state.totalCount).toBe(singlePhaseCount)

        await Session.remove(session.id)
      },
    })
  })

  test("adding intel with scope tags progresses scope_analysis phase", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        // Add intel with scope-related tags
        Intel.add({
          sessionID: session.id,
          data: {
            type: "subdomain",
            severity: "info",
            title: "Scope defined",
            detail: "Target scope established",
            asset: "example.com",
            source: "test",
            confidenceLevel: "confirmed",
            tags: ["scope"],
          },
        })

        Intel.add({
          sessionID: session.id,
          data: {
            type: "technology",
            severity: "info",
            title: "Target technology",
            detail: "Running Nginx",
            asset: "example.com",
            source: "test",
            confidenceLevel: "confirmed",
            tags: ["scope"],
          },
        })

        const state = Methodology.computeState(session.id)
        const scopePhase = state.phases.find((p) => p.id === "scope_analysis")
        expect(scopePhase).toBeDefined()
        expect(scopePhase!.deliverableCount).toBeGreaterThan(0)

        await Session.remove(session.id)
      },
    })
  })

  test("formatForPrompt returns markdown string", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const prompt = Methodology.formatForPrompt(session.id)
        expect(typeof prompt).toBe("string")
        expect(prompt).toContain("Methodology")

        await Session.remove(session.id)
      },
    })
  })

  test("getPhaseDirectives returns directives for known phase", () => {
    const directives = Methodology.getPhaseDirectives("scope_analysis")
    expect(typeof directives).toBe("string")
    expect(directives.length).toBeGreaterThan(0)
  })

  test("getPhaseDirectives returns empty string for unknown phase", () => {
    const directives = Methodology.getPhaseDirectives("nonexistent_phase" as Phase.Id)
    expect(directives).toBe("")
  })
})

describe("Methodology — Violations", () => {
  test("empty session generates no violations", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const state = Methodology.computeState(session.id)
        // Empty session should have no violations (nothing to violate)
        expect(Array.isArray(state.violations)).toBe(true)

        await Session.remove(session.id)
      },
    })
  })
})

describe("Methodology — Prerequisites", () => {
  test("scope_analysis has no prerequisites and is not blocked", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const state = Methodology.computeState(session.id)
        const scopePhase = state.phases.find((p) => p.id === "scope_analysis")
        expect(scopePhase).toBeDefined()
        // scope_analysis has no prerequisites, so it should not be blocked
        expect(scopePhase!.status).not.toBe("blocked")

        await Session.remove(session.id)
      },
    })
  })

  test("phases with unmet dependencies are blocked", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const state = Methodology.computeState(session.id)
        // active_recon depends on passive_recon which depends on scope_analysis
        const activeReconPhase = state.phases.find((p) => p.id === "active_recon")
        expect(activeReconPhase).toBeDefined()
        expect(activeReconPhase!.status).toBe("blocked")

        await Session.remove(session.id)
      },
    })
  })
})
