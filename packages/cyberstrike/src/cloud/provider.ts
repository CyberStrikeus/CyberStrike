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

/**
 * Narrow a DomainProvider (what the registry stores) to an AssessmentProvider
 * (what the cloud orchestration workflow needs). A domain that runs a batch
 * scan+verify assessment implements the richer interface; the assessment entry
 * resolves its provider from the registry and checks this before driving it.
 */
export function isAssessmentProvider(p: DomainProvider): p is AssessmentProvider {
  const a = p as Partial<AssessmentProvider>
  return typeof a.groups === "function" && typeof a.analystPrompt === "function" && typeof a.verifyPrompt === "function"
}
