import { createEvidence } from "../domain/evidence.js";
import { FUNCTION_COMPARISON_PROVIDER } from "../domain/comparisonEvidenceIdentity.js";
import { compareProcessCaptureEvidence } from "../domain/process/processComparisonEvidence.js";
import { PROCESS_PROVIDER } from "../domain/process/processEvidenceProvider.js";
import { parseProcessCapture } from "../domain/process/processCaptureParsing.js";
import { FUNCTION_COMPARISON_EXAMPLE } from "./functionComparisonExample.js";
import { EMPTY_PROCESS_CAPTURE_EXAMPLE } from "../domain/process/processCaptureExample.js";

import { parseFunctionEvidence } from "../domain/functionDossierEvidence.js";
import { compareFunctions } from "../domain/functionComparison.js";
const left = parseFunctionEvidence(FUNCTION_COMPARISON_EXAMPLE.left, {
  operation: "compare_functions",
  path: ["left"],
});
if (!left.ok) throw left.error;
const right = parseFunctionEvidence(FUNCTION_COMPARISON_EXAMPLE.right, {
  operation: "compare_functions",
  path: ["right"],
});
if (!right.ok) throw right.error;
const comparison = compareFunctions(left.value, right.value);

export const FUNCTION_COMPARISON_EVIDENCE = createEvidence(
  undefined,
  FUNCTION_COMPARISON_PROVIDER,
  {
    predicateType: "rea.function-comparison",
    operation: "compare_functions",
    parameters: {
      left_evidence_id: left.value.evidence.evidence_id,
      right_evidence_id: right.value.evidence.evidence_id,
    },
    result: comparison,
    confidence: "derived",
    authority: "analyst-inference",
    limitations: comparison.limitations,
    evidenceLinks: [
      left.value.evidence.evidence_id,
      right.value.evidence.evidence_id,
    ],
  },
);

const capture = parseProcessCapture(EMPTY_PROCESS_CAPTURE_EXAMPLE);
const captureEvidence = (scenario: string) =>
  createEvidence(undefined, PROCESS_PROVIDER, {
    predicateType: "rea.process-capture",
    operation: "capture_process_scenario",
    parameters: { scenario },
    result: capture,
    confidence: "observed",
    authority: "controlled-replay",
    environment: {
      id: "fixture-linux",
      platform: "linux",
      architecture: "x86_64",
      isolation: "container",
    },
  });
export const PROCESS_CAPTURE_REFERENCE = captureEvidence("reference");
export const PROCESS_CAPTURE_RECONSTRUCTION = captureEvidence("reconstruction");
export const PROCESS_COMPARISON_EVIDENCE = compareProcessCaptureEvidence(
  { record: PROCESS_CAPTURE_REFERENCE, capture },
  { record: PROCESS_CAPTURE_RECONSTRUCTION, capture },
).evidence;

/** Canonical inputs for comparison-composed investigation contracts. */
export const INVESTIGATION_EXAMPLES = {
  compare_process_captures: {
    input: {
      left: PROCESS_CAPTURE_REFERENCE,
      right: PROCESS_CAPTURE_RECONSTRUCTION,
    },
  },
  find_changed_behavior: {
    comparisons: [
      {
        kind: "retained-evidence",
        evidence_id: FUNCTION_COMPARISON_EVIDENCE.evidence_id,
      },
    ],
  },
  build_call_path: {
    functions: [FUNCTION_COMPARISON_EXAMPLE.left],
    start: { address: "0x1000" },
    goal: { address: "0x1000" },
  },
  correlate_static_and_runtime: {
    static_comparisons: [FUNCTION_COMPARISON_EVIDENCE],
    runtime_comparisons: [PROCESS_COMPARISON_EVIDENCE],
    mappings: [
      {
        static: {
          comparison_evidence_id: FUNCTION_COMPARISON_EVIDENCE.evidence_id,
          selector: { kind: "function", dimension: "pseudocode" },
        },
        runtime: {
          comparison_evidence_id: PROCESS_COMPARISON_EVIDENCE.evidence_id,
          dimension: "terminal",
        },
        side_alignment: "left_to_left",
        hypothesis: {
          statement: "Static implementation changed without terminal change.",
          expected_pattern: "static_only",
        },
      },
    ],
  },
  verify_reconstruction: {
    specification: {
      name: "Terminal compatibility",
      claims: [
        {
          kind: "behavioral",
          claim_id: "terminal-output",
          title: "Terminal output remains equivalent",
          comparison_evidence_id: PROCESS_COMPARISON_EVIDENCE.evidence_id,
          dimension: "terminal",
        },
      ],
    },
  },
};
