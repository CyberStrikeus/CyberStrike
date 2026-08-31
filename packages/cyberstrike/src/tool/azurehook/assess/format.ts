import type { Finding } from "../shared"
import type { AssessResult, PhaseResult } from "./types"

function sevIndex(sev: string): number {
  const order = ["critical", "high", "medium", "low", "info"]
  const idx = order.indexOf(sev)
  return idx >= 0 ? idx : order.length
}

// ── Text format (LLM / human consumption) ─────────────────────

export function formatAssessResult(result: AssessResult): string {
  const lines: string[] = ["[*] Azure Security Assessment"]

  if (!result.authOk) {
    lines.push("[!] Azure authentication failed — run 'az login' first")
    if (result.authError) lines.push(`    ${result.authError.slice(0, 200)}`)
    return lines.join("\n")
  }

  // metadata
  const m = result.metadata
  lines.push("[+] Azure auth verified")
  if (m.tenantId) lines.push(`[*] Tenant: ${m.tenantId}`)
  if (m.subscriptionName) lines.push(`[*] Subscription: ${m.subscriptionName}`)
  if (m.accountUpn) lines.push(`[*] Account: ${m.accountUpn}`)
  lines.push(`[*] Started: ${m.timestamp}`)

  // phases
  for (let i = 0; i < result.phases.length; i++) {
    const phase = result.phases[i]
    lines.push(`\n=== PHASE ${i + 1}: ${phase.name.toUpperCase()} ===`)

    if (phase.skipped) {
      lines.push(`  [!] Skipped (${phase.skipReason})`)
      continue
    }

    for (const g of phase.groups) {
      for (const f of g.failures) {
        lines.push(`  [!] ${f.program} failed: ${f.reason}`)
      }
      for (const f of g.permissionFailures) {
        lines.push(`  [DENIED] ${f.program}: ${f.reason}`)
      }
      let groupLine = `  ${g.label}: ${g.programCount} programs, ${g.findings.length} finding(s), ${fmtMs(g.durationMs)}`
      if (g.permissionFailures.length > 0) {
        groupLine += ` (${g.permissionFailures.length} permission denied — coverage gap)`
      }
      lines.push(groupLine)

      formatSlowPrograms(lines, g.programs)
    }

    if (phase.circuitBroken) {
      lines.push("  [!] Circuit breaker tripped — remaining groups skipped (>80% failure rate)")
    }
  }

  // subscriptions
  if (result.subscriptions.length > 1) {
    lines.push(`\n[!] ${result.subscriptions.length} subscriptions discovered — only default scanned`)
    lines.push("    Re-run with --subscription-id for each:")
    for (const s of result.subscriptions) lines.push(`    azurehook azure_assess --subscription-id ${s}`)
  } else if (result.subscriptions.length > 0) {
    lines.push(`\n[*] Subscriptions: ${result.subscriptions.length}`)
  }

  // summary
  const bySev: Record<string, number> = {}
  const byCat: Record<string, number> = {}
  for (const f of result.findings) {
    const sev = f.severity.toLowerCase()
    bySev[sev] = (bySev[sev] || 0) + 1
    const cat = f.checkId.split("-").slice(0, 2).join("-")
    byCat[cat] = (byCat[cat] || 0) + 1
  }

  lines.push("\n=== SUMMARY ===")
  lines.push(`[*] Total findings: ${result.findings.length}`)
  if (result.duplicatesRemoved > 0) {
    lines.push(`[*] Duplicates removed: ${result.duplicatesRemoved}`)
  }
  if (result.findings.length > 0) {
    lines.push(
      `[*] Severity: ${Object.entries(bySev)
        .sort(([a], [b]) => sevIndex(a) - sevIndex(b))
        .map(([s, c]) => `${s}:${c}`)
        .join(", ")}`,
    )
    lines.push(
      `[*] Categories: ${Object.entries(byCat)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([cat, c]) => `${cat}:${c}`)
        .join(", ")}`,
    )
  }

  if (result.skippedPhases.length > 0) {
    lines.push(`[!] Skipped: ${result.skippedPhases.join(", ")}`)
  }

  // retried programs summary
  const retried = result.phases
    .flatMap((p) => p.groups)
    .flatMap((g) => g.programs)
    .filter((p) => p.retryCount > 0)
  if (retried.length > 0) {
    lines.push(`[*] Programs retried: ${retried.length} (transient failures recovered)`)
  }

  lines.push(`[*] Duration: ${fmtMs(result.durationMs)}`)

  // triage
  const triage = result.triage
  if (triage.critical.length > 0 || triage.high.length > 0) {
    lines.push("\n=== TRIAGE ===")
    formatFindingList(lines, "CRITICAL", triage.critical)
    formatFindingList(lines, "HIGH", triage.high)

    lines.push("\n[*] Recommended next steps:")
    if (triage.flags.length > 0) {
      for (const flag of triage.flags) {
        lines.push(`    → ${flag.label} detected: ${flag.recommendation}`)
      }
    } else {
      lines.push("    → No critical attack paths detected by heuristics. Review findings manually.")
    }
    lines.push("    → ALWAYS run: azurehook cleanup_azure")
  }

  lines.push("\n[*] Assessment complete. Findings are auto-reported to the vulnerability list.")

  return lines.join("\n")
}

