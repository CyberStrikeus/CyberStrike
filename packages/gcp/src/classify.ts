import type { Finding } from "./gcphook/shared"

export type FindingClass = "formulaic" | "investigate"

export interface ClassifiedGroup {
  key: string
  formulaic: Finding[]
  investigate: Finding[]
}

const INVESTIGATE_PATTERNS = [
  /privilege.escalat/i,
  /actAs/i,
  /setIamPolicy/i,
  /cross.project/i,
  /wildcard.*binding/i,
  /admin.*access/i,
  /owner.*role/i,
  /credential/i,
  /service.account.key/i,
  /secret/i,
  /metadata/i,
  /public.*(bucket|ip|endpoint)/i,
  /allUsers/i,
  /allAuthenticatedUsers/i,
  /lateral/i,
  /os.login/i,
  /custom.role.*dangerous/i,
  /audit.*log.*(disabled|tamper)/i,
  /flow.*log.*(disabled|missing)/i,
  /org.*policy/i,
  /gke.*(abac|legacy)/i,
  /firewall.*(open|0\.0\.0\.0)/i,
  /sql.*(public|open.*internet)/i,
  /snapshot.*public/i,
]

export function classifyFinding(f: Finding): FindingClass {
  if (f.severity === "critical") return "investigate"
  if (f.severity === "high" && INVESTIGATE_PATTERNS.some((p) => p.test(f.title))) return "investigate"
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
