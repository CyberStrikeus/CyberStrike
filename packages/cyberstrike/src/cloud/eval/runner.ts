import { classifyFinding, classifyGroupFindings } from "../classify"
import { aggregateTrajectories } from "../trajectory"
import { EVAL_CASES, BOUNDARY_CASES, GROUP_CASES } from "./fixtures"
import type { EvalCase } from "./fixtures"
import type { AgentTrajectory } from "../trajectory"

interface EvalResult {
  suite: string
  case: string
  check: string
  expected: string
  actual: string
  pass: boolean
}

// ── Suite 1: Core classification ──────────────────────────────

function evalClassification(c: EvalCase, suite: string): EvalResult[] {
  const results: EvalResult[] = []
  for (const f of c.findings) {
    const expected = c.expectedClassification[f.checkId]
    if (!expected) continue
    const actual = classifyFinding(f)
    results.push({
      suite,
      case: c.name,
      check: f.checkId,
      expected,
      actual,
      pass: actual === expected,
    })
  }
  return results
}

// ── Suite 2: Group classification ─────────────────────────────

function evalGroupClassification(): EvalResult[] {
  const results: EvalResult[] = []
  for (const gc of GROUP_CASES) {
    const classified = classifyGroupFindings(gc.groups)
    for (const c of classified) {
      const expected = gc.expected[c.key]
      if (!expected) continue
      results.push({
        suite: "group",
        case: gc.name,
        check: `${c.key}/formulaic`,
        expected: String(expected.formulaic),
        actual: String(c.formulaic.length),
        pass: c.formulaic.length === expected.formulaic,
      })
      results.push({
        suite: "group",
        case: gc.name,
        check: `${c.key}/investigate`,
        expected: String(expected.investigate),
        actual: String(c.investigate.length),
        pass: c.investigate.length === expected.investigate,
      })
    }
  }
  return results
}

// ── Suite 3: JSON output structure ────────────────────────────

function evalJsonOutput(): EvalResult[] {
  const results: EvalResult[] = []

  const summaryJson = JSON.stringify({
    type: "summary",
    totalFindings: 42,
    durationMs: 15000,
    tenant: "test-tenant",
    subscription: "test-sub",
    triage: { approved: 10, rejected: 5, pending: 27 },
    groups: [{ key: "identity", label: "Identity", findings: 8, programs: 12, failures: 1, permissionFailures: 0 }],
    critical: 3,
    high: 15,
    skippedPhases: [],
  })

  const parsed = JSON.parse(summaryJson)
  const requiredFields = ["type", "totalFindings", "triage", "groups", "critical", "high"]
  for (const field of requiredFields) {
    results.push({
      suite: "json",
      case: "summary-output",
      check: `has-${field}`,
      expected: "present",
      actual: parsed[field] !== undefined ? "present" : "missing",
      pass: parsed[field] !== undefined,
    })
  }

  results.push({
    suite: "json",
    case: "summary-output",
    check: "type-value",
    expected: "summary",
    actual: parsed.type,
    pass: parsed.type === "summary",
  })

  results.push({
    suite: "json",
    case: "summary-output",
    check: "triage-sum",
    expected: "42",
    actual: String(parsed.triage.verified + parsed.triage.rejected + parsed.triage.pending),
    pass: parsed.triage.verified + parsed.triage.rejected + parsed.triage.pending === 42,
  })

  const groupJson = JSON.stringify({
    type: "group",
    group: "identity",
    label: "Identity & Access",
    analyst: "cloud-analyst-identity",
    programs: 12,
    triaged: 5,
    pending: 3,
    findings: [
      { checkId: "AZ-IAM-001", title: "Test", severity: "high", resource: "/sub/rg", details: "d", remediation: "r", triageStatus: "triaged", vulnId: "v1" },
    ],
    failures: [],
    permissionDenied: [],
  })

  const groupParsed = JSON.parse(groupJson)
  const groupFields = ["type", "group", "label", "analyst", "findings", "failures", "permissionDenied"]
  for (const field of groupFields) {
    results.push({
      suite: "json",
      case: "group-output",
      check: `has-${field}`,
      expected: "present",
      actual: groupParsed[field] !== undefined ? "present" : "missing",
      pass: groupParsed[field] !== undefined,
    })
  }

  results.push({
    suite: "json",
    case: "group-output",
    check: "finding-has-triageStatus",
    expected: "present",
    actual: groupParsed.findings[0].triageStatus !== undefined ? "present" : "missing",
    pass: groupParsed.findings[0].triageStatus !== undefined,
  })

  results.push({
    suite: "json",
    case: "group-output",
    check: "finding-has-vulnId",
    expected: "present",
    actual: groupParsed.findings[0].vulnId !== undefined ? "present" : "missing",
    pass: groupParsed.findings[0].vulnId !== undefined,
  })

  return results
}

