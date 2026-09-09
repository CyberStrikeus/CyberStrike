import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./generate_report.txt"
import { Vulnerability } from "../session/vulnerability"
import { Session } from "../session"
import { VulnStatus, normalizeStatus } from "../session/vulnerability-status"
import { Methodology } from "../methodology/methodology"
import { Intel } from "../methodology/intel"
import { CoverageNote } from "../session/coverage-note"
import { Chain } from "../methodology/chain"
import { Validation } from "../methodology/validation"
import { Request } from "../session/request"
import { AgentPerformance } from "../methodology/performance"
import { renderFinding } from "./report-format"
import { Instance } from "../project/instance"
import path from "path"

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
}

const AGENT_NAMES = [
  "hunt-agent",
  "explore",
  "cloud-security",
  "internal-network",
  "mobile-application",
  "cyberstrike",
] as const

const AGENT_CODENAMES: Record<string, string> = {
  "hunt-agent": "INTERCEPTOR",
  explore: "GHOST",
  "cloud-security": "AURORA",
  "internal-network": "PHANTOM",
  "mobile-application": "CIPHER",
  cyberstrike: "COMMANDER",
}

const ALL_SECTIONS = [
  "executive_summary",
  "findings",
  "coverage",
  "methodology",
  "chains",
  "attack_surface",
  "timeline",
  "agent_performance",
  "validation",
] as const

export const GenerateReportTool = Tool.define("generate_report", {
  description: DESCRIPTION,
  parameters: z.object({
    include_sections: z.array(z.enum(ALL_SECTIONS)).optional().describe("Sections to include (default: all)"),
  }),
  async execute(params, ctx) {
    const r = await buildReportMarkdown(Session.root(ctx.sessionID), params.include_sections)
    // Write the report to disk HERE, deterministically — so the findings are guaranteed on disk and
    // never depend on the model to save them faithfully. The model then only fills the `<!-- AI: -->`
    // narrative placeholders by EDITING this file. Never throws (a write failure just omits savedPath).
    let savedPath: string | undefined
    try {
      const filepath = path.join(Instance.worktree, ".cyberstrike", "reports", `report-${new Date().toISOString().replace(/[:.]/g, "-")}.md`)
      await Bun.write(filepath, r.markdown) // Bun.write creates the parent directory
      savedPath = filepath
    } catch {}
    const output = savedPath
      ? `Report with all ${r.metadata.findingCount} finding(s) saved to:\n${savedPath}\n\nNow EDIT that file to fill only the \`<!-- AI: ... -->\` placeholders (Executive Summary, Risk Assessment, Remediation Priorities). Do NOT remove or rewrite the findings.\n\n---\n\n${r.markdown}`
      : r.markdown
    return { title: r.title, output, metadata: { ...r.metadata, savedPath } }
  },
})

export interface BuiltReport {
  title: string
  markdown: string
  metadata: {
    findingCount: number
    criticalCount: number
    highCount: number
    coveragePercent: number
    methodologyPercent: number
    activeChains: number
  }
}

