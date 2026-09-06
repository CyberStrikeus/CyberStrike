import type { Finding } from "../shared"

export type ProgramEntry = {
  name: string
  fn: (args: string[], timeout: number) => Promise<{ output: string; findings: Finding[] }>
}

export type GroupDef = {
  key: string
  label: string
  programs: ProgramEntry[]
}

export type PhaseDef = {
  name: string
  groups: GroupDef[]
  skip?: (ctx: AssessContext) => string | false
}

export type AssessContext = {
  sub: string | undefined
  subArgs: string[]
  perProgram: number
  deadline: number
  skipCompliance: boolean
  subscriptions: string[]
  maxConcurrency: number
}

export type ProgramResult = {
  name: string
  findings: Finding[]
  status: "ok" | "failed" | "retried" | "permission_denied"
  error: string | undefined
  durationMs: number
  retryCount: number
}

export type ProgramFailure = {
  program: string
  reason: string
}

export type GroupResult = {
  key: string
  label: string
  programCount: number
  programs: ProgramResult[]
  findings: Finding[]
  failures: ProgramFailure[]
  permissionFailures: ProgramFailure[]
  durationMs: number
}

export type PhaseResult = {
  name: string
  groups: GroupResult[]
  findings: Finding[]
  skipped: boolean
  skipReason: string | undefined
  durationMs: number
  circuitBroken: boolean
}

export type TriageFlag = {
  key: string
  label: string
  recommendation: string
}

export type TriageResult = {
  critical: Finding[]
  high: Finding[]
  flags: TriageFlag[]
}

export type AssessMetadata = {
  timestamp: string
  tenantId: string | undefined
  subscriptionName: string | undefined
  accountUpn: string | undefined
}

export type AssessResult = {
  authOk: boolean
  authError: string | undefined
  metadata: AssessMetadata
  subscriptions: string[]
  phases: PhaseResult[]
  findings: Finding[]
  duplicatesRemoved: number
  triage: TriageResult
  skippedPhases: string[]
  durationMs: number
}