// ── JSON format (CI/CD, SIEM, dashboards) ─────────────────────

export function formatAssessResultJSON(result: AssessResult): string {
  const compact = {
    metadata: result.metadata,
    auth: result.authOk,
    subscriptions: result.subscriptions,
    summary: {
      totalFindings: result.findings.length,
      duplicatesRemoved: result.duplicatesRemoved,
      severity: countBySeverity(result.findings),
      categories: countByCategory(result.findings),
      skippedPhases: result.skippedPhases,
      durationMs: result.durationMs,
    },
    phases: result.phases.map(compactPhase),
    triage: {
      criticalCount: result.triage.critical.length,
      highCount: result.triage.high.length,
      flags: result.triage.flags.map((f) => f.key),
      recommendations: result.triage.flags.map((f) => ({ flag: f.key, action: f.recommendation })),
    },
    findings: result.findings,
  }
  return JSON.stringify(compact, null, 2)
}

// ── Helpers ───────────────────────────────────────────────────

function compactPhase(phase: PhaseResult) {
  return {
    name: phase.name,
    skipped: phase.skipped,
    skipReason: phase.skipReason,
    circuitBroken: phase.circuitBroken,
    durationMs: phase.durationMs,
    findingCount: phase.findings.length,
    groups: phase.groups.map((g) => ({
      key: g.key,
      label: g.label,
      programCount: g.programCount,
      findingCount: g.findings.length,
      failureCount: g.failures.length,
      permissionDeniedCount: g.permissionFailures.length,
      durationMs: g.durationMs,
      programs: g.programs.map((p) => ({
        name: p.name,
        status: p.status,
        findingCount: p.findings.length,
        durationMs: p.durationMs,
        retryCount: p.retryCount,
        ...(p.error ? { error: p.error } : {}),
      })),
    })),
  }
}

function countBySeverity(findings: Finding[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const f of findings) {
    const sev = f.severity.toLowerCase()
    counts[sev] = (counts[sev] || 0) + 1
  }
  return counts
}

function countByCategory(findings: Finding[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const f of findings) {
    const cat = f.checkId.split("-").slice(0, 2).join("-")
    counts[cat] = (counts[cat] || 0) + 1
  }
  return counts
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${Math.round(ms / 1000)}s`
}

const SLOW_THRESHOLD_MS = 30_000

function formatSlowPrograms(lines: string[], programs: { name: string; durationMs: number; status: string }[]): void {
  const slow = programs.filter((p) => p.durationMs >= SLOW_THRESHOLD_MS && p.status !== "failed")
  if (slow.length === 0) return
  for (const p of slow.sort((a, b) => b.durationMs - a.durationMs).slice(0, 3)) {
    lines.push(`    [~] ${p.name}: ${fmtMs(p.durationMs)} (slow)`)
  }
}

function formatFindingList(lines: string[], label: string, findings: Finding[]): void {
  if (findings.length === 0) return
  lines.push(`[!] ${label} (${findings.length}):`)
  for (const f of findings.slice(0, 10)) {
    lines.push(`    ${f.checkId} — ${f.title} [${f.resource}]`)
  }
  if (findings.length > 10) lines.push(`    ... and ${findings.length - 10} more`)
}
