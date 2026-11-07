import {
  digestProcessCommitment,
  processScenarioOutputBudgetProjectionSchema,
} from "./processScenario.js";
import { hasCaptureTruncation } from "./processCaptureCoverage.js";

import type {
  ProcessCaptureFinalization,
  UnverifiedProcessCapture,
} from "./processCapture.js";
/** One pure semantic validation failure in a shaped process capture. */
export interface ProcessCaptureValidationIssue {
  readonly path: string;
  readonly message: string;
}

type RequireInvariant = (
  condition: boolean,
  path: string,
  message: string,
) => void;

const orderedTimestamps = (values: readonly number[]): boolean =>
  values.every((value, index) => {
    const previous = values[index - 1];
    return previous === undefined || value >= previous;
  });

const validateCommitments = (
  capture: UnverifiedProcessCapture,
  require: RequireInvariant,
): void => {
  const { manifest } = capture;
  require(manifest.scenario.executable_sha256 ===
    manifest.selected_executable_sha256, "manifest.selected_executable_sha256", "selected executable commitment does not match the scenario projection");
  require(manifest.executable_identity.state === "path_metadata_unchanged"
    ? manifest.executable_sha256 === manifest.selected_executable_sha256 &&
        manifest.executable_identity.reason === null
    : manifest.executable_sha256 === null &&
        manifest.executable_identity.reason !==
          null, "manifest.executable_identity", "launch identity and executable digest do not agree");
  for (const [field, value] of [
    ["full_scenario_sha256", manifest.scenario],
    ["comparison_contract_sha256", manifest.comparison_contract],
    ["normalization_sha256", capture.normalization],
  ] as const)
    require(manifest[field] ===
      digestProcessCommitment(
        value,
      ), `manifest.${field}`, "commitment does not match its canonical value");
};

const validateOrdering = (
  capture: UnverifiedProcessCapture,
  require: RequireInvariant,
): void => {
  for (const [name, values] of [
    ["frames", capture.frames],
    ["rendered_frames", capture.rendered_frames],
    ["interaction_events", capture.interaction_events],
  ] as const)
    require(values.every(
      ({ sequence }, index) => sequence === index,
    ), name, "sequence values must be contiguous from zero");
  for (const [name, values] of [
    ["frames", capture.frames],
    ["rendered_frames", capture.rendered_frames],
    ["process_samples", capture.process_samples],
  ] as const)
    require(orderedTimestamps(
      values.map(({ at_ms }) => at_ms),
    ), name, "timestamps must be ordered");
  // Interactions are dispatched in sequence, so their recorded dispatch
  // times cannot decrease; comparison ranks a changed interaction by it.
  require(orderedTimestamps(
    capture.interaction_events.map(({ dispatched_at_ms }) => dispatched_at_ms),
  ), "interaction_events", "dispatch timestamps must be ordered");
};

const validateEventJournal = (
  capture: UnverifiedProcessCapture,
  require: RequireInvariant,
): void => {
  const journal = capture.event_journal;
  if (journal.length === 0) return;
  const sizes = {
    frames: capture.frames.length,
    rendered_frames: capture.rendered_frames.length,
    interaction_events: capture.interaction_events.length,
    lifecycle: 2,
    process_samples: capture.process_samples.length,
    filesystem_checkpoints: capture.filesystem_checkpoints.length,
  };
  const references = new Set<string>();
  for (const [position, entry] of journal.entries()) {
    require(entry.capture_order ===
      position, `event_journal.${String(position)}.capture_order`, "capture order must be contiguous from zero");
    require(entry.index <
      sizes[
        entry.collection
      ], `event_journal.${String(position)}.index`, "journal reference is outside its capture collection");
    const reference = `${entry.collection}:${String(entry.index)}`;
    require(!references.has(
      reference,
    ), `event_journal.${String(position)}`, "journal references must be unique");
    references.add(reference);
  }
  const expectedSize = Object.values(sizes).reduce(
    (total, size) => total + size,
    0,
  );
  require(journal.length ===
    expectedSize, "event_journal", "nonempty journal must reference every captured observation");
};

/**
 * The committed comparison contract carries `finalization_ms` exactly when the
 * committed scenario does, with the same value. Independent of the exit, so a
 * partial capture with an unavailable exit is still checked.
 */
