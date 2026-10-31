import type { ProcessTraceSpecification } from "./processTraceSpecification.js";
import { compareProcessCaptures } from "./processComparison.js";
import { parseProcessCapture } from "./processCaptureParsing.js";
import { EMPTY_PROCESS_CAPTURE_EXAMPLE } from "./processCaptureExample.js";
import { hasCaptureTruncation } from "./processCaptureCoverage.js";
import { digestProcessCommitment } from "./processScenario.js";
import type { JsonValue } from "../jsonValue.js";

import {
  processCaptureSchema,
  type UnverifiedProcessCapture,
} from "./processCapture.js";

const finalizedScenario = {
  ...EMPTY_PROCESS_CAPTURE_EXAMPLE.manifest.scenario,
  finalization_ms: 1_500,
};
const finalizedComparisonContract = { finalization_ms: 1_500 };

/** Valid capture of a timeout that finalized: SIGTERM delivered, exit observed. */
export const FINALIZED_PROCESS_CAPTURE_EXAMPLE = {
  ...EMPTY_PROCESS_CAPTURE_EXAMPLE,
  manifest: {
    ...EMPTY_PROCESS_CAPTURE_EXAMPLE.manifest,
    scenario: finalizedScenario,
    comparison_contract: finalizedComparisonContract,
    full_scenario_sha256: digestProcessCommitment(finalizedScenario),
    comparison_contract_sha256: digestProcessCommitment(
      finalizedComparisonContract,
    ),
  },
  exit: {
    code: null,
    signal: 0,
    reason: "timeout",
    finalization: {
      requested_ms: 1_500,
      elapsed_ms: 12,
      exit_code: 0,
      signals: [{ signal: "SIGTERM", sent_at_ms: 0, delivery: "signaled" }],
    },
  },
} satisfies JsonValue;
/** Parse a detached valid empty capture for tests that need trusted evidence. */
export const emptyProcessCapture = () =>
  parseProcessCapture(EMPTY_PROCESS_CAPTURE_EXAMPLE);

/** Parse a mutable unverified capture for boundary-validation tests. */
export const emptyUnverifiedProcessCapture = (): UnverifiedProcessCapture =>
  processCaptureSchema.parse(EMPTY_PROCESS_CAPTURE_EXAMPLE);

/** Account for every observation retained by a fully observed test fixture. */
export const accountFullyObservedProcessCapture = (
  capture: UnverifiedProcessCapture,
): UnverifiedProcessCapture => {
  const rawBytes = capture.frames.reduce(
    (total, frame) => total + Buffer.byteLength(frame.raw_data ?? frame.data),
    0,
  );
  const renderedBytes = capture.rendered_frames.reduce(
    (total, frame) =>
      frame.lines.reduce(
        (sum, line) => sum + Buffer.byteLength(line),
        total + Buffer.byteLength(frame.serialized_state),
      ),
    0,
  );
  const filesystemBefore = {
    ...capture.truncation_details.filesystem_before,
    hashed_bytes: capture.files_before
      .filter((file) => file.type === "file" && file.sha256 !== null)
      .reduce((total, file) => total + file.size, 0),
  };
  const filesystemAfter = {
    ...capture.truncation_details.filesystem_after,
    hashed_bytes: capture.files_after
      .filter((file) => file.type === "file" && file.sha256 !== null)
      .reduce((total, file) => total + file.size, 0),
  };
  const truncationDetails = {
    ...capture.truncation_details,
    raw_terminal: {
      ...capture.truncation_details.raw_terminal,
      observed_bytes: rawBytes,
      retained_bytes: rawBytes,
      observed_frames: capture.frames.length,
      retained_frames: capture.frames.length,
    },
    rendered_terminal: {
      ...capture.truncation_details.rendered_terminal,
      observed_bytes: renderedBytes,
      retained_bytes: renderedBytes,
      observed_frames: capture.rendered_frames.length,
      retained_frames: capture.rendered_frames.length,
    },
    filesystem_before: filesystemBefore,
    filesystem_after: filesystemAfter,
    process: {
      ...capture.truncation_details.process,
      sample_limit: Math.max(
        capture.truncation_details.process.sample_limit,
        capture.process_samples.length,
      ),
      retained_samples: capture.process_samples.length,
    },
  };
  const filesystemCheckpoints = capture.filesystem_checkpoints.map(
    (checkpoint, index) => {
      const coverage = index === 0 ? filesystemBefore : filesystemAfter;
      return {
        ...checkpoint,
        truncated:
          coverage.enumeration_truncated || coverage.hash_omissions.length > 0,
      };
    },
  );
  return {
    ...capture,
    filesystem_checkpoints: filesystemCheckpoints,
    truncation_details: truncationDetails,
    truncated: hasCaptureTruncation(truncationDetails),
  };
};

/** Project validation failures without coupling tests to Zod internals. */
export const processCaptureIssues = (
  capture: UnverifiedProcessCapture,
): readonly { readonly path: string; readonly message: string }[] => {
  const parsed = processCaptureSchema.safeParse(capture);
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
};

/** Compare unverified fixture values through the production parser. */
export const compareUnverifiedProcessCaptures = (
  left: UnverifiedProcessCapture,
  right: UnverifiedProcessCapture,
  options?: Parameters<typeof compareProcessCaptures>[2],
): ReturnType<typeof compareProcessCaptures> =>
  compareProcessCaptures(
    parseProcessCapture(left),
    parseProcessCapture(right),
    options,
  );

/** One journal and its matching declared trace, shared by domain and adapter checks. */
export const processTraceCaptureFixture = () => {
  const capture = {
    ...EMPTY_PROCESS_CAPTURE_EXAMPLE,
    event_journal: [
      { capture_order: 0, collection: "filesystem_checkpoints", index: 0 },
      { capture_order: 1, collection: "lifecycle", index: 0 },
      { capture_order: 2, collection: "lifecycle", index: 1 },
      { capture_order: 3, collection: "filesystem_checkpoints", index: 1 },
    ],
  } as const;
  const [before, after] = capture.filesystem_checkpoints;
  if (before === undefined || after === undefined)
    throw new Error(
      "Trace fixture requires before and after filesystem checkpoints",
    );
  const traceSpecification: ProcessTraceSpecification = {
    events: [
      {
        id: "before",
        source: "filesystem",
        exact: before,
        cardinality: { kind: "required" },
      },
      {
        id: "exit",
        source: "lifecycle",
        exact: { event: "exit", ...capture.exit },
        cardinality: { kind: "required" },
      },
      {
        id: "settlement",
        source: "lifecycle",
        exact: { event: "settlement", ...capture.settlement },
        cardinality: { kind: "required" },
      },
      {
        id: "after",
        source: "filesystem",
        exact: after,
        cardinality: { kind: "required" },
      },
    ],
    language: {
      kind: "finite_traces",
      variants: [
        { id: "normal", trace: ["before", "exit", "settlement", "after"] },
      ],
    },
  };
  return { capture, traceSpecification };
};
