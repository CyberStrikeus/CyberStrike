import { Log } from "../util/log"
import { SkillIndex } from "./index-engine"

export namespace KillChain {
  const log = Log.create({ service: "killchain" })

  export type Finding = {
    skill_id: string
    severity: "info" | "low" | "medium" | "high" | "critical"
    cwe_id?: string
    tech_stack?: string[]
  }

  export type Chain = {
    skills: string[]
    combined_severity: string
    description: string
    next_steps: string[]
  }

  const SEVERITY_ORDER: Record<string, number> = {
    info: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  }

  function maxSeverity(a: string, b: string): string {
    return (SEVERITY_ORDER[a] ?? 0) >= (SEVERITY_ORDER[b] ?? 0) ? a : b
  }

  export function analyze(findings: Finding[]): Chain[] {
    const chains: Chain[] = []
    const seen = new Set<string>()

    for (const finding of findings) {
      const entry = SkillIndex.get(finding.skill_id)
      if (!entry) continue

      for (const target of entry.chains_with) {
        const partner = findings.find((f) => f.skill_id === target)
        if (!partner) continue

        const key = [finding.skill_id, target].sort().join("+")
        if (seen.has(key)) continue
        seen.add(key)

        const boost = entry.severity_boost[target]
        const combined = boost
          ? (boost.match(/\((\w+)\)$/)?.[1]?.toLowerCase() ?? maxSeverity(finding.severity, partner.severity))
          : maxSeverity(finding.severity, partner.severity)

        chains.push({
          skills: [finding.skill_id, target],
          combined_severity: combined,
          description: boost ?? `${finding.skill_id} + ${target}`,
          next_steps: collectNextSteps([finding.skill_id, target], findings),
        })
      }
    }

    return chains.sort(
      (a, b) => (SEVERITY_ORDER[b.combined_severity] ?? 0) - (SEVERITY_ORDER[a.combined_severity] ?? 0),
    )
  }

  function collectNextSteps(used: string[], findings: Finding[]): string[] {
    const result = new Set<string>()
    const tested = new Set(findings.map((f) => f.skill_id))

    for (const skillId of used) {
      const entry = SkillIndex.get(skillId)
      if (!entry) continue
      for (const chain of entry.chains_with) {
        if (!tested.has(chain)) result.add(chain)
      }
    }

    return Array.from(result)
  }

  export function nextSteps(finding: Finding): string[] {
    const entry = SkillIndex.get(finding.skill_id)
    if (!entry) return []

    const steps: string[] = []
    for (const chain of entry.chains_with) {
      steps.push(chain)
    }

    if (finding.tech_stack?.length) {
      const related = SkillIndex.byTechStack(finding.tech_stack)
      for (const skill of related) {
        if (skill.name !== finding.skill_id && !steps.includes(skill.name)) {
          steps.push(skill.name)
        }
      }
    }

    return steps
  }

  export function summary(findings: Finding[]): string {
    const chains = analyze(findings)
    if (chains.length === 0) return "No kill chains detected from current findings."

    const lines = ["## Kill Chain Analysis", ""]
    for (const chain of chains) {
      lines.push(`**${chain.combined_severity.toUpperCase()}:** ${chain.description}`)
      lines.push(`  Skills: ${chain.skills.join(" → ")}`)
      if (chain.next_steps.length > 0) {
        lines.push(`  Next steps: ${chain.next_steps.join(", ")}`)
      }
      lines.push("")
    }
    return lines.join("\n")
  }
}
