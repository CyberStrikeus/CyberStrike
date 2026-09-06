import type { CloudAnalysis } from "./types"
import type { ClassifiedGroup } from "./classify"

// The domain-provider contract (agents + permissions) lives in the plugin SDK so
// installed domain packages and the host share one vocabulary. Re-exported here
// so existing host imports (`from "./provider"`) keep working unchanged.
export type {
  PermissionAction,
  PermissionRule,
  AgentSpec,
  DomainProvider,
  DomainProviderFactory,
} from "@cyberstrike-io/plugin"
import type { DomainProvider } from "@cyberstrike-io/plugin"

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