export const finalizationManifestIssue = (
  committedScenario?: Readonly<Record<string, unknown>>,
  committedComparison?: Readonly<Record<string, unknown>>,
): string | undefined =>
  committedScenario !== undefined &&
  committedComparison !== undefined &&
  committedScenario["finalization_ms"] !==
    committedComparison["finalization_ms"]
    ? "comparison_contract finalization_ms must match the committed scenario"
    : undefined;

type FinalizationAttempts = Pick<
  ProcessCaptureFinalization,
  "requested_ms" | "elapsed_ms" | "exit_code"
> & {
  readonly signals: readonly Pick<
    ProcessCaptureFinalization["signals"][number],
    "signal" | "sent_at_ms"
  >[];
};

/** Ensure incomplete exit and sibling finalization observations preserve one fact. */
export const finalizationAgreementIssue = (
  exitFinalization: ProcessCaptureFinalization | undefined,
  observedFinalization: ProcessCaptureFinalization | undefined,
): string | undefined =>
  exitFinalization !== undefined &&
  observedFinalization !== undefined &&
  JSON.stringify(exitFinalization) !== JSON.stringify(observedFinalization)
    ? "exit finalization and finalization observation must agree"
    : undefined;

/**
 * Cross-field rule for `exit.finalization`, shared by complete and partial
 * captures. Returns the violated rule, or undefined when the record is
 * consistent.
 */
export const finalizationConsistencyIssue = (
  exit:
    | {
        readonly reason: string;
        readonly signal?: number | null | undefined;
        readonly finalization?: FinalizationAttempts | undefined;
      }
    | undefined,
  committedScenario?: Readonly<Record<string, unknown>>,
  committedComparison?: Readonly<Record<string, unknown>>,
  options?: {
    readonly finalization?: FinalizationAttempts;
    readonly allowNullElapsedMs?: boolean;
  },
): string | undefined => {
  const manifestIssue = finalizationManifestIssue(
    committedScenario,
    committedComparison,
  );
  if (manifestIssue !== undefined) return manifestIssue;
  const finalization = exit?.finalization ?? options?.finalization;
  if (finalization === undefined) {
    // A deadline that fired under a committed interval must have attempted
    // finalization; cancellation before the deadline legitimately has none.
    const committed = committedScenario?.["finalization_ms"];
    return (exit?.reason === "timeout" || exit?.reason === "idle_timeout") &&
      typeof committed === "number" &&
      committed > 0
      ? "a deadline exit under a committed finalization_ms requires finalization evidence"
      : undefined;
  }
  if (exit?.reason === "exited")
    return "finalization requires a deadline exit reason";
  const first = finalization.signals[0];
  if (first?.signal !== "SIGTERM")
    return "finalization signals must start with SIGTERM";
  const killIndexes = finalization.signals.flatMap(({ signal }, index) =>
    signal === "SIGKILL" ? [index] : [],
  );
  if (
    killIndexes.length > 1 ||
    (killIndexes[0] !== undefined &&
      killIndexes[0] !== finalization.signals.length - 1)
  )
    return "finalization may contain at most one final SIGKILL";
  if (
    !finalization.signals.every(({ sent_at_ms }, index) => {
      const previous = finalization.signals[index - 1];
      return previous === undefined || sent_at_ms >= previous.sent_at_ms;
    })
  )
    return "finalization signal attempt times must not decrease";
  if (
    finalization.signals.filter(({ signal }) => signal === "SIGTERM").length !==
    1
  )
    return "finalization must attempt SIGTERM exactly once";
  const kill = finalization.signals.find(({ signal }) => signal === "SIGKILL");
  if (
    kill !== undefined &&
    kill.sent_at_ms < finalization.requested_ms &&
    exit !== undefined &&
    exit.reason !== "cancelled"
  )
    return "finalization SIGKILL cannot precede the requested interval";
  if (finalization.elapsed_ms === null && options?.allowNullElapsedMs !== true)
    return "finalization requires an observed elapsed_ms";
  if (
    finalization.exit_code !== null &&
    exit?.signal !== undefined &&
    exit.signal !== null &&
    exit.signal !== 0
  )
    return "finalization exit_code requires an exit not caused by a signal";
  if (
    finalization.elapsed_ms !== null &&
    finalization.elapsed_ms <
      (finalization.signals.at(-1)?.sent_at_ms ?? first.sent_at_ms)
  )
    return "finalization elapsed_ms cannot precede the last signal attempt";
  if (
    committedScenario !== undefined &&
    committedScenario["finalization_ms"] !== finalization.requested_ms
  )
    return "finalization must match the committed finalization_ms";
  return undefined;
};