// Build the full report markdown for a session, deterministically — the confirmed findings are
// rendered in-place via formatVulnTable → renderFinding, so a caller that writes this to disk gets a
// report that ALWAYS contains the vulnerabilities (no dependency on an LLM to add them). Only the
// `<!-- AI: … -->` narrative placeholders are left for the LLM to fill afterward. `sessionID` must
// already be the root session.
export async function buildReportMarkdown(sessionID: string, includeSections?: (typeof ALL_SECTIONS)[number][]): Promise<BuiltReport> {
  const rootSession = sessionID
  const session = await Session.get(rootSession)

  const vulns = Vulnerability.confirmed(rootSession)
  const intel = Intel.get(rootSession)
  const coverage = Intel.computeCoverage(rootSession)
  const assetCoverage = Intel.computePerAssetCoverage(rootSession)
  const coverageNotes = CoverageNote.listBySession(rootSession)
  const state = Methodology.computeState(rootSession)
  const chains = Chain.load(rootSession)
  const requests = Request.get(rootSession)
  const gates = Validation.runAllGates(rootSession, [])

  const breakdown = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const v of vulns) {
    const key = v.severity as keyof typeof breakdown
    if (key in breakdown) breakdown[key]++
  }

  const uniqueAssets = [...new Set(intel.map((e) => e.asset))]
  const duration = session.time.updated - session.time.created
  const sections = includeSections ?? [...ALL_SECTIONS]

  const parts: string[] = []
  parts.push(formatHeader(session, vulns, breakdown, coverage, state, duration))
  if (sections.includes("executive_summary")) {
    parts.push("---\n\n<!-- AI: executive_summary -->\n\n---\n\n<!-- AI: risk_assessment -->")
  }
  if (sections.includes("findings")) parts.push(formatVulnTable(vulns, rootSession))
  if (sections.includes("coverage")) parts.push(formatCoverage(coverage, assetCoverage, coverageNotes))
  if (sections.includes("methodology")) parts.push(formatMethodologySection(state))
  if (sections.includes("chains")) parts.push(formatChains(chains))
  if (sections.includes("attack_surface")) parts.push(formatAttackSurface(intel, requests, uniqueAssets))
  if (sections.includes("timeline")) parts.push(formatTimeline(vulns, session))
  if (sections.includes("agent_performance")) parts.push(formatAgentPerformance(rootSession))
  if (sections.includes("validation")) parts.push(formatValidationSection(gates))
  parts.push(
    "---\n\n<!-- AI: remediation_priorities -->\n\n---\n\n*Generated by CyberStrike (cyberstrike.io) — AI-Powered Offensive Security Platform*",
  )

  return {
    title: `Report: ${vulns.length} findings | ${coverage.coveragePercent}% coverage`,
    markdown: parts.join("\n\n"),
    metadata: {
      findingCount: vulns.length,
      criticalCount: breakdown.critical,
      highCount: breakdown.high,
      coveragePercent: coverage.coveragePercent,
      methodologyPercent: state.completionPercent,
      activeChains: chains.filter((c) => c.status !== "disproven").length,
    },
  }
}

