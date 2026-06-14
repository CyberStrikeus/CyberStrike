import { Database, eq, and } from "../storage/db"
import { AgentPerformanceTable } from "./methodology.sql"
import { Identifier } from "../id/id"
import { Phase } from "./phase"

// ============================================================
// AGENT PERFORMANCE — Liyakat scoring, codenames, mission tracking
// CyberStrike agent performance — liyakat scoring and mission tracking
// ============================================================

export namespace AgentPerformance {
  // --- Agent Bones (static personality traits) ---

  interface Bones {
    codename: string
    archetype: "aggressive" | "methodical" | "stealthy" | "systematic" | "patient"
    strengths: string[]
  }

  const BONES: Record<string, Bones> = {
    "web-application": {
      codename: "STRIKER",
      archetype: "aggressive",
      strengths: ["exploit development", "chain building", "OWASP coverage"],
    },
    "proxy-agent": {
      codename: "INTERCEPTOR",
      archetype: "methodical",
      strengths: ["request analysis", "endpoint mapping", "traffic orchestration"],
    },
    explore: {
      codename: "GHOST",
      archetype: "stealthy",
      strengths: ["codebase analysis", "pattern discovery", "recon"],
    },
    "cloud-security": {
      codename: "AURORA",
      archetype: "systematic",
      strengths: ["cloud assessment", "IAM review", "CIS benchmarks"],
    },
    "internal-network": {
      codename: "PHANTOM",
      archetype: "patient",
      strengths: ["AD attacks", "lateral movement", "Kerberos"],
    },
    "mobile-application": {
      codename: "CIPHER",
      archetype: "methodical",
      strengths: ["mobile testing", "APK analysis", "API hooking"],
    },
    cyberstrike: {
      codename: "COMMANDER",
      archetype: "systematic",
      strengths: ["orchestration", "strategy", "delegation"],
    },
  }

  export interface Stats {
    missionsCompleted: number
    findingsReported: number
    chainsContributed: number
    turnsUsed: number
    successRate: number
    coverageContributed: number
    rejectionCount: number
    averageEvidenceQuality: number
    performanceScore: number
    morale: number
  }

  // --- Liyakat Formula ---

  export function calculateScore(stats: Stats): number {
    // Liyakat = successRate*0.4 + coverageNorm*0.25 + evidenceQuality*0.2 + efficiency*0.15
    const coverageNorm = Math.min(stats.coverageContributed / 50, 1) * 100 // normalize to 0-100
    const efficiency =
      stats.turnsUsed > 0 ? Math.min((stats.findingsReported + stats.chainsContributed) / stats.turnsUsed, 1) * 100 : 0

    return Math.round(
      stats.successRate * 0.4 + coverageNorm * 0.25 + stats.averageEvidenceQuality * 0.2 + efficiency * 0.15,
    )
  }

  // --- CRUD ---

