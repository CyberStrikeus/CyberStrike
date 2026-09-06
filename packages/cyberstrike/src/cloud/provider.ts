import type { CloudAnalysis } from "./types"
import type { ClassifiedGroup } from "./classify"

export type PermissionAction = "ask" | "allow" | "deny"
export type PermissionRule = PermissionAction | Record<string, PermissionAction>

export interface AgentSpec {
  name: string
  role: "analyst" | "batch-verifier" | "verifier" | "followup" | "orchestrator" | "specialist" | "analyzer" | "support"
  group?: string
  description: string
  steps: number
  color: string
  prompt: string
  skills: string[]
  permissions: Record<string, PermissionRule>
  hidden?: boolean
  prependRequestContext?: boolean
  useSmallModel?: boolean
}

export interface DomainProvider {
  key: string
  agentSpecs(): AgentSpec[]
}

export interface AssessmentProvider extends DomainProvider {
  groups(): CloudAnalysis.GroupDef[]
  identityGroup(): CloudAnalysis.GroupDef | null
  parallelGroups(): CloudAnalysis.GroupDef[]

  validate(rootSession: string): { ok: true; totalFindings: number } | { ok: false; reason: string }
  findingCount(rootSession: string, groupKey: string): number
  classify(rootSession: string, groups: CloudAnalysis.GroupDef[]): ClassifiedGroup[]

  analystPrompt(group: CloudAnalysis.GroupDef, identityContext: string, slice?: string): string
  batchPrompt(groupKeys: string[], identityContext: string): string
  verifyPrompt(summary: string): string
  followupPrompt(chain: CloudAnalysis.FollowUp): string

  identityContext(rootSession: string): string
}