// --- Helper Functions ---

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m`
  return `${seconds}s`
}

function formatHeader(
  session: { title: string; time: { created: number; updated: number } },
  vulns: Vulnerability.Info[],
  breakdown: Record<string, number>,
  coverage: Intel.CoverageReport,
  state: Methodology.State,
  duration: number,
): string {
  const date = new Date(session.time.created).toISOString().split("T")[0]
  const openCount = vulns.filter((v) => normalizeStatus(v.status ?? VulnStatus.DRAFT) === VulnStatus.PENDING_FIX).length
  return [
    "# Security Assessment Report",
    "",
    `**Target:** ${session.title}`,
    `**Date:** ${date}`,
    `**Duration:** ${formatDuration(duration)}`,
    `**Findings:** ${vulns.length} total (${openCount} open) — ${breakdown.critical} Critical, ${breakdown.high} High, ${breakdown.medium} Medium, ${breakdown.low} Low, ${breakdown.info} Info`,
    `**Coverage:** ${coverage.coveragePercent}% (${coverage.completedChecks}/${coverage.totalChecks} VRT checks)`,
    `**Methodology:** ${state.completionPercent}% (${state.completedCount}/${state.totalCount} phases)`,
  ].join("\n")
}

function formatVulnTable(vulns: Vulnerability.Info[], sessionID: string): string {
  if (vulns.length === 0) return "## Vulnerability Findings\n\nNo vulnerabilities discovered."

  const sorted = [...vulns].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4))

  const counters: Record<string, number> = {}
  const lines: string[] = ["## Vulnerability Findings", "", "### Summary", ""]
  lines.push("| # | Severity | Title | Endpoint | CWE | Status |")
  lines.push("|---|----------|-------|----------|-----|--------|")

  // Each finding is rendered in the mandatory Bugcrowd template (report-format.ts),
  // with a deterministic curl + full raw HTTP request/response in Steps To Reproduce
  // pulled from the finding's evidence_request_ids.
  const details: string[] = []

  for (const v of sorted) {
    const sev = v.severity.toUpperCase()
    counters[sev] = (counters[sev] ?? 0) + 1
    const ref = `${sev}-${String(counters[sev]).padStart(3, "0")}`

    lines.push(`| ${ref} | ${sev} | ${v.title} | ${v.endpoint ?? "—"} | ${v.cwe_id ?? "—"} | ${v.status} |`)

    details.push("", "---", "", renderFinding(v, sessionID, ref))
  }

  return lines.join("\n") + "\n" + details.join("\n")
}

function formatCoverage(
  coverage: Intel.CoverageReport,
  assets: Intel.AssetCoverage[],
  notes: CoverageNote.Info[] = [],
): string {
  const lines: string[] = [
    "## Testing Coverage",
    "",
    "### Overall",
    `- Total Intel Entries: ${coverage.totalEntries} (${coverage.entriesWithChecklist} with VRT checklists)`,
    `- VRT Checks: ${coverage.completedChecks}/${coverage.totalChecks} completed (${coverage.coveragePercent}%)`,
    `- Weighted Coverage: ${coverage.weightedCoveragePercent}% (confidence-adjusted)`,
    `- Vulnerable Checks: ${coverage.vulnerableChecks}`,
    `- Pending Checks: ${coverage.pendingChecks}`,
  ]

  if (assets.length > 0) {
    lines.push("")
    lines.push("### Per-Asset Breakdown")
    lines.push("")
    lines.push("| Asset | Entries | Checks | Completed | Vulnerable | Coverage |")
    lines.push("|-------|---------|--------|-----------|------------|----------|")
    for (const a of assets) {
      lines.push(
        `| ${a.asset} | ${a.totalEntries} | ${a.totalChecks} | ${a.completedChecks} | ${a.vulnerableChecks} | ${a.coveragePercent}% |`,
      )
    }
  }

  // What each tester actually recorded as tested, grouped by scope (asset). This is the
  // proxy-lane test memory (coverage_note) — distinct from the VRT checklist above, which
  // is only populated by the methodology lane.
  if (notes.length > 0) {
    const byAsset = new Map<string, CoverageNote.Info[]>()
    for (const n of notes) {
      const arr = byAsset.get(n.asset)
      if (arr) arr.push(n)
      else byAsset.set(n.asset, [n])
    }
    lines.push("")
    lines.push("### Tested (coverage notes)")
    lines.push(`What testers recorded as tested, by scope and class (${notes.length} notes).`)
    for (const [asset, arr] of byAsset) {
      lines.push("")
      lines.push(`**${asset}**`)
      for (const n of arr) lines.push(`- _[${n.scope}/${n.class}]_ ${n.note}${n.testedBy ? ` — ${n.testedBy}` : ""}`)
    }
  }

  if (coverage.redFlags.length > 0) {
    lines.push("")
    lines.push("### Red Flags")
    for (const flag of coverage.redFlags) {
      lines.push(`- **[${flag.severity.toUpperCase()}]** ${flag.message}`)
    }
  }

  return lines.join("\n")
}

function formatMethodologySection(state: Methodology.State): string {
  const lines: string[] = [
    "## Methodology Progress",
    "",
    "| Phase | Status | Deliverables |",
    "|-------|--------|-------------|",
  ]

  const statusIcon = (s: string) =>
    s === "completed" ? "DONE" : s === "in_progress" ? "ACTIVE" : s === "blocked" ? "BLOCKED" : "TODO"

  for (const phase of state.phases) {
    lines.push(`| ${phase.name} | [${statusIcon(phase.status)}] | ${phase.deliverableCount} |`)
  }

  lines.push("")
  lines.push(`Progress: ${state.completionPercent}% (${state.completedCount}/${state.totalCount} phases)`)

  const blocking = state.violations.filter((v) => v.severity === "blocking")
  if (blocking.length > 0) {
    lines.push("")
    lines.push("### Blocking Violations")
    for (const v of blocking) lines.push(`- **[${v.gate}]** ${v.message}`)
  }

  const warnings = state.violations.filter((v) => v.severity === "warning")
  if (warnings.length > 0) {
    lines.push("")
    lines.push("### Warnings")
    for (const v of warnings) lines.push(`- [${v.gate}] ${v.message}`)
  }

  return lines.join("\n")
}

function formatChains(chains: Chain.Candidate[]): string {
  const active = chains.filter((c) => c.status !== "disproven")
  if (active.length === 0) return "## Vulnerability Chains\n\nNo chain opportunities detected."

  const sorted = [...active].sort((a, b) => {
    const statusOrder = { confirmed: 0, testing: 1, detected: 2 } as Record<string, number>
    const sa = statusOrder[a.status] ?? 3
    const sb = statusOrder[b.status] ?? 3
    if (sa !== sb) return sa - sb
    return b.confidence - a.confidence
  })

  const lines: string[] = [
    `## Vulnerability Chains (${active.length} detected)`,
    "",
    "| Pattern | Entries | Impact | Severity | Confidence | Status |",
    "|---------|---------|--------|----------|------------|--------|",
  ]

  for (const c of sorted) {
    lines.push(
      `| ${c.pattern} | ${c.entryTitles.join(" + ")} | ${c.expectedImpact} | ${c.severity} | ${c.confidence}% | ${c.status} |`,
    )
  }

  return lines.join("\n")
}

