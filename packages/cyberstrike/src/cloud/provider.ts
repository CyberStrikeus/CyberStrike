import type { CloudAnalysis } from "./types"
import type { ClassifiedGroup } from "./classify"

type PermissionAction = "ask" | "allow" | "deny"
type PermissionRule = PermissionAction | Record<string, PermissionAction>

export interface AgentSpec {
  name: string
  role: "analyst" | "batch-verifier" | "verifier" | "followup" | "orchestrator"
  group?: string
  description: string
  steps: number
  color: string
  prompt: string
  skills: string[]
  permissions: Record<string, PermissionRule>
}

export interface AssessmentProvider {
  key: string

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

  agentSpecs(): AgentSpec[]
}
