import { Database, eq } from "../storage/db"
import { IntelEntryTable } from "./methodology.sql"
import { Methodology } from "./methodology"
import { Intel } from "./intel"
import { Chain } from "./chain"

// ============================================================
// METHODOLOGY CONTEXT — System prompt injection for
// methodology-aware sessions. Only activates when the session
// has intel entries (meaning methodology is in use).
// ============================================================

export namespace MethodologyContext {
  /**
   * Generate methodology context for system prompt injection.
   * Returns null if methodology is not active (no intel entries).
   */
  export function generate(sessionID: string): string | null {
    // Check if any intel entries exist for this session
    const count = Database.use((db) =>
      db
        .select({ id: IntelEntryTable.id })
        .from(IntelEntryTable)
        .where(eq(IntelEntryTable.session_id, sessionID))
        .limit(1)
        .all(),
    )
    if (count.length === 0) return null

    const sections: string[] = [
      "# Methodology Engine Active",
      "",
    ]

    // 1. Methodology progress
    const state = Methodology.computeState(sessionID)
    sections.push("## Phase Progress")
    sections.push("")
    for (const phase of state.phases) {
      const icon =
        phase.status === "completed" ? "[x]"
        : phase.status === "in_progress" ? "[>]"
        : phase.status === "blocked" ? "[!]"
        : "[ ]"
      sections.push(`${icon} ${phase.name} (${phase.deliverableCount} entries)`)
    }
    sections.push(`\nOverall: ${state.completionPercent}% (${state.completedCount}/${state.totalCount})`)

    // 2. Blocking violations
    const blocking = state.violations.filter((v) => v.severity === "blocking")
    if (blocking.length > 0) {
      sections.push("")
      sections.push("## BLOCKING VIOLATIONS — Fix before proceeding")
      for (const v of blocking) {
        sections.push(`- [${v.gate}] ${v.message}`)
      }
    }

    // 3. Current phase directive
    if (state.currentPhase) {
      const directive = Methodology.getPhaseDirectives(state.currentPhase)
      if (directive) {
        sections.push("")
        sections.push(`## Current Phase Directive`)
        sections.push(directive)
      }
    }

    // 4. Coverage summary (brief)
    const coverage = Intel.computeCoverage(sessionID)
    if (coverage.totalChecks > 0) {
      sections.push("")
      sections.push(`## Coverage: ${coverage.coveragePercent}% (${coverage.completedChecks}/${coverage.totalChecks} VRT checks)`)
      if (coverage.vulnerableChecks > 0) {
        sections.push(`Vulnerable: ${coverage.vulnerableChecks} findings`)
      }
      if (coverage.redFlags.length > 0) {
        sections.push("RED FLAGS:")
        for (const flag of coverage.redFlags.slice(0, 3)) {
          sections.push(`  - [${flag.severity}] ${flag.message}`)
        }
      }
    }

    // 5. Chain opportunities
    const chains = Chain.load(sessionID)
    const active = chains.filter((c) => c.status === "detected" || c.status === "testing")
    if (active.length > 0) {
      sections.push("")
      sections.push(`## Chain Opportunities (${active.length})`)
      for (const c of active.slice(0, 5)) {
        const conf = c.confidence >= 80 ? "HIGH" : c.confidence >= 60 ? "MED" : "LOW"
        sections.push(`- [${conf}] ${c.pattern}: ${c.entryTitles.join(" + ")} -> ${c.expectedImpact}`)
      }
    }

    // 6. Untested items (top 5)
    if (coverage.untestedItems.length > 0) {
      sections.push("")
      sections.push(`## Priority Untested (${coverage.untestedItems.length} total)`)
      for (const item of coverage.untestedItems.slice(0, 5)) {
        sections.push(`- ${item.entryTitle}: ${item.vrtCategory} (${item.asset})`)
      }
    }

    // 7. Intelligence protocol reminder
    sections.push("")
    sections.push("## Protocol Reminders")
    sections.push("- Log ALL discoveries via `add_intel` — endpoints, subdomains, technologies, credentials, parameters")
    sections.push("- After testing a VRT check, update it via `update_vrt_check` with evidence")
    sections.push("- Check `methodology_status` before reporting done")
    sections.push("- Use `scope_check` before testing new targets")

    return sections.join("\n")
  }

  /**
   * Check if the session should be forced to continue (coverage/phases incomplete).
   */
  export function shouldForceContinue(sessionID: string): { force: boolean; directive: string } {
    const count = Database.use((db) =>
      db
        .select({ id: IntelEntryTable.id })
        .from(IntelEntryTable)
        .where(eq(IntelEntryTable.session_id, sessionID))
        .limit(1)
        .all(),
    )
    if (count.length === 0) return { force: false, directive: "" }

    const state = Methodology.computeState(sessionID)
    const coverage = Intel.computeCoverage(sessionID)

    // Force continue if coverage is below threshold and phases are incomplete
    if (state.completionPercent < 50 && coverage.coveragePercent < 30) {
      return {
        force: true,
        directive: `Methodology only ${state.completionPercent}% complete and coverage at ${coverage.coveragePercent}%. Continue testing — do not stop until at least 50% methodology completion and 30% VRT coverage.`,
      }
    }

    // Force continue if there are blocking violations
    const blocking = state.violations.filter((v) => v.severity === "blocking")
    if (blocking.length > 0) {
      return {
        force: true,
        directive: `${blocking.length} blocking violations must be resolved before finishing: ${blocking.map((v) => v.message).join("; ")}`,
      }
    }

    return { force: false, directive: "" }
  }
}
