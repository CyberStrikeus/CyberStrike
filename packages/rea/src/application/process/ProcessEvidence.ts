import type { z } from "zod";
import { posix, win32 } from "node:path";

import type { JsonValue } from "../../domain/jsonValue.js";
import {
  createEvidence,
  type EvidenceProvider,
} from "../../domain/evidence.js";
import {
  PROCESS_PROVIDER,
  isProcessEvidenceProvider,
} from "../../domain/process/processEvidenceProvider.js";
import {
  safeParseProcessCapture,
  type ProcessCapture,
} from "../../domain/process/processCaptureParsing.js";
import { safeParseEvidence } from "../../domain/evidenceValidation.js";
import type { ProcessScenario } from "../../domain/process/processScenario.js";
import type { ParsedProcessCaptureEvidence } from "../../domain/process/processComparisonEvidence.js";
import { err, ok, type Result } from "../../domain/result.js";

const PROCESS_CAPTURE_EVIDENCE = {
  operation: "capture_process_scenario",
  predicate: "rea.process-capture",
} as const;

/** Semantic rejection facts; CLI and MCP retain their own error projections. */
export type ProcessCaptureEvidenceFailure =
  | { readonly kind: "invalid-evidence"; readonly cause: z.ZodError }
  | {
      readonly kind: "wrong-workflow";
      readonly expected: typeof PROCESS_CAPTURE_EVIDENCE;
      readonly actual: {
        readonly operation: string;
        readonly predicate: string;
      };
    }
  | {
      readonly kind: "unsupported-provider";
      readonly provider: EvidenceProvider;
    }
  | { readonly kind: "invalid-capture"; readonly cause: z.ZodError };

/** Authenticate capture Evidence before admitting its workflow, provider and payload. */
export const parseProcessCaptureEvidence = (
  input: unknown,
): Result<ParsedProcessCaptureEvidence, ProcessCaptureEvidenceFailure> => {
  const parsedEvidence = safeParseEvidence(input);
  if (!parsedEvidence.ok)
    return err({ kind: "invalid-evidence", cause: parsedEvidence.error });
  const record = parsedEvidence.value;
  if (
    record.operation !== PROCESS_CAPTURE_EVIDENCE.operation ||
    record.predicate_type !== PROCESS_CAPTURE_EVIDENCE.predicate
  )
    return err({
      kind: "wrong-workflow",
      expected: PROCESS_CAPTURE_EVIDENCE,
      actual: { operation: record.operation, predicate: record.predicate_type },
    });
  if (!isProcessEvidenceProvider(record.provider))
    return err({ kind: "unsupported-provider", provider: record.provider });
  const parsedCapture = safeParseProcessCapture(record.normalized_result);
  return parsedCapture.success
    ? ok({ record, capture: parsedCapture.data })
    : err({ kind: "invalid-capture", cause: parsedCapture.error });
};

/** Project one process scenario into secret-free Evidence parameters. */
const processEvidenceParameters = (
  scenario: ProcessScenario,
  platform: ProcessCapture["manifest"]["platform"],
): Readonly<Record<string, JsonValue>> => ({
  executable_name: (platform === "win32" ? win32 : posix).basename(
    scenario.executable,
  ),
  argument_count: scenario.arguments.length,
  event_count: scenario.events.length,
  filesystem_observation_path_count:
    scenario.filesystem_observation_paths.length,
  normalization: scenario.normalization,
});

/** Create one canonical observed process capture Evidence record. */
export const createProcessCaptureEvidence = (
  scenario: ProcessScenario,
  capture: ProcessCapture,
) => {
  return createEvidence(undefined, PROCESS_PROVIDER, {
    predicateType: PROCESS_CAPTURE_EVIDENCE.predicate,
    operation: PROCESS_CAPTURE_EVIDENCE.operation,
    parameters: processEvidenceParameters(scenario, capture.manifest.platform),
    result: capture,
    confidence: "observed",
    authority: "controlled-replay",
    environment: {
      id: `${capture.manifest.platform}-${capture.manifest.architecture}`,
      platform: capture.manifest.platform,
      architecture: capture.manifest.architecture,
      isolation: "process",
    },
    limitations: capture.limitations,
  });
};
