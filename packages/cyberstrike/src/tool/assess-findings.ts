import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { getAssessResult } from "./azurehook/assess-cache"
import { CLOUD_GROUPS, groupByKey } from "../cloud/groups"
import type { Finding } from "./azurehook/shared"

type Meta = {
  available: boolean
  totalFindings?: number
  groups?: { key: string; label: string; findings: number; programs: number; failures: number; permissionFailures: number }[]
  group?: string
  findingCount?: number
  failureCount?: number
  findings?: Finding[]
}

export const GetAssessGroupFindingsTool = Tool.define("get_assess_findings", {
  description:
    "Retrieve Layer 1 assessment findings for a specific cloud group, or a summary of all groups. Findings are cached from the last azure_assess run — no need to re-run the pipeline. Use this instead of parsing the full JSON output.",
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
        output: "No assessment result cached. Run `azurehook azure_assess` first.",
        metadata: { available: false },
      }
    }

    if (!result.authOk) {
      return {
        title: "Assess Findings: auth failed",
        output: "Last assessment failed authentication.",
        metadata: { available: false },
      }
    }

    if (!params.group) {
      const groups: Meta["groups"] & {} = []
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
      const lines = [
        `Assessment Summary (${result.findings.length} total findings, ${result.durationMs}ms)`,
        `Tenant: ${result.metadata.tenantId ?? "unknown"}`,
        `Subscription: ${result.metadata.subscriptionName ?? "unknown"}`,
        "",
        "Groups:",
        ...groups.map(
          (g) => {
            let line = `  ${g.key}: ${g.findings} findings, ${g.programs} programs, ${g.failures} failures`
            if (g.permissionFailures > 0) line += `, ${g.permissionFailures} permission denied (coverage gap)`
            return line
          },
        ),
        "",
        `Triage: ${result.triage.critical.length} critical, ${result.triage.high.length} high`,
        `Skipped phases: ${result.skippedPhases.length > 0 ? result.skippedPhases.join(", ") : "none"}`,
        "",
        "Use get_assess_findings(group: '<key>') to retrieve findings for a specific group.",
      ]
      return {
        title: `Assess Summary: ${result.findings.length} findings across ${groups.length} groups`,
        output: lines.join("\n"),
        metadata: { available: true, totalFindings: result.findings.length, groups },
      }
    }

    const grp = groupByKey(params.group)
    if (!grp) {
      return {
        title: "Assess Findings: unknown group",
        output: `Unknown group key "${params.group}". Valid keys: ${CLOUD_GROUPS.map((g) => g.key).join(", ")}`,
        metadata: { available: false },
      }
    }

    const groupResults = result.phases.flatMap((p) => p.groups).filter((g) => g.key === grp.key)
    const findings = groupResults.flatMap((g) => g.findings)
    const failures = groupResults.flatMap((g) => g.failures)
    const permDenied = groupResults.flatMap((g) => g.permissionFailures)
    const programs = groupResults.flatMap((g) => g.programs)

    if (findings.length === 0 && failures.length === 0 && permDenied.length === 0) {
      return {
        title: `Assess Findings [${params.group}]: 0 findings`,
        output: `No findings for group "${grp.label}". ${programs.length === 0 ? "Group was not executed." : `${programs.length} programs ran, all clean.`}`,
        metadata: { available: true, group: params.group, findingCount: 0 },
      }
    }

    const lines: string[] = [
      `Group: ${grp.label} (${params.group})`,
      `Analyst: ${grp.analyst}`,
      `Programs: ${programs.length} (${failures.length} failed${permDenied.length > 0 ? `, ${permDenied.length} permission denied` : ""})`,
      `Findings: ${findings.length}`,
      "",
    ]

    if (permDenied.length > 0) {
      lines.push("⚠ Coverage gap — insufficient permissions:")
      for (const f of permDenied) lines.push(`  [DENIED] ${f.program}: ${f.reason}`)
      lines.push("")
    }

    if (failures.length > 0) {
      lines.push("Failed programs:")
      for (const f of failures) lines.push(`  [!] ${f.program}: ${f.reason}`)
      lines.push("")
    }

    lines.push("Findings:")
    for (const f of findings) {
      lines.push(`  [${f.severity.toUpperCase()}] ${f.checkId} — ${f.title}`)
      lines.push(`    Resource: ${f.resource}`)
      lines.push(`    ${f.details.slice(0, 300)}`)
      if (f.remediation) lines.push(`    Fix: ${f.remediation.slice(0, 200)}`)
      lines.push("")
    }

    return {
      title: `Assess Findings [${params.group}]: ${findings.length} findings`,
      output: lines.join("\n"),
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
