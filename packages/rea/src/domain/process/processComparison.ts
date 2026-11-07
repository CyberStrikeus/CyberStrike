import canonicalize from "canonicalize";
import { z } from "zod";
import { processSourceTruncated } from "./processCaptureCoverage.js";
import { symlinkTargetIdentity } from "./symlinkTarget.js";
import type {
  ProcessObservationLocation,
  ProcessObservationSource,
} from "./processObservation.js";

import type { ProcessCapture } from "./processCaptureParsing.js";
import { comparableTerminalFrame } from "./processObservation.js";
import { AnalysisInputError } from "../analysisErrorCore.js";
import { jsonValueSchema } from "../jsonValue.js";
import type { ProcessTraceSpecification } from "./processTraceSpecification.js";
import { processTraceComparisonResultSchema } from "./processTraceEvaluation.js";
import {
  dimensionsForTraceSources,
  traceCoversObservedDimension,
} from "./processTraceDimensionProjection.js";

import {
  evaluateProcessTraceComparison,
  processTraceOutcomesDiffer,
} from "./processTraceComparison.js";
const OPERATION = "compare_process_captures";

/** Comparison classification that never equates incomplete evidence. */
export const comparisonStatusSchema = z.enum([
  "unchanged",
  "added",
  "removed",
  "changed",
  "truncated",
  "unknown",
  "contradiction",
]);
type ComparisonStatus = z.infer<typeof comparisonStatusSchema>;

/** Canonical ordered dimensions that contribute to an overall process status. */
export const PROCESS_COMPARISON_DIMENSIONS = [
  "terminal",
  "interaction",
  "exit",
  "filesystem",
  "process",
] as const;
export type ProcessComparisonDimension =
  (typeof PROCESS_COMPARISON_DIMENSIONS)[number];

/** Caller-selected comparison policy; the clock is not persisted as policy. */
export interface ProcessCaptureComparisonOptions {
  readonly maxCaptureAgeMs?: number;
  readonly now?: () => number;
  readonly traceSpecification?: ProcessTraceSpecification;
}

/** Derive the overall comparison status from every process dimension. */
export const deriveProcessComparisonStatus = (
  dimensions: readonly ComparisonStatus[],
): ComparisonStatus => {
  if (dimensions.includes("truncated")) return "truncated";
  if (dimensions.includes("contradiction")) return "contradiction";
  if (
    dimensions.some((status) =>
      ["changed", "added", "removed"].includes(status),
    )
  )
    return "changed";
  return dimensions.includes("unknown") ? "unknown" : "unchanged";
};

/** Pure normalized comparison between two captures. */
export const processCaptureComparisonSchema = z
  .object({
    status: comparisonStatusSchema,
    terminal: comparisonStatusSchema,
    interaction: comparisonStatusSchema,
    exit: comparisonStatusSchema,
    filesystem: comparisonStatusSchema,
    process: comparisonStatusSchema,
    first_divergence: z.discriminatedUnion("status", [
      z.object({ status: z.literal("none") }),
      z.object({ status: z.literal("unknown"), reason: z.string() }),
      z.object({
        status: z.literal("found"),
        dimension: z.enum(PROCESS_COMPARISON_DIMENSIONS),
        index: z.int().nonnegative(),
        left_at_ms: z.int().nonnegative().nullable(),
        right_at_ms: z.int().nonnegative().nullable(),
        left: jsonValueSchema.nullable(),
        right: jsonValueSchema.nullable(),
      }),
    ]),
    trace: processTraceComparisonResultSchema.optional(),
    limitations: z.array(z.string()),
  })
  .superRefine((comparison, context) => {
    const expected = deriveProcessComparisonStatus(
      PROCESS_COMPARISON_DIMENSIONS.map((dimension) => comparison[dimension]),
    );
    if (comparison.status !== expected)
      context.addIssue({
        code: "custom",
        message: "Process comparison status contradicts its dimensions",
        path: ["status"],
      });
  });
export type ProcessCaptureComparison = z.infer<
  typeof processCaptureComparisonSchema
>;

