import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { Vulnerability } from "../session/vulnerability"
import { getAssessResult } from "./azurehook/assess-cache"
import { CLOUD_GROUPS, groupByKey } from "../cloud/groups"
import type { Finding } from "./azurehook/shared"

function buildTriageMap(sessionID: string): Map<string, { status: string; vulnId: string }> {
  const vulns = Vulnerability.get(sessionID)
  const map = new Map<string, { status: string; vulnId: string }>()
  const stripCheckId = (t: string) => t.replace(/^\[[\w.-]+\]\s*/, "")
  for (const v of vulns) {
    const key = `${stripCheckId(v.title).toLowerCase()}|${(v.endpoint ?? "").toLowerCase()}`
    map.set(key, { status: v.status, vulnId: v.id ?? "" })
  }
  return map
}

function lookupTriage(f: Finding, triageMap: Map<string, { status: string; vulnId: string }>): { status: string; vulnId: string } {
  const key = `${f.title.toLowerCase()}|${f.resource.toLowerCase()}`
  const match = triageMap.get(key)
  if (!match) return { status: "not_reported", vulnId: "" }
  return match
}

interface TriagedFinding {
  checkId: string
  title: string
  severity: string
  resource: string
  details: string
  remediation: string | undefined
  triageStatus: string
  vulnId: string
}

interface GroupSummary {
  key: string
  label: string
  findings: number
  programs: number
  failures: number
  permissionFailures: number
}

interface SummaryOutput {
  type: "summary"
  totalFindings: number
  durationMs: number
  tenant: string
  subscription: string
  triage: { approved: number; rejected: number; pending: number }
  groups: GroupSummary[]
  critical: number
  high: number
  skippedPhases: string[]
}

interface GroupOutput {
  type: "group"
  group: string
  label: string
  analyst: string
  programs: number
  triaged: number
  pending: number
  findings: TriagedFinding[]
  failures: { program: string; reason: string }[]
  permissionDenied: { program: string; reason: string }[]
}

type Meta = {
  available: boolean
  totalFindings?: number
  groups?: GroupSummary[]
  group?: string
  findingCount?: number
  failureCount?: number
  findings?: Finding[]
}

export const GetAssessGroupFindingsTool = Tool.define("get_assess_findings", {
  description:
    "Retrieve Layer 1 assessment findings for a specific cloud group, or a summary of all groups. Returns structured JSON. Findings are cached from the last azure_assess run — no need to re-run the pipeline.",
  parameters: z.object({
    group: z
      .string()
      .optional()
      .describe(
        "Cloud group key to filter: identity, compute, network, data, security, access, specialized, compliance, exposure. Omit for a summary of all groups.",
      ),
  }),
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: Meta }> {
    const rootSession = Session.root(ctx.sessionID)
    const result = getAssessResult(rootSession)

    if (!result) {
      return {
        title: "Assess Findings: no cached result",
        output: JSON.stringify({ error: "No assessment result cached. Run azurehook azure_assess first." }),
        metadata: { available: false },
      }
    }

    if (!result.authOk) {
      return {
        title: "Assess Findings: auth failed",
        output: JSON.stringify({ error: "Last assessment failed authentication." }),
        metadata: { available: false },
      }
    }

    if (!params.group) {
      const triageMap = buildTriageMap(rootSession)
      const groups: GroupSummary[] = []
      for (const phase of result.phases) {
        for (const g of phase.groups) {
          groups.push({
            key: g.key,
            label: g.label,
            findings: g.findings.length,
            programs: g.programCount,
            failures: g.failures.length,
            permissionFailures: g.permissionFailures.length,
          })
        }
      }
      const allFindings = result.phases.flatMap((p) => p.groups.flatMap((g) => g.findings))
      let approved = 0, rejected = 0, pending = 0
      for (const f of allFindings) {
        const triage = lookupTriage(f, triageMap)
        if (triage.status === "approved") approved++
        else if (triage.status === "duplicate" || triage.status === "ignored") rejected++
        else pending++
      }

      const summary: SummaryOutput = {
        type: "summary",
        totalFindings: result.findings.length,
        durationMs: result.durationMs,
        tenant: result.metadata.tenantId ?? "unknown",
        subscription: result.metadata.subscriptionName ?? "unknown",
        triage: { approved, rejected, pending },
        groups,
        critical: result.triage.critical.length,
        high: result.triage.high.length,
        skippedPhases: result.skippedPhases,
      }

      return {
        title: `Assess Summary: ${result.findings.length} findings across ${groups.length} groups`,
        output: JSON.stringify(summary),
        metadata: { available: true, totalFindings: result.findings.length, groups },
      }
    }

    const grp = groupByKey(params.group)
    if (!grp) {
      return {
        title: "Assess Findings: unknown group",
        output: JSON.stringify({ error: `Unknown group key "${params.group}". Valid keys: ${CLOUD_GROUPS.map((g) => g.key).join(", ")}` }),
        metadata: { available: false },
      }
    }

    const groupResults = result.phases.flatMap((p) => p.groups).filter((g) => g.key === grp.key)
    const findings = groupResults.flatMap((g) => g.findings)
    const failures = groupResults.flatMap((g) => g.failures)
    const permDenied = groupResults.flatMap((g) => g.permissionFailures)
    const programs = groupResults.flatMap((g) => g.programs)

    if (findings.length === 0 && failures.length === 0 && permDenied.length === 0) {
      const empty: GroupOutput = {
        type: "group",
        group: params.group,
        label: grp.label,
        analyst: grp.analyst,
        programs: programs.length,
        triaged: 0,
        pending: 0,
        findings: [],
        failures: [],
        permissionDenied: [],
      }
      return {
        title: `Assess Findings [${params.group}]: 0 findings`,
        output: JSON.stringify(empty),
        metadata: { available: true, group: params.group, findingCount: 0 },
      }
    }

    const triageMap = buildTriageMap(rootSession)
    const triagedFindings: TriagedFinding[] = findings.map((f) => {
      const triage = lookupTriage(f, triageMap)
      return {
        checkId: f.checkId,
        title: f.title,
        severity: f.severity,
        resource: f.resource,
        details: f.details.slice(0, 500),
        remediation: f.remediation?.slice(0, 300),
        triageStatus: triage.status,
        vulnId: triage.vulnId,
      }
    })

    const triaged = triagedFindings.filter((f) => f.triageStatus !== "new" && f.triageStatus !== "not_reported")
    const pending = triagedFindings.filter((f) => f.triageStatus === "new" || f.triageStatus === "not_reported")

    const groupOutput: GroupOutput = {
      type: "group",
      group: params.group,
      label: grp.label,
      analyst: grp.analyst,
      programs: programs.length,
      triaged: triaged.length,
      pending: pending.length,
      findings: triagedFindings,
      failures: failures.map((f) => ({ program: f.program, reason: f.reason })),
      permissionDenied: permDenied.map((f) => ({ program: f.program, reason: f.reason })),
    }

    return {
      title: `Assess Findings [${params.group}]: ${findings.length} findings`,
      output: JSON.stringify(groupOutput),
      metadata: {
        available: true,
        group: params.group,
        findingCount: findings.length,
        failureCount: failures.length,
        findings,
      },
    }
  },
})
