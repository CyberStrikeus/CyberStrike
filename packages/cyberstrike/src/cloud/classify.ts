import type { Finding } from "../tool/azurehook/shared"

export type FindingClass = "formulaic" | "investigate"

export interface ClassifiedGroup {
  key: string
  formulaic: Finding[]
  investigate: Finding[]
}

const INVESTIGATE_PATTERNS = [
  /managed.identity/i,
  /service.principal/i,
  /role.assignment/i,
  /privilege/i,
  /escalat/i,
  /lateral/i,
  /credential/i,
  /key.vault/i,
  /secret/i,
  /certificate/i,
  /custom.role/i,
  /wildcard/i,
  /network.peering/i,
  /vpn/i,
  /express.route/i,
  /subdomain.takeover/i,
  /dangling/i,
  /public.endpoint/i,
  /anonymous.access/i,
  /runbook/i,
  /automation/i,
  /logic.app/i,
  /api.key/i,
]

export function classifyFinding(f: Finding): FindingClass {
  if (f.severity === "critical") return "investigate"

  if (f.severity === "high") {
    const text = `${f.title} ${f.details}`
    if (INVESTIGATE_PATTERNS.some((p) => p.test(text))) return "investigate"
  }

  return "formulaic"
}

export function classifyGroupFindings(
  groups: { key: string; findings: Finding[] }[],
): ClassifiedGroup[] {
  return groups.map((g) => {
    const formulaic: Finding[] = []
    const investigate: Finding[] = []
    for (const f of g.findings) {
      if (classifyFinding(f) === "investigate") investigate.push(f)
      else formulaic.push(f)
    }
    return { key: g.key, formulaic, investigate }
  })
}
