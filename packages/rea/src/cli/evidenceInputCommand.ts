import { localPathStringSchema } from "../domain/localPath.js";
import type { Evidence } from "../domain/evidence.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { Result } from "../domain/result.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";

/** Explicit portable lookup context for CLI workflows accepting retained IDs. */
export const evidenceBundleOption = localPathStringSchema
  .optional()
  .describe(
    "Resolve exact retained Evidence IDs from this local Evidence bundle without reopening an analysis target",
  );

/** Own one selected bundle read through workflow execution and final cleanup. */
export const runEvidenceInputCommand = (
  operation: string,
  bundlePath: string | undefined,
  signal: AbortSignal,
  execute: (
    lookup: EvidenceLookup | undefined,
    resources: ArtifactResourceScope,
  ) => Promise<Result<Evidence, AnalysisError>>,
) => {
  const resources = new ArtifactResourceScope();
  return finishAnalysisCommand(
    async () => {
      let lookup: EvidenceLookup | undefined;
      if (bundlePath !== undefined) {
        const { readImmutableEvidenceBundle } =
          await import("../application/EvidenceBundleFiles.js");
        const bundle = await readImmutableEvidenceBundle(
          absoluteCallerPath(bundlePath),
          signal,
          resources,
          operation,
        );
        if (!bundle.ok) return bundle;
        const records = new Map(
          bundle.value.records.map((record) => [record.evidence_id, record]),
        );
        lookup = (id) => records.get(id);
      }
      return execute(lookup, resources);
    },
    resources,
    "rea",
    operation,
    signal,
  );
};