// ── Suite 4: Trajectory aggregation ───────────────────────────

function evalTrajectory(): EvalResult[] {
  const results: EvalResult[] = []

  const agents: AgentTrajectory[] = [
    { agent: "cloud-analyst-identity", group: "identity", sessionID: "s1", steps: 8, toolCalls: { get_assess_findings: 2, azurehook: 5, add_intel: 3 }, totalToolCalls: 10, compactions: 0, durationMs: 45000, timedOut: false, error: undefined },
    { agent: "cloud-batch-verifier", group: "batch-verify", sessionID: "s2", steps: 12, toolCalls: { get_assess_findings: 4, triage_vulnerability: 8 }, totalToolCalls: 12, compactions: 1, durationMs: 30000, timedOut: false, error: undefined },
    { agent: "cloud-analyst-compute", group: "compute", sessionID: "s3", steps: 6, toolCalls: { get_assess_findings: 1, azurehook: 3, add_intel: 2 }, totalToolCalls: 6, compactions: 0, durationMs: 60000, timedOut: true, error: "agent timed out after 60s" },
  ]

  const agg = aggregateTrajectories(agents, 120000)

  results.push({
    suite: "trajectory",
    case: "aggregation",
    check: "totalSteps",
    expected: "26",
    actual: String(agg.totalSteps),
    pass: agg.totalSteps === 26,
  })

  results.push({
    suite: "trajectory",
    case: "aggregation",
    check: "totalToolCalls",
    expected: "28",
    actual: String(agg.totalToolCalls),
    pass: agg.totalToolCalls === 28,
  })

  results.push({
    suite: "trajectory",
    case: "aggregation",
    check: "agents-count",
    expected: "3",
    actual: String(agg.agents.length),
    pass: agg.agents.length === 3,
  })

  results.push({
    suite: "trajectory",
    case: "aggregation",
    check: "breakdown-azurehook",
    expected: "8",
    actual: String(agg.toolCallBreakdown["azurehook"] ?? 0),
    pass: agg.toolCallBreakdown["azurehook"] === 8,
  })

  results.push({
    suite: "trajectory",
    case: "aggregation",
    check: "breakdown-get_assess_findings",
    expected: "7",
    actual: String(agg.toolCallBreakdown["get_assess_findings"] ?? 0),
    pass: agg.toolCallBreakdown["get_assess_findings"] === 7,
  })

  results.push({
    suite: "trajectory",
    case: "aggregation",
    check: "breakdown-triage_vulnerability",
    expected: "8",
    actual: String(agg.toolCallBreakdown["triage_vulnerability"] ?? 0),
    pass: agg.toolCallBreakdown["triage_vulnerability"] === 8,
  })

  results.push({
    suite: "trajectory",
    case: "aggregation",
    check: "breakdown-add_intel",
    expected: "5",
    actual: String(agg.toolCallBreakdown["add_intel"] ?? 0),
    pass: agg.toolCallBreakdown["add_intel"] === 5,
  })

  results.push({
    suite: "trajectory",
    case: "aggregation",
    check: "totalDurationMs",
    expected: "120000",
    actual: String(agg.totalDurationMs),
    pass: agg.totalDurationMs === 120000,
  })

  return results
}

// ── Runner ────────────────────────────────────────────────────

export function runEvals(): { results: EvalResult[]; passed: number; failed: number; total: number } {
  const results: EvalResult[] = []

  for (const c of EVAL_CASES) results.push(...evalClassification(c, "core"))
  for (const c of BOUNDARY_CASES) results.push(...evalClassification(c, "boundary"))
  results.push(...evalGroupClassification())
  results.push(...evalJsonOutput())
  results.push(...evalTrajectory())

  const passed = results.filter((r) => r.pass).length
  const failed = results.filter((r) => !r.pass).length
  return { results, passed, failed, total: results.length }
}

if (import.meta.main) {
  const { results, passed, failed, total } = runEvals()

  const suites = new Map<string, EvalResult[]>()
  for (const r of results) {
    const list = suites.get(r.suite) ?? []
    list.push(r)
    suites.set(r.suite, list)
  }

  console.log(`\nCloud Eval: ${passed}/${total} passed, ${failed} failed\n`)

  for (const [suite, items] of suites) {
    const sp = items.filter((r) => r.pass).length
    const sf = items.filter((r) => !r.pass).length
    console.log(`  [${suite}] ${sp}/${items.length} passed${sf > 0 ? ` (${sf} FAILED)` : ""}`)
    for (const r of items) {
      const icon = r.pass ? "✓" : "✗"
      const line = `    ${icon} ${r.case}/${r.check}: expected=${r.expected} actual=${r.actual}`
      if (!r.pass) console.error(line)
      else console.log(line)
    }
  }

  if (failed > 0) process.exit(1)
}
