import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { AgentPerformance } from "../../src/methodology/performance"
import { Phase } from "../../src/methodology/phase"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("AgentPerformance — Liyakat Scoring", () => {
  test("calculateScore with zero stats returns 0", () => {
    const score = AgentPerformance.calculateScore({
      missionsCompleted: 0,
      findingsReported: 0,
      chainsContributed: 0,
      turnsUsed: 0,
      successRate: 0,
      coverageContributed: 0,
      rejectionCount: 0,
      averageEvidenceQuality: 0,
      performanceScore: 0,
      morale: 70,
    })
    expect(score).toBe(0)
  })

  test("calculateScore with perfect stats returns high score", () => {
    const score = AgentPerformance.calculateScore({
      missionsCompleted: 10,
      findingsReported: 8,
      chainsContributed: 3,
      turnsUsed: 10,
      successRate: 100,
      coverageContributed: 50,
      rejectionCount: 0,
      averageEvidenceQuality: 90,
      performanceScore: 0,
      morale: 95,
    })
    // successRate*0.4 + coverageNorm*0.25 + evidenceQuality*0.2 + efficiency*0.15
    // 100*0.4 + 100*0.25 + 90*0.2 + 100*0.15 = 40 + 25 + 18 + 15 = 98
    expect(score).toBe(98)
  })

  test("calculateScore respects weight distribution", () => {
    // Only successRate
    const scoreA = AgentPerformance.calculateScore({
      missionsCompleted: 10,
      findingsReported: 0,
      chainsContributed: 0,
      turnsUsed: 0,
      successRate: 100,
      coverageContributed: 0,
      rejectionCount: 0,
      averageEvidenceQuality: 0,
      performanceScore: 0,
      morale: 70,
    })
    expect(scoreA).toBe(40) // 100 * 0.4

    // Only coverage
    const scoreB = AgentPerformance.calculateScore({
      missionsCompleted: 0,
      findingsReported: 0,
      chainsContributed: 0,
      turnsUsed: 0,
      successRate: 0,
      coverageContributed: 50,
      rejectionCount: 0,
      averageEvidenceQuality: 0,
      performanceScore: 0,
      morale: 70,
    })
    expect(scoreB).toBe(25) // 100 * 0.25
  })
})

describe("AgentPerformance — CRUD", () => {
  test("getOrCreate initializes with defaults", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const stats = AgentPerformance.getOrCreate(session.id, "web-application")
        expect(stats.missionsCompleted).toBe(0)
        expect(stats.morale).toBe(70)
        expect(stats.performanceScore).toBe(0)

        await Session.remove(session.id)
      },
    })
  })

  test("getOrCreate returns same data on second call", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const first = AgentPerformance.getOrCreate(session.id, "cloud-security")
        const second = AgentPerformance.getOrCreate(session.id, "cloud-security")

        expect(first.morale).toBe(second.morale)
        expect(first.missionsCompleted).toBe(second.missionsCompleted)

        await Session.remove(session.id)
      },
    })
  })

  test("recordMission updates stats correctly", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        AgentPerformance.recordMission(session.id, "web-application", {
          success: true,
          findingsReported: 2,
          chainsContributed: 1,
          coverageContributed: 10,
        })

        const stats = AgentPerformance.getOrCreate(session.id, "web-application")
        expect(stats.missionsCompleted).toBe(1)
        expect(stats.findingsReported).toBe(2)
        expect(stats.chainsContributed).toBe(1)
        expect(stats.coverageContributed).toBe(10)
        expect(stats.morale).toBe(75) // 70 + 5

        await Session.remove(session.id)
      },
    })
  })

  test("recordMission decreases morale on failure", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        AgentPerformance.recordMission(session.id, "explore", {
          success: false,
        })

        const stats = AgentPerformance.getOrCreate(session.id, "explore")
        expect(stats.morale).toBe(60) // 70 - 10

        await Session.remove(session.id)
      },
    })
  })
})