  export function getOrCreate(sessionID: string, agentName: string): Stats {
    const row = Database.use((db) =>
      db
        .select()
        .from(AgentPerformanceTable)
        .where(and(eq(AgentPerformanceTable.session_id, sessionID), eq(AgentPerformanceTable.agent_name, agentName)))
        .get(),
    )

    if (row) {
      return {
        missionsCompleted: row.missions_completed,
        findingsReported: row.findings_reported,
        chainsContributed: row.chains_contributed,
        turnsUsed: row.turns_used,
        successRate: row.success_rate,
        coverageContributed: row.coverage_contributed,
        rejectionCount: row.rejection_count,
        averageEvidenceQuality: row.average_evidence_quality,
        performanceScore: row.performance_score,
        morale: row.morale,
      }
    }

    // Create new entry
    const now = Date.now()
    Database.use((db) => {
      db.insert(AgentPerformanceTable)
        .values({
          id: Identifier.ascending("agent_performance"),
          session_id: sessionID,
          agent_name: agentName,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    return {
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
    }
  }

  export function recordMission(
    sessionID: string,
    agentName: string,
    result: { success: boolean; findingsReported?: number; chainsContributed?: number; coverageContributed?: number },
  ): void {
    const stats = getOrCreate(sessionID, agentName)

    const missions = stats.missionsCompleted + 1
    const findings = stats.findingsReported + (result.findingsReported ?? 0)
    const chains = stats.chainsContributed + (result.chainsContributed ?? 0)
    const turns = stats.turnsUsed + 1
    const coverage = stats.coverageContributed + (result.coverageContributed ?? 0)
    const rejections = stats.rejectionCount + (result.success ? 0 : 1)
    const successRate = Math.round(((missions - rejections) / missions) * 100)

    // Morale: +5 on success, -10 on rejection, clamp 0-100
    const moraleDelta = result.success ? 5 : -10
    const morale = Math.max(0, Math.min(100, stats.morale + moraleDelta))

    const score = calculateScore({
      ...stats,
      missionsCompleted: missions,
      findingsReported: findings,
      chainsContributed: chains,
      turnsUsed: turns,
      successRate,
      coverageContributed: coverage,
      rejectionCount: rejections,
      morale,
    })

    Database.use((db) => {
      db.update(AgentPerformanceTable)
        .set({
          missions_completed: missions,
          findings_reported: findings,
          chains_contributed: chains,
          turns_used: turns,
          success_rate: successRate,
          coverage_contributed: coverage,
          rejection_count: rejections,
          performance_score: score,
          morale,
          time_updated: Date.now(),
        })
        .where(and(eq(AgentPerformanceTable.session_id, sessionID), eq(AgentPerformanceTable.agent_name, agentName)))
        .run()
    })
  }

  // --- Prompt Addendum ---

  export function getPromptAddendum(sessionID: string, agentName: string): string {
    const bones = BONES[agentName]
    if (!bones) return ""

    const stats = getOrCreate(sessionID, agentName)
    const lines = [
      `## Agent: ${bones.codename} (${agentName})`,
      `Archetype: ${bones.archetype} | Strengths: ${bones.strengths.join(", ")}`,
    ]

    if (stats.missionsCompleted > 0) {
      lines.push(
        `Performance: score=${stats.performanceScore} | missions=${stats.missionsCompleted} | findings=${stats.findingsReported} | morale=${stats.morale}%`,
      )

      if (stats.morale < 30) {
        lines.push("MORALE LOW — Focus on high-confidence tests. Avoid risky approaches.")
      } else if (stats.morale > 80) {
        lines.push("MORALE HIGH — Push boundaries. Try creative attack vectors.")
      }
    }

    return lines.join("\n")
  }

  // --- Agent Meta ---

  export function getAgentMeta(
    agentName: string,
  ): { codename: string; archetype: string; strengths: string[] } | undefined {
    const bones = BONES[agentName]
    if (!bones) return undefined
    return { codename: bones.codename, archetype: bones.archetype, strengths: [...bones.strengths] }
  }

  export function allAgentNames(): string[] {
    return Object.keys(BONES)
  }

  // --- Phase-Aware Agent Selection ---

  export interface PhaseAgent {
    name: string
    codename: string
    score: number
    reason: string
    role: "primary" | "secondary"
    stats: Stats
  }

  export function selectAgentsForPhase(sessionID: string, phaseId: Phase.Id): PhaseAgent[] {
    const phaseDef = Phase.get(phaseId)
    if (!phaseDef) return []

    const candidates: Array<Omit<PhaseAgent, "role">> = []

    for (const agentName of phaseDef.agents) {
      const bones = BONES[agentName]
      if (!bones || agentName === "cyberstrike") continue

      const stats = getOrCreate(sessionID, agentName)
      let score = stats.performanceScore > 0 ? stats.performanceScore : 50
      let reason = "phase-recommended"

      const matchingStrengths = bones.strengths.filter((s) =>
        phaseDef.requiredTags.some(
          (tag) => s.toLowerCase().includes(tag.replace(/-/g, " ")) || tag.replace(/-/g, " ").includes(s.toLowerCase()),
        ),
      )
      if (matchingStrengths.length > 0) {
        score += 15
        reason = `strength: ${matchingStrengths.join(", ")}`
      }

      if (stats.morale > 70) score += 10
      if (stats.morale < 30) score -= 15
      if (stats.missionsCompleted > 0) score += 5

      candidates.push({ name: agentName, codename: bones.codename, score, reason, stats })
    }

    candidates.sort((a, b) => b.score - a.score)
    return candidates.map((c, i) => ({ ...c, role: i === 0 ? ("primary" as const) : ("secondary" as const) }))
  }

  // --- Agent Selection (free-text mission) ---

  export function selectAgentForMission(sessionID: string, missionType: string): { agent: string; reason: string } {
    const candidates: Array<{ name: string; score: number; reason: string }> = []

    for (const [name, bones] of Object.entries(BONES)) {
      if (name === "cyberstrike") continue // orchestrator doesn't do missions

      const stats = getOrCreate(sessionID, name)
      let score = stats.performanceScore
      let reason = `base score: ${score}`

      // Boost for matching strengths
      const matchingStrengths = bones.strengths.filter((s) => missionType.toLowerCase().includes(s.toLowerCase()))
      if (matchingStrengths.length > 0) {
        score += 20
        reason = `strength match: ${matchingStrengths.join(", ")}`
      }

      // Morale boost/penalty
      if (stats.morale > 70) score += 10
      if (stats.morale < 30) score -= 15

      candidates.push({ name, score, reason })
    }

    candidates.sort((a, b) => b.score - a.score)
    const best = candidates[0]
    return best ? { agent: best.name, reason: best.reason } : { agent: "web-application", reason: "default fallback" }
  }
}
