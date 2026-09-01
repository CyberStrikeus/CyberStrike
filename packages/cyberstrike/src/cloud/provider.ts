import type { CloudAnalysis } from "./types"
import type { ClassifiedGroup } from "./classify"

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

  identityContext(rootSession: string): string
}
