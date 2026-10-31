import type { EvidenceLookup } from "../EvidenceInputResolver.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { projectAppleInventory } from "../../domain/apple/appleApplication.js";
import type { Result } from "../../domain/result.js";
import { APPLE_APPLICATION_PROVIDER } from "../../domain/investigationProviders.js";
import {
  projectInventoryEvidence,
  type InventoryProjectionEvidenceResult,
} from "../InventoryProjectionEvidence.js";

const OPERATION = "project_apple_application_graph" as const;

/** Project authenticated IPA or macOS app inventory Evidence into Apple application evidence. */
export const projectAppleApplicationEvidence = (
  rawInput: unknown,
  lookup?: EvidenceLookup,
  execution?: Pick<ExecutionOptions, "signal">,
): Result<InventoryProjectionEvidenceResult, AnalysisError> => {
  return projectInventoryEvidence({
    rawInput,
    ...(lookup === undefined ? {} : { lookup }),
    ...(execution === undefined ? {} : { execution }),
    project: projectAppleInventory,
    operation: OPERATION,
    predicateType: "rea.apple-application-graph",
    provider: APPLE_APPLICATION_PROVIDER,
    subjectFormat: (first) => first.subject?.format ?? "unknown",
  });
};
