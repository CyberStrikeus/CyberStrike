import { createEvidence, type Evidence } from "../evidence.js";
import type { ProcessCapture } from "./processCaptureParsing.js";
import {
  compareProcessCaptures,
  type ProcessCaptureComparisonOptions,
} from "./processComparison.js";
import { PROCESS_PROVIDER } from "./processEvidenceProvider.js";

/** Authenticated capture record with its validated process observations. */
export interface ParsedProcessCaptureEvidence {
  readonly record: Evidence;
  readonly capture: ProcessCapture;
}

/** Compute and retain one comparison with the exact policy and source lineage. */
export const compareProcessCaptureEvidence = (
  left: ParsedProcessCaptureEvidence,
  right: ParsedProcessCaptureEvidence,
  options: ProcessCaptureComparisonOptions = {},
) => {
  const comparison = compareProcessCaptures(
    left.capture,
    right.capture,
    options,
  );
  const evidence = createEvidence(undefined, PROCESS_PROVIDER, {
    predicateType: "rea.process-comparison",
    operation: "compare_process_captures",
    parameters: {
      left_evidence_id: left.record.evidence_id,
      right_evidence_id: right.record.evidence_id,
      left_normalization: left.capture.normalization,
      right_normalization: right.capture.normalization,
      ...(options.maxCaptureAgeMs === undefined
        ? {}
        : { max_capture_age_ms: options.maxCaptureAgeMs }),
      ...(options.traceSpecification === undefined
        ? {}
        : { trace_spec: options.traceSpecification }),
    },
    result: comparison,
    confidence: "derived",
    authority: "analyst-inference",
    limitations: comparison.limitations,
    locations: [...left.record.locations, ...right.record.locations],
    evidenceLinks: [left.record.evidence_id, right.record.evidence_id],
  });
  return { comparison, evidence };
};
