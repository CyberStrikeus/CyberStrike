import type { Finding } from "./awshook/shared"

export type FindingClass = "formulaic" | "investigate"

export interface ClassifiedGroup {
  key: string
  formulaic: Finding[]
  investigate: Finding[]
}

const INVESTIGATE_PATTERNS = [
  /privilege.escalat/i,
  /PassRole/i,
  /AssumeRole/i,
  /cross.account/i,
  /wildcard.*policy/i,
  /admin.*access/i,
  /root.account/i,
  /credential/i,
  /access.key/i,
  /secret/i,
  /imds/i,
  /metadata/i,
  /public.*endpoint/i,
  /public.*bucket/i,
  /anonymous.*access/i,
  /lateral/i,
  /ssm.*command/i,
  /instance.connect/i,
  /lambda.*code/i,
  /cloudtrail.*disabled/i,
  /guardduty.*disabled/i,
  /organization.*policy/i,
  /scp.*violation/i,
  /kms.*key.*policy/i,
  /user.data.*secret/i,
  /ecr.*public/i,
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
