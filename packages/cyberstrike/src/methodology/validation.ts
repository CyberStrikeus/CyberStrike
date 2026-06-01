import { Intel } from "./intel"
import { Methodology } from "./methodology"

// ============================================================
// VALIDATION SYSTEM — Evidence quality, triager checks,
// severity-impact matching, scope verification
// ============================================================

export namespace Validation {
  const P1_INDICATOR_REGEX = /\b(rce|remote code|command exec|full.*bypass|auth.*bypass.*complete|account.*takeover|mass.*data|sql.*inject.*data|ssrf.*internal.*data)\b/i
  const INFO_ONLY_REGEX = /\b(version|fingerprint|header|stack trace|error message|debug|info disclosure)\b/i
  const EXPLOITED_DATA_REGEX = /\b(user|email|token|key|password|secret|admin|session|cookie|api.?key|access.?token|private|credential)\b/i
  const HTTP_VERB_REGEX = /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|curl|http)\b/i

  export interface EvidenceQualityResult {
    entryID: string
    entryTitle: string
    checkCategory: string
    violations: ViolationItem[]
    passed: boolean
  }

  export interface TriagerCheckResult {
    entryID: string
    entryTitle: string
    checks: {
      severityMatchesImpact: boolean
      evidenceReproducible: boolean
      inScope: boolean
      isDuplicate: boolean
    }
    violations: ViolationItem[]
    passed: boolean
  }

  export interface ViolationItem {
    gate: string
    severity: "blocking" | "warning"
    message: string
    field?: string
    expectedValue?: string
    actualValue?: string
  }

  export interface GateResult {
    overallPassed: boolean
    blockingViolations: ViolationItem[]
    warningViolations: ViolationItem[]
    evidenceResults: EvidenceQualityResult[]
    triagerResults: TriagerCheckResult[]
    coverageReport: Intel.CoverageReport
    summary: string
  }

  // --- Evidence Quality ---

  export function validateEvidenceQuality(sessionID: string): EvidenceQualityResult[] {
    const checks = Intel.getVrtChecks(sessionID)
    const vulnerable = checks.filter((c) => c.status === "tested_vulnerable")
    const entries = Intel.get(sessionID)
    const entryMap = new Map(entries.map((e) => [e.id, e]))

    const results: EvidenceQualityResult[] = []

    for (const check of vulnerable) {
      const entry = entryMap.get(check.entryID)
      if (!entry) continue
      const violations: ViolationItem[] = []
      const evidence = check.evidence as Record<string, any> | undefined

      if (!evidence) {
        violations.push({
          gate: "evidence_quality",
          severity: "blocking",
          message: `No evidence object for vulnerable check "${check.category}"`,
          field: "evidence",
          expectedValue: "non-null evidence object",
          actualValue: "null/undefined",
        })
      } else {
        // requestSent must contain HTTP verb or curl
        if (!evidence.requestSent || !HTTP_VERB_REGEX.test(String(evidence.requestSent))) {
          violations.push({
            gate: "evidence_quality",
            severity: "blocking",
            message: `requestSent is empty or missing HTTP verb for "${check.category}"`,
            field: "requestSent",
            expectedValue: "HTTP verb or curl command",
            actualValue: String(evidence.requestSent ?? "(empty)").slice(0, 100),
          })
        }

        // responseSummary >= 50 chars
        const respLen = String(evidence.responseSummary ?? "").length
        if (respLen < 50) {
          violations.push({
            gate: "evidence_quality",
            severity: "blocking",
            message: `responseSummary too short for "${check.category}" (${respLen} chars, need 50+)`,
            field: "responseSummary",
            expectedValue: ">=50 characters",
            actualValue: `${respLen} characters`,
          })
        }

        // reasoning >= 100 chars
        const reasonLen = String(evidence.reasoning ?? "").length
        if (reasonLen < 100) {
          violations.push({
            gate: "evidence_quality",
            severity: "blocking",
            message: `reasoning too short for "${check.category}" (${reasonLen} chars, need 100+)`,
            field: "reasoning",
            expectedValue: ">=100 characters",
            actualValue: `${reasonLen} characters`,
          })
        }

        // requestCount >= 1
        if (!evidence.requestCount || evidence.requestCount < 1) {
          violations.push({
            gate: "evidence_quality",
            severity: "blocking",
            message: `requestCount < 1 for "${check.category}" — no HTTP request was made`,
            field: "requestCount",
            expectedValue: ">=1",
            actualValue: String(evidence.requestCount ?? 0),
          })
        }

        // Exploited entry must show real data in responseSummary
        if (entry.status === "exploited" && !EXPLOITED_DATA_REGEX.test(String(evidence.responseSummary ?? ""))) {
          violations.push({
            gate: "evidence_quality",
            severity: "blocking",
            message: `Exploited entry "${check.category}" — responseSummary lacks real data evidence`,
            field: "responseSummary",
            expectedValue: "Evidence of real data (user/email/token/key)",
            actualValue: String(evidence.responseSummary ?? "(empty)").slice(0, 100),
          })
        }
      }

      results.push({
        entryID: entry.id,
        entryTitle: entry.title,
        checkCategory: check.category,
        violations,
        passed: violations.length === 0,
      })
    }

    return results
  }

  // --- Triager Checks ---

  export function runTriagerChecks(sessionID: string, scopeItems: string[]): TriagerCheckResult[] {
    const entries = Intel.get(sessionID)
    const checks = Intel.getVrtChecks(sessionID)
    const checkMap = new Map<string, typeof checks>()
    for (const check of checks) {
      if (!checkMap.has(check.entryID)) checkMap.set(check.entryID, [])
      checkMap.get(check.entryID)!.push(check)
    }

    // Build duplicate map: asset+category => entry IDs
    const assetCategoryMap = new Map<string, string[]>()
    for (const check of checks) {
      if (check.status === "tested_vulnerable") {
        const entry = entries.find((e) => e.id === check.entryID)
        if (!entry) continue
        const key = `${entry.asset.toLowerCase()}:${check.category.toLowerCase()}`
        if (!assetCategoryMap.has(key)) assetCategoryMap.set(key, [])
        assetCategoryMap.get(key)!.push(entry.id)
      }
    }

    const results: TriagerCheckResult[] = []

    for (const entry of entries) {
      const entryChecks = checkMap.get(entry.id) ?? []
      const hasVuln = entryChecks.some((c) => c.status === "tested_vulnerable")
      if (entry.status !== "exploited" && !hasVuln) continue

      const violations: ViolationItem[] = []
      let severityMatchesImpact = true
      let evidenceReproducible = true
      let inScope = true
      let isDuplicate = false

      const allEvidence = entryChecks
        .filter((c) => c.status === "tested_vulnerable" && c.evidence)
        .map((c) => `${(c.evidence as any)?.responseSummary ?? ""} ${(c.evidence as any)?.reasoning ?? ""}`)
        .join(" ")

      // 1. Severity-impact matching
      if (entry.severity === "critical" && !P1_INDICATOR_REGEX.test(allEvidence)) {
        severityMatchesImpact = false
        violations.push({
          gate: "triager_check",
          severity: "blocking",
          message: `Critical severity but evidence lacks RCE/full bypass/mass data indicators`,
          field: "severity",
        })
      }

      if (entry.severity === "high" && INFO_ONLY_REGEX.test(allEvidence) && !P1_INDICATOR_REGEX.test(allEvidence)) {
        violations.push({
          gate: "triager_check",
          severity: "warning",
          message: `High severity but evidence only shows info disclosure`,
          field: "severity",
        })
      }

      // 2. Reproducibility: exploited entry must have requestCount >= 3
      const totalRequests = entryChecks
        .filter((c) => c.evidence)
        .reduce((sum, c) => sum + Number((c.evidence as any)?.requestCount ?? 0), 0)

      if (entry.status === "exploited" && totalRequests < 3) {
        evidenceReproducible = false
        violations.push({
          gate: "triager_check",
          severity: "blocking",
          message: `Exploited entry has only ${totalRequests} requests (need >=3 for reproducibility)`,
          field: "requestCount",
          expectedValue: ">=3",
          actualValue: String(totalRequests),
        })
      }

      // 3. Scope check
      if (scopeItems.length > 0 && !matchesScope(entry.asset, scopeItems)) {
        inScope = false
        violations.push({
          gate: "triager_check",
          severity: "blocking",
          message: `Asset "${entry.asset}" is not in scope`,
          field: "asset",
        })
      }

      // 4. Duplicate check
      for (const check of entryChecks) {
        if (check.status !== "tested_vulnerable") continue
        const key = `${entry.asset.toLowerCase()}:${check.category.toLowerCase()}`
        const matches = assetCategoryMap.get(key) ?? []
        if (matches.length > 1) {
          isDuplicate = true
          violations.push({
            gate: "triager_check",
            severity: "warning",
            message: `Possible duplicate: same asset "${entry.asset}" + category "${check.category}" found in ${matches.length} entries`,
            field: "vrtCategory",
          })
          break
        }
      }

      results.push({
        entryID: entry.id,
        entryTitle: entry.title,
        checks: { severityMatchesImpact, evidenceReproducible, inScope, isDuplicate },
        violations,
        passed: violations.filter((v) => v.severity === "blocking").length === 0,
      })
    }

    return results
  }

  // --- Combined Validation Gates ---

  export function runAllGates(sessionID: string, scopeItems: string[]): GateResult {
    const coverageReport = Intel.computeCoverage(sessionID)
    const evidenceResults = validateEvidenceQuality(sessionID)
    const triagerResults = runTriagerChecks(sessionID, scopeItems)

    // Per-asset coverage violations
    const MIN_COVERAGE = 60
    const assetCoverages = Intel.computePerAssetCoverage(sessionID)
    const coverageViolations: ViolationItem[] = assetCoverages
      .filter((a) => a.totalChecks > 0 && a.coveragePercent < MIN_COVERAGE)
      .map((a) => ({
        gate: "per_asset_coverage",
        severity: "blocking" as const,
        message: `Asset "${a.asset}" has only ${a.coveragePercent}% coverage (${a.completedChecks}/${a.totalChecks} checks) — minimum ${MIN_COVERAGE}%`,
      }))

    const allViolations = [
      ...coverageViolations,
      ...evidenceResults.flatMap((r) => r.violations),
      ...triagerResults.flatMap((r) => r.violations),
    ]
    const blockingViolations = allViolations.filter((v) => v.severity === "blocking")
    const warningViolations = allViolations.filter((v) => v.severity === "warning")
    const overallPassed = blockingViolations.length === 0

    const summaryLines: string[] = [
      overallPassed ? "=== VALIDATION GATE PASSED ===" : "=== VALIDATION GATE FAILED ===",
      "",
      `## Per-Asset Coverage (min: ${MIN_COVERAGE}%) — ${coverageViolations.length === 0 ? "PASS" : "FAIL"}`,
    ]
    for (const ac of assetCoverages) {
      const status = ac.totalChecks > 0 && ac.coveragePercent < MIN_COVERAGE ? "FAIL" : "OK"
      summaryLines.push(`  ${status}: ${ac.asset} — ${ac.coveragePercent}% (${ac.completedChecks}/${ac.totalChecks} checks)`)
    }
    summaryLines.push("")
    summaryLines.push(`## Evidence Quality — ${evidenceResults.every((r) => r.passed) ? "PASS" : "FAIL"}`)
    summaryLines.push(`  ${evidenceResults.filter((r) => r.passed).length}/${evidenceResults.length} checks pass`)
    summaryLines.push("")
    summaryLines.push(`## Triager Checks — ${triagerResults.every((r) => r.passed) ? "PASS" : "FAIL"}`)
    summaryLines.push(`  ${triagerResults.filter((r) => r.passed).length}/${triagerResults.length} entries pass`)
    summaryLines.push("")
    summaryLines.push(`## Summary`)
    summaryLines.push(`- Blocking violations: ${blockingViolations.length}`)
    summaryLines.push(`- Warning violations: ${warningViolations.length}`)

    return {
      overallPassed,
      blockingViolations,
      warningViolations,
      evidenceResults,
      triagerResults,
      coverageReport,
      summary: summaryLines.join("\n"),
    }
  }

  // --- Helpers ---

  function matchesScope(asset: string, scopeItems: string[]): boolean {
    const normalized = asset.toLowerCase().trim()
    for (const scope of scopeItems) {
      const s = scope.toLowerCase().trim()
      if (s === normalized) return true
      if (s.startsWith("*.")) {
        const domain = s.slice(2)
        if (normalized === domain || normalized.endsWith("." + domain)) return true
      }
      if (normalized.includes(s) || s.includes(normalized)) return true
    }
    return false
  }
}