const validateLifecycle = (
  capture: UnverifiedProcessCapture,
  require: RequireInvariant,
): void => {
  require(capture.filesystem_checkpoints.map(({ name }) => name).join(",") ===
    "before,after_settlement", "filesystem_checkpoints", "capture must include initial and final filesystem snapshots");
  require(orderedTimestamps(
    capture.filesystem_checkpoints.map(({ at_ms }) => at_ms),
  ), "filesystem_checkpoints", "filesystem snapshot times must be ordered");
  require(!capture.filesystem_checkpoints.some(({ truncated }) => truncated) ||
    capture.truncated, "truncated", "filesystem snapshot truncation must propagate to the capture");
  require(capture.exit.reason === "exited" ||
    capture.exit.code ===
      null, "exit", "deadline termination cannot declare a normal exit code");
  const finalizationIssue = finalizationConsistencyIssue(
    capture.exit,
    capture.manifest.scenario,
    capture.manifest.comparison_contract,
  );
  require(finalizationIssue === undefined, "exit", finalizationIssue ?? "");
};

const validateCoverage = (
  capture: UnverifiedProcessCapture,
  require: RequireInvariant,
): void => {
  const details = capture.truncation_details;
  require(details.process.retained_samples === capture.process_samples.length &&
    details.process.retained_samples <= details.process.sample_limit &&
    details.process.sampling_partial ===
      (details.process.sample_limit_reached ||
        details.process.sampling_failures > 0) &&
    (details.process.sampling_failures === 0) ===
      (details.process.first_sampling_failure ===
        null), "truncation_details.process", "sampling coverage must agree with retained samples and observed failures");
  require(capture.truncated ===
    hasCaptureTruncation(
      details,
    ), "truncation_details", "aggregate truncation must match producer coverage");
  require((details.rendered_terminal.normalization_over_budget_frames ?? 0) <=
    (details.rendered_terminal.unknown_size_frames ??
      0), "truncation_details.rendered_terminal.normalization_over_budget_frames", "normalization omissions must be a subset of unknown-size rendered frames");
  for (const [name, retention, count, bytes] of [
    [
      "raw_terminal",
      details.raw_terminal,
      capture.frames.length,
      capture.frames.reduce(
        (total, frame) =>
          total + Buffer.byteLength(frame.raw_data ?? frame.data),
        0,
      ),
    ],
    [
      "rendered_terminal",
      details.rendered_terminal,
      capture.rendered_frames.length,
      capture.rendered_frames.reduce(
        (total, frame) =>
          frame.lines.reduce(
            (sum, line) => sum + Buffer.byteLength(line),
            total + Buffer.byteLength(frame.serialized_state),
          ),
        0,
      ),
    ],
  ] as const) {
    const accountedBytes =
      retention.retained_bytes +
      (name === "raw_terminal"
        ? (details.raw_terminal.redacted_bytes ?? 0)
        : 0);
    // Retained bytes describe the safe frames exactly. Removed private bytes
    // remain charged to admitted input even when no whole frame was omitted.
    require(retention.retained_frames === count &&
      retention.observed_frames >= count &&
      retention.retained_bytes === bytes &&
      retention.observed_bytes >= accountedBytes &&
      (retention.observed_frames > count ||
        retention.observed_bytes === accountedBytes) &&
      accountedBytes <= retention.budget_bytes &&
      (retention.unknown_size_frames ?? 0) <=
        retention.observed_frames -
          retention.retained_frames, `truncation_details.${name}`, "retained observations and budget accounting do not agree");
  }
  const normalized = details.normalized_terminal;
  if (normalized !== undefined) {
    const committedOutputBudget =
      processScenarioOutputBudgetProjectionSchema.safeParse(
        capture.manifest.scenario["limits"],
      );
    require(committedOutputBudget.success, "manifest.scenario.limits.output_bytes", "committed process scenario must include an explicit valid output_bytes budget");
    const retainedBytes = capture.frames.reduce(
      (total, frame) => total + Buffer.byteLength(frame.data),
      0,
    );
    if (committedOutputBudget.success)
      require(normalized.budget_bytes ===
        committedOutputBudget.data.output_bytes &&
        normalized.retained_bytes === retainedBytes &&
        normalized.retained_bytes <= normalized.budget_bytes &&
        normalized.omitted_frames <=
          details.raw_terminal.observed_frames -
            details.raw_terminal
              .retained_frames, "truncation_details.normalized_terminal", "normalized terminal retention must agree with the committed budget and retained frames");
  }
  for (const [name, coverage, files, checkpoint] of [
    [
      "filesystem_before",
      details.filesystem_before,
      capture.files_before,
      capture.filesystem_checkpoints[0],
    ],
    [
      "filesystem_after",
      details.filesystem_after,
      capture.files_after,
      capture.filesystem_checkpoints[1],
    ],
  ] as const) {
    const unhashedFiles = new Map(
      files
        .filter((file) => file.type === "file" && file.sha256 === null)
        .map((file) => [file.path, file]),
    );
    const entryTypes = new Map(files.map(({ path, type }) => [path, type]));
    require(coverage.hash_omissions.length === unhashedFiles.size &&
      new Set(coverage.hash_omissions.map(({ path }) => path)).size ===
        unhashedFiles.size &&
      coverage.hash_omissions.every(
        (omission) =>
          unhashedFiles.get(omission.path)?.size === omission.size_bytes &&
          omission.remaining_budget_bytes <= coverage.hash_budget_bytes &&
          (omission.reason === "file_unavailable"
            ? omission.system_code !== null
            : omission.system_code === null),
      ), `truncation_details.${name}.hash_omissions`, "every retained regular file without a digest must have one matching omission reason");
    require(new Set(
      coverage.enumeration_omissions.map((omission) =>
        omission.reason === "unrepresentable_name"
          ? JSON.stringify([
              omission.path,
              omission.reason,
              omission.raw_name_hex,
            ])
          : JSON.stringify([omission.path]),
      ),
    ).size === coverage.enumeration_omissions.length &&
      (!coverage.enumeration_reasons.includes("entry_unavailable") ||
        coverage.enumeration_omissions.some(
          ({ reason }) => reason === "entry_unavailable",
        )) &&
      (!coverage.enumeration_reasons.includes("symlink_not_followed") ||
        coverage.enumeration_omissions.some(
          ({ reason }) => reason === "symlink_not_followed",
        )) &&
      (!coverage.enumeration_reasons.includes("unrepresentable_name") ||
        coverage.enumeration_omissions.some(
          ({ reason }) => reason === "unrepresentable_name",
        )) &&
      coverage.enumeration_omissions.every((omission) => {
        if (!coverage.enumeration_reasons.includes(omission.reason))
          return false;
        const entryType = entryTypes.get(omission.path);
        if (omission.reason === "symlink_not_followed")
          return entryType === "symlink" && omission.system_code === null;
        if (omission.reason === "directory_unavailable")
          return entryType === "directory" && omission.system_code !== null;
        return (
          (entryType === undefined || entryType === "directory") &&
          (omission.reason === "entry_unavailable"
            ? omission.system_code !== null
            : omission.system_code === null)
        );
      }), `truncation_details.${name}.enumeration_omissions`, "every enumeration omission must identify an unavailable entry, retained directory or unfollowed symlink, with a matching reason and system error only for unavailable reads");
    require(coverage.hashed_bytes ===
      files
        .filter((file) => file.type === "file" && file.sha256 !== null)
        .reduce((sum, file) => sum + file.size, 0) &&
      coverage.hashed_bytes <= coverage.hash_budget_bytes &&
      files.length <=
        coverage.files_limit, `truncation_details.${name}`, "filesystem budget accounting does not match retained observations");
    require(coverage.enumeration_truncated ===
      coverage.enumeration_reasons.length > 0 &&
      checkpoint?.truncated ===
        (coverage.enumeration_truncated ||
          coverage.enumeration_omissions.length > 0 ||
          coverage.hash_omissions.length >
            0), `truncation_details.${name}`, "filesystem checkpoint truncation must match enumeration and digest coverage");
  }
};

/** Recompute commitments and cross-field invariants without side effects. */
export const collectProcessCaptureIssues = (
  capture: UnverifiedProcessCapture,
): readonly ProcessCaptureValidationIssue[] => {
  const issues: ProcessCaptureValidationIssue[] = [];
  const require: RequireInvariant = (condition, path, message) => {
    if (!condition) issues.push({ path, message });
  };
  validateCommitments(capture, require);
  validateOrdering(capture, require);
  validateEventJournal(capture, require);
  validateLifecycle(capture, require);
  validateCoverage(capture, require);
  return issues;
};