const terminalObservations = (capture: ProcessCapture): readonly unknown[] =>
  [
    ...capture.frames.map((frame) => ({
      kind: "raw" as const,
      ...comparableTerminalFrame(frame),
    })),
    ...capture.rendered_frames.map((frame) => ({
      kind: "rendered" as const,
      ...frame,
    })),
  ].sort((left, right) => {
    const time = left.at_ms - right.at_ms;
    if (time !== 0) return time;
    if (left.kind !== right.kind) return left.kind === "raw" ? -1 : 1;
    return left.sequence - right.sequence;
  });

const sameJsonValue = (left: unknown, right: unknown): boolean => {
  const encodedLeft = canonicalize(left);
  return encodedLeft !== undefined && encodedLeft === canonicalize(right);
};

/** Canonical observations for one process-comparison dimension. */
export const processDimensionObservations = (
  capture: ProcessCapture,
  dimension: (typeof PROCESS_COMPARISON_DIMENSIONS)[number],
): readonly unknown[] => {
  switch (dimension) {
    case "terminal":
      return terminalObservations(capture);
    case "interaction":
      return capture.interaction_events;
    case "exit":
      return [{ ...capture.exit, settlement: capture.settlement }];
    case "filesystem":
      return capture.filesystem_checkpoints;
    case "process":
      return capture.process_samples;
  }
};

const classifyCollection = (
  left: readonly unknown[],
  right: readonly unknown[],
): ComparisonStatus => {
  if (sameJsonValue(left, right)) return "unchanged";
  if (left.length === 0) return "added";
  if (right.length === 0) return "removed";
  return "changed";
};

const hasUnknown = (
  capture: ProcessCapture,
  scope: ProcessCapture["residual_unknowns"][number]["scope"],
): boolean => capture.residual_unknowns.some((item) => item.scope === scope);

const hasUnknownFilesystemEffects = (capture: ProcessCapture): boolean =>
  capture.filesystem_effects.some(({ status }) => status === "unknown") ||
  capture.filesystem_checkpoints.some(({ effects }) =>
    effects.some(({ status }) => status === "unknown"),
  );

/** A missing descendant is evidence only under an observed, fully enumerated root. */
const checkpointProvesAbsence = (
  capture: ProcessCapture,
  checkpoint: ProcessCapture["filesystem_checkpoints"][number],
  path: string,
  files: ReadonlyMap<string, ProcessCapture["files_after"][number]>,
): boolean => {
  const colon = path.indexOf(":");
  if (colon < 1) return false;
  const root = `${path.slice(0, colon)}:.`;
  const coverage =
    checkpoint.name === "before"
      ? capture.truncation_details.filesystem_before
      : checkpoint.name === "after_settlement"
        ? capture.truncation_details.filesystem_after
        : undefined;
  if (
    coverage === undefined ||
    coverage.enumeration_truncated ||
    coverage.unobserved_subtrees === undefined ||
    files.get(root)?.type !== "directory"
  )
    return false;
  return !coverage.unobserved_subtrees.some(({ path: subtree, reason }) =>
    subtree === root
      ? path !== root
      : path.startsWith(`${subtree}/`) ||
        path.startsWith(`${subtree}\\`) ||
        (reason === "observer_owned" && path === subtree),
  );
};

/** Compare observed facts independently of unrelated unknown effects. */
const hasKnownFilesystemDifference = (
  left: ProcessCapture,
  right: ProcessCapture,
): boolean =>
  left.filesystem_checkpoints.some((checkpoint) => {
    const peer = right.filesystem_checkpoints.find(
      ({ name }) => name === checkpoint.name,
    );
    if (peer === undefined) return false;
    const files = new Map(peer.files.map((file) => [file.path, file]));
    return checkpoint.files.some((file) => {
      const other = files.get(file.path);
      if (other === undefined)
        return checkpointProvesAbsence(right, peer, file.path, files);
      if (
        file.type !== other.type ||
        file.mode !== other.mode ||
        file.size !== other.size
      )
        return true;
      if (file.type === "file" && other.type === "file")
        return (
          file.sha256 !== null &&
          other.sha256 !== null &&
          file.sha256 !== other.sha256
        );
      if (file.type === "symlink" && other.type === "symlink") {
        const leftTarget = symlinkTargetIdentity(file);
        const rightTarget = symlinkTargetIdentity(other);
        if (leftTarget !== null && rightTarget !== null)
          return leftTarget !== rightTarget;
        return (
          file.symlink_target !== null &&
          other.symlink_target !== null &&
          file.symlink_target !== other.symlink_target
        );
      }
      return false;
    });
  }) ||
  right.filesystem_checkpoints.some((checkpoint) => {
    const peer = left.filesystem_checkpoints.find(
      ({ name }) => name === checkpoint.name,
    );
    if (peer === undefined) return false;
    const files = new Map(peer.files.map((file) => [file.path, file]));
    return checkpoint.files.some(
      ({ path }) =>
        !files.has(path) && checkpointProvesAbsence(left, peer, path, files),
    );
  });

