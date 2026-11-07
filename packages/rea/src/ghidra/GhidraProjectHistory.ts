import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import type { AnalysisProfileCommitment } from "../domain/analysisProfile.js";
import { createEvidence, type Evidence } from "../domain/evidence.js";
import type { GhidraSessionInfo } from "./GhidraSessionValues.js";

/** Preserve saved Program reports once as historical facts, not fresh overrides. */
export const ghidraProjectHistoryEvidence = (
  target: BinaryTarget,
  profile: AnalysisProfileCommitment,
  info: GhidraSessionInfo,
): Evidence | undefined => {
  const reports = {
    ...(info.analysis_seeds === undefined
      ? {}
      : { analysis_seeds: info.analysis_seeds }),
    ...(info.disabled_analyzers === undefined
      ? {}
      : { disabled_analyzers: info.disabled_analyzers }),
    ...(info.mips_soft_float_storage === undefined
      ? {}
      : { mips_soft_float_storage: info.mips_soft_float_storage }),
    ...(info.riscv_calling_convention === undefined
      ? {}
      : { riscv_calling_convention: info.riscv_calling_convention }),
  };
  if (Object.keys(reports).length === 0) return undefined;
  return createEvidence(
    target,
    profile.provider,
    {
      operation: "health",
      parameters: { facet: "historical-project-analysis-reports" },
      analysisProfile: profile,
      result: { origin: "caller-project", ...reports },
      confidence: "observed",
      limitations: [
        "These reports were already stored in the caller's project. This session did not apply them; original analysis completeness and the remaining settings are unknown.",
      ],
    },
    { immutable: true },
  );
};