describe("AgentPerformance — Prompt Addendum", () => {
  test("getPromptAddendum returns string for known agent", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const addendum = AgentPerformance.getPromptAddendum(session.id, "web-application")
        expect(typeof addendum).toBe("string")
        expect(addendum).toContain("STRIKER")
        expect(addendum).toContain("aggressive")

        await Session.remove(session.id)
      },
    })
  })

  test("getPromptAddendum returns empty for unknown agent", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const addendum = AgentPerformance.getPromptAddendum(session.id, "nonexistent-agent")
        expect(addendum).toBe("")

        await Session.remove(session.id)
      },
    })
  })
})

describe("AgentPerformance — Agent Selection", () => {
  test("selectAgentForMission returns agent with reason", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const selection = AgentPerformance.selectAgentForMission(session.id, "exploit development")
        expect(selection.agent).toBeDefined()
        expect(selection.reason).toBeDefined()
        expect(typeof selection.agent).toBe("string")

        await Session.remove(session.id)
      },
    })
  })

  test("selects web-application for exploit-related missions", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const selection = AgentPerformance.selectAgentForMission(session.id, "exploit development and chain building")
        // web-application has "exploit development" and "chain building" in strengths
        expect(selection.agent).toBe("web-application")
        expect(selection.reason).toContain("strength match")

        await Session.remove(session.id)
      },
    })
  })

  test("selects cloud-security for cloud-related missions", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const selection = AgentPerformance.selectAgentForMission(session.id, "cloud assessment")
        expect(selection.agent).toBe("cloud-security")

        await Session.remove(session.id)
      },
    })
  })
})

describe("AgentPerformance — getAgentMeta", () => {
  test("returns meta for known agent", () => {
    const meta = AgentPerformance.getAgentMeta("web-application")
    expect(meta).toBeDefined()
    expect(meta!.codename).toBe("STRIKER")
    expect(meta!.archetype).toBe("aggressive")
    expect(meta!.strengths).toContain("exploit development")
  })

  test("returns undefined for unknown agent", () => {
    const meta = AgentPerformance.getAgentMeta("nonexistent-agent")
    expect(meta).toBeUndefined()
  })

  test("allAgentNames returns all registered agents", () => {
    const names = AgentPerformance.allAgentNames()
    expect(names).toContain("web-application")
    expect(names).toContain("cloud-security")
    expect(names).toContain("explore")
    expect(names).toContain("cyberstrike")
    expect(names.length).toBeGreaterThanOrEqual(7)
  })
})

describe("AgentPerformance — selectAgentsForPhase", () => {
  test("returns explore as primary for scope_analysis", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const agents = AgentPerformance.selectAgentsForPhase(session.id, "scope_analysis")
        expect(agents.length).toBeGreaterThan(0)
        expect(agents[0].name).toBe("explore")
        expect(agents[0].role).toBe("primary")
        expect(agents[0].codename).toBe("GHOST")

        await Session.remove(session.id)
      },
    })
  })

  test("returns web-application as primary for authentication_testing", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const agents = AgentPerformance.selectAgentsForPhase(session.id, "authentication_testing")
        expect(agents.length).toBeGreaterThan(0)
        expect(agents[0].name).toBe("web-application")
        expect(agents[0].role).toBe("primary")

        await Session.remove(session.id)
      },
    })
  })

  test("returns empty for unknown phase", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const agents = AgentPerformance.selectAgentsForPhase(session.id, "nonexistent" as Phase.Id)
        expect(agents).toEqual([])

        await Session.remove(session.id)
      },
    })
  })

  test("marks first as primary and rest as secondary", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        // authentication_testing has both web-application and proxy-agent
        const agents = AgentPerformance.selectAgentsForPhase(session.id, "authentication_testing")
        expect(agents.length).toBe(2)
        expect(agents[0].role).toBe("primary")
        expect(agents[1].role).toBe("secondary")

        await Session.remove(session.id)
      },
    })
  })
})
