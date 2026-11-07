import type {
  ReadinessFinding,
  ReadinessStageId,
} from "./reconstructionReadinessSchemas.js";

export const addMissingEvidenceFindings = (
  findings: ReadinessFinding[],
  stageId: ReadinessStageId,
  referencedIds: readonly string[],
  availableIds: ReadonlySet<string>,
): void => {
  for (const evidenceId of new Set(referencedIds))
    if (!availableIds.has(evidenceId))
      findings.push(
        readinessFinding(
          "referenced-evidence-missing",
          stageId,
          "unknown",
          `Referenced Evidence is absent from the bundle: ${evidenceId}.`,
        ),
      );
};

export const readinessFinding = (
  ...[code, stageId, status, detail, evidenceIds = []]: readonly [
    code: string,
    stageId: ReadinessStageId,
    status: ReadinessFinding["status"],
    detail: string,
    evidenceIds?: readonly string[],
  ]
): ReadinessFinding => ({
  code,
  stage_id: stageId,
  status,
  detail,
  evidence_ids: [...new Set(evidenceIds)].sort(),
});

export const readinessFindingOrder = (
  left: ReadinessFinding,
  right: ReadinessFinding,
): number => {
  const leftKey = `${left.stage_id}:${left.code}:${left.detail}`;
  const rightKey = `${right.stage_id}:${right.code}:${right.detail}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
};