function formatAttackSurface(intel: Intel.Entry[], requests: Request.Info[], assets: string[]): string {
  const lines: string[] = [`## Attack Surface`, "", `### Discovered Assets (${assets.length} unique)`]

  const byType = new Map<string, Intel.Entry[]>()
  for (const entry of intel) {
    const list = byType.get(entry.type) ?? []
    list.push(entry)
    byType.set(entry.type, list)
  }

  for (const [type, entries] of byType) {
    lines.push("")
    lines.push(`**${type}** (${entries.length}):`)
    for (const e of entries.slice(0, 20)) {
      lines.push(`- ${e.title} (${e.asset})${e.severity ? ` [${e.severity}]` : ""}`)
    }
    if (entries.length > 20) lines.push(`- ... and ${entries.length - 20} more`)
  }

  if (requests.length > 0) {
    const byMethod = new Map<string, number>()
    const hosts = new Set<string>()
    for (const r of requests) {
      byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + 1)
      if (r.host) hosts.add(r.host)
    }

    lines.push("")
    lines.push("### Request Summary")
    lines.push(`- Total Requests: ${requests.length}`)
    lines.push(
      `- Methods: ${[...byMethod.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([m, c]) => `${m}:${c}`)
        .join(", ")}`,
    )
    if (hosts.size > 0) lines.push(`- Unique Hosts: ${hosts.size}`)
  }

  return lines.join("\n")
}

function formatTimeline(vulns: Vulnerability.Info[], session: { time: { created: number; updated: number } }): string {
  const lines: string[] = ["## Assessment Timeline", ""]

  const startDate = new Date(session.time.created).toISOString()
  lines.push(`| Time | Event | Severity |`)
  lines.push(`|------|-------|----------|`)
  lines.push(`| ${startDate} | Assessment started | — |`)

  const sorted = [...vulns]
    .filter((v) => v.time?.created)
    .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))

  for (const v of sorted) {
    const time = new Date(v.time!.created).toISOString()
    lines.push(`| ${time} | ${v.title} | ${v.severity.toUpperCase()} |`)
  }

  const endDate = new Date(session.time.updated).toISOString()
  lines.push(`| ${endDate} | Assessment completed | — |`)

  return lines.join("\n")
}

function formatAgentPerformance(rootSession: string): string {
  const lines: string[] = [
    "## Agent Performance",
    "",
    "| Agent | Codename | Missions | Findings | Chains | Score | Morale |",
    "|-------|----------|----------|----------|--------|-------|--------|",
  ]

  for (const name of AGENT_NAMES) {
    const stats = AgentPerformance.getOrCreate(rootSession, name)
    const codename = AGENT_CODENAMES[name] ?? name
    lines.push(
      `| ${name} | ${codename} | ${stats.missionsCompleted} | ${stats.findingsReported} | ${stats.chainsContributed} | ${stats.performanceScore} | ${stats.morale} |`,
    )
  }

  return lines.join("\n")
}

function formatValidationSection(gates: ReturnType<typeof Validation.runAllGates>): string {
  const lines: string[] = [
    "## Validation Status",
    "",
    `- **Overall:** ${gates.overallPassed ? "PASSED" : "FAILED"}`,
    `- **Blocking Violations:** ${gates.blockingViolations.length}`,
    `- **Warning Violations:** ${gates.warningViolations.length}`,
  ]

  if (gates.blockingViolations.length > 0) {
    lines.push("")
    lines.push("### Blocking")
    for (const v of gates.blockingViolations) {
      lines.push(`- **[${v.gate}]** ${v.message}`)
    }
  }

  if (gates.warningViolations.length > 0) {
    lines.push("")
    lines.push("### Warnings")
    for (const v of gates.warningViolations) {
      lines.push(`- [${v.gate}] ${v.message}`)
    }
  }

  return lines.join("\n")
}