type DivergenceDimension = Exclude<
  ProcessCaptureComparison["first_divergence"],
  { readonly status: "none" | "unknown" }
>["dimension"];

// Interactions record when their outcome was observed as the dispatch time;
// every other timed observation uses at_ms.
const EVENT_TIME_FIELD: Readonly<Record<DivergenceDimension, string>> = {
  terminal: "at_ms",
  interaction: "dispatched_at_ms",
  exit: "at_ms",
  filesystem: "at_ms",
  process: "at_ms",
};

const eventTime = (
  dimension: DivergenceDimension,
  value: unknown,
): number | null => {
  if (typeof value !== "object" || value === null) return null;
  const time: unknown = Reflect.get(value, EVENT_TIME_FIELD[dimension]);
  return typeof time === "number" && Number.isSafeInteger(time) && time >= 0
    ? time
    : null;
};

const firstCollectionDivergence = (
  dimension: DivergenceDimension,
  left: readonly unknown[],
  right: readonly unknown[],
): Extract<
  ProcessCaptureComparison["first_divergence"],
  { readonly status: "found" }
> | null => {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? null;
    const rightValue = right[index] ?? null;
    if (sameJsonValue(leftValue, rightValue)) continue;
    return {
      status: "found",
      dimension,
      index,
      left_at_ms: eventTime(dimension, leftValue),
      right_at_ms: eventTime(dimension, rightValue),
      left: jsonValueSchema.parse(leftValue),
      right: jsonValueSchema.parse(rightValue),
    };
  }
  return null;
};

const chooseFirstDivergence = (
  candidates: ReadonlyArray<Extract<
    ProcessCaptureComparison["first_divergence"],
    { readonly status: "found" }
  > | null>,
): ProcessCaptureComparison["first_divergence"] => {
  const found = candidates.filter(
    (candidate): candidate is NonNullable<typeof candidate> =>
      candidate !== null,
  );
  return (
    found.sort((left, right) => {
      const leftTime = Math.min(
        left.left_at_ms ?? Number.MAX_SAFE_INTEGER,
        left.right_at_ms ?? Number.MAX_SAFE_INTEGER,
      );
      const rightTime = Math.min(
        right.left_at_ms ?? Number.MAX_SAFE_INTEGER,
        right.right_at_ms ?? Number.MAX_SAFE_INTEGER,
      );
      return leftTime - rightTime;
    })[0] ?? { status: "none" }
  );
};

const assertComparable = (
  left: ProcessCapture,
  right: ProcessCapture,
  options: { readonly maxCaptureAgeMs?: number; readonly now?: () => number },
): void => {
  if (
    left.manifest.comparison_contract_sha256 !==
    right.manifest.comparison_contract_sha256
  ) {
    const fields = differingContractFields(
      left.manifest.comparison_contract,
      right.manifest.comparison_contract,
    );
    throw new AnalysisInputError(OPERATION, undefined, [
      {
        path: ["right"],
        reason: "invalid_value",
        message: `Process captures have incompatible comparison contracts${fields.length === 0 ? "" : `; these scenario fields differ: ${fields.join(", ")}`}. Capture both scenarios with the same values for these fields, then compare them.`,
        expected: fields,
      },
    ]);
  }
  if (options.maxCaptureAgeMs === undefined) return;
  const maxCaptureAgeMs = options.maxCaptureAgeMs;
  const now = (options.now ?? Date.now)();
  const stale = (
    [
      ["left", left],
      ["right", right],
    ] as const
  ).flatMap(([side, { manifest }]) => {
    const age = now - Date.parse(manifest.completed_at);
    return age > maxCaptureAgeMs
      ? [
          `${side} completed at ${manifest.completed_at} (${String(age)} ms ago)`,
        ]
      : [];
  });
  if (stale.length > 0)
    throw new AnalysisInputError(OPERATION, undefined, [
      {
        path: ["max_capture_age_ms"],
        reason: "out_of_range",
        message: `Process capture exceeds max_capture_age_ms ${String(maxCaptureAgeMs)}: ${stale.join("; ")}. Recapture the stale scenario or raise max_capture_age_ms.`,
      },
    ]);
};

