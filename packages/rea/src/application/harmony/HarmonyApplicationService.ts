import type { EvidenceLookup } from "../EvidenceInputResolver.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { projectHarmonyInventory } from "../../domain/harmony/harmonyApplication.js";
import type { Result } from "../../domain/result.js";
import { HARMONY_APPLICATION_PROVIDER } from "../../domain/investigationProviders.js";
import {
  projectInventoryEvidence,
  type InventoryProjectionEvidenceResult,
} from "../InventoryProjectionEvidence.js";

const OPERATION = "project_harmony_application_graph" as const;

/** Project authenticated HarmonyOS package inventory Evidence into application evidence. */
export const projectHarmonyApplicationEvidence = (
  rawInput: unknown,
  lookup?: EvidenceLookup,
  execution?: Pick<ExecutionOptions, "signal">,
): Result<InventoryProjectionEvidenceResult, AnalysisError> => {
  return projectInventoryEvidence({
    rawInput,
    ...(lookup === undefined ? {} : { lookup }),
    ...(execution === undefined ? {} : { execution }),
    project: projectHarmonyInventory,
    operation: OPERATION,
    predicateType: "rea.harmony-application-graph",
    provider: HARMONY_APPLICATION_PROVIDER,
    subjectFormat: (first) => first.subject?.format ?? "unknown",
  });
};