/** Name top-level contract fields whose canonical values differ. */
const differingContractFields = (
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): string[] =>
  [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter(
      (field) =>
        !Object.hasOwn(left, field) ||
        !Object.hasOwn(right, field) ||
        canonicalize(left[field]) !== canonicalize(right[field]),
    )
    .sort();

const LOCATION_SOURCES = {
  frames: "terminal_raw",
  rendered_frames: "terminal_rendered",
  interaction_events: "interaction",
  lifecycle: "lifecycle",
  process_samples: "process",
  filesystem_checkpoints: "filesystem",
} as const satisfies Record<
  ProcessObservationLocation["collection"],
  ProcessObservationSource
>;

const applyTraceVerdict = (
  dimensions: ComparisonDimensions,
  specification: ProcessTraceSpecification,
  evaluation: ReturnType<typeof evaluateProcessTraceComparison>,
  captures: readonly [left: ProcessCapture, right: ProcessCapture],
): ComparisonDimensions => {
  const { result: trace, diagnostics } = evaluation;
  const traceShowsDifference = processTraceOutcomesDiffer(trace);
  const traceStatus =
    trace.verdict === "unknown"
      ? "unknown"
      : trace.verdict === "equivalent" || !traceShowsDifference
        ? "unchanged"
        : "changed";
  const sources = new Set(specification.events.map(({ source }) => source));
  const covered = dimensionsForTraceSources(sources);
  // A different verdict names the failing events and observations; attribute
  // it only to their dimensions; unrelated comparisons keep their own status,
  // including unknown coverage and independently observed additions/removals.
  const diagnosticSources = new Set<ProcessObservationSource>(
    diagnostics.flatMap((diagnostic) => [
      ...specification.events
        .filter(({ id }) => diagnostic.event_ids.includes(id))
        .map(({ source }) => source),
      ...diagnostic.locations.map(
        ({ collection }) => LOCATION_SOURCES[collection],
      ),
    ]),
  );
  const attributed =
    diagnosticSources.size > 0
      ? dimensionsForTraceSources(diagnosticSources)
      : covered;
  const statusFor = (
    dimension: (typeof PROCESS_COMPARISON_DIMENSIONS)[number],
  ): ComparisonStatus => {
    const exact = dimensions[dimension];
    if (!covered.has(dimension)) return exact;
    if (trace.verdict === "nonconforming") return exact;
    if (trace.verdict === "different")
      return traceShowsDifference && attributed.has(dimension)
        ? "changed"
        : exact;
    if (
      dimension === "filesystem" &&
      captures.some(hasUnknownFilesystemEffects)
    )
      return exact;
    if (
      trace.verdict === "unknown" &&
      ["changed", "added", "removed"].includes(exact)
    )
      return exact;
    return traceCoversObservedDimension(
      dimension,
      sources,
      captures[0],
      captures[1],
    )
      ? traceStatus
      : exact;
  };
  return {
    terminal: statusFor("terminal"),
    interaction: statusFor("interaction"),
    exit: statusFor("exit"),
    filesystem: statusFor("filesystem"),
    process: statusFor("process"),
  };
};

type ComparisonDimensions = Pick<
  ProcessCaptureComparison,
  ProcessComparisonDimension
>;

const compareDimensions = (
  left: ProcessCapture,
  right: ProcessCapture,
  sameNormalization: boolean,
): ComparisonDimensions => {
  const classify = (
    dimension: ProcessComparisonDimension,
    source: ProcessObservationSource,
  ): ComparisonStatus =>
    !sameNormalization ||
    hasUnknown(left, dimension) ||
    hasUnknown(right, dimension) ||
    (dimension === "filesystem" &&
      (hasUnknownFilesystemEffects(left) ||
        hasUnknownFilesystemEffects(right)) &&
      !hasKnownFilesystemDifference(left, right)) ||
    processSourceTruncated(left, source) ||
    processSourceTruncated(right, source)
      ? "unknown"
      : classifyCollection(
          processDimensionObservations(left, dimension),
          processDimensionObservations(right, dimension),
        );
  return {
    terminal: classify("terminal", "terminal_rendered"),
    interaction: classify("interaction", "interaction"),
    exit:
      hasUnknown(left, "exit") || hasUnknown(right, "exit")
        ? "unknown"
        : sameJsonValue(
              processDimensionObservations(left, "exit"),
              processDimensionObservations(right, "exit"),
            )
          ? "unchanged"
          : "changed",
    filesystem: classify("filesystem", "filesystem"),
    process: classify("process", "process"),
  };
};

/**
 * Compare two process capture observations without treating absence as proof.
 *
 * Observed differences outrank residual unknowns. A capture may therefore be
 * definitively changed in one dimension while completeness remains unknown.
 */
export const compareProcessCaptures = (
  left: ProcessCapture,
  right: ProcessCapture,
  options: ProcessCaptureComparisonOptions = {},
): ProcessCaptureComparison => {
  assertComparable(left, right, options);
  const sameNormalization = sameJsonValue(
    left.normalization,
    right.normalization,
  );
  const exactDimensions = compareDimensions(left, right, sameNormalization);
  const traceEvaluation =
    options.traceSpecification === undefined
      ? undefined
      : evaluateProcessTraceComparison(left, right, options.traceSpecification);
  const trace = traceEvaluation?.result;
  const dimensions =
    traceEvaluation === undefined || options.traceSpecification === undefined
      ? exactDimensions
      : applyTraceVerdict(
          exactDimensions,
          options.traceSpecification,
          traceEvaluation,
          [left, right],
        );
  const divergenceCandidates = PROCESS_COMPARISON_DIMENSIONS.map((dimension) =>
    dimensions[dimension] === "unknown"
      ? null
      : firstCollectionDivergence(
          dimension,
          processDimensionObservations(left, dimension),
          processDimensionObservations(right, dimension),
        ),
  );
  const observedFirstDivergence = chooseFirstDivergence(
    divergenceCandidates.map((candidate) =>
      candidate !== null &&
      trace?.verdict === "equivalent" &&
      dimensions[candidate.dimension] === "unchanged"
        ? null
        : candidate,
    ),
  );
  const firstDivergence =
    left.truncated || right.truncated
      ? ({
          status: "unknown",
          reason:
            "Incomplete observations prevent locating the first divergence; unaffected dimensions retain their comparisons.",
        } as const)
      : hasUnknownFilesystemEffects(left) || hasUnknownFilesystemEffects(right)
        ? ({
            status: "unknown",
            reason:
              "Unresolved filesystem effects prevent locating the first divergence, even when another change is observed.",
          } as const)
        : trace?.verdict === "equivalent" &&
            deriveProcessComparisonStatus(
              PROCESS_COMPARISON_DIMENSIONS.map(
                (dimension) => dimensions[dimension],
              ),
            ) === "unchanged"
          ? ({ status: "none" } as const)
          : observedFirstDivergence.status === "found"
            ? observedFirstDivergence
            : trace?.verdict === "different" || trace?.verdict === "unknown"
              ? ({
                  status: "unknown",
                  reason:
                    "The declared trace differs or has insufficient journal evidence; per-source observations cannot locate its first cross-source divergence.",
                } as const)
              : !sameNormalization ||
                  left.residual_unknowns.length > 0 ||
                  right.residual_unknowns.length > 0
                ? ({
                    status: "unknown",
                    reason:
                      "Residual unknowns prevent proving that no divergence occurred.",
                  } as const)
                : observedFirstDivergence;
  const observedStatus = deriveProcessComparisonStatus(
    PROCESS_COMPARISON_DIMENSIONS.map((dimension) => dimensions[dimension]),
  );
  return {
    status: observedStatus,
    ...dimensions,
    first_divergence: firstDivergence,
    ...(trace === undefined ? {} : { trace }),
    limitations: [
      ...left.limitations,
      ...right.limitations,
      ...left.residual_unknowns.map(({ reason }) => reason),
      ...right.residual_unknowns.map(({ reason }) => reason),
      ...(sameNormalization ? [] : ["Capture normalization rules differ."]),
    ],
  };
};
