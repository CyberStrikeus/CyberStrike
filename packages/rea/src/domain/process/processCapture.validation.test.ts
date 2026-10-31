import { expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { digestProcessCommitment } from "./processScenario.js";
import {
  parseProcessCapture,
  type ProcessCapture,
} from "./processCaptureParsing.js";
import type { UnverifiedProcessCapture } from "./processCapture.js";
import {
  processCaptureSchema,
  partialProcessCaptureObservationSchema,
} from "./processCapture.js";
import {
  FINALIZED_PROCESS_CAPTURE_EXAMPLE,
  compareUnverifiedProcessCaptures as compareProcessCaptures,
  emptyUnverifiedProcessCapture as emptyCapture,
  processCaptureIssues,
} from "./processCapture.fixture.js";
import { finalizationConsistencyIssue } from "./processCaptureValidation.js";
import type { FilesystemCoverage } from "./processCaptureCoverage.js";

expectTypeOf<UnverifiedProcessCapture>().not.toExtend<ProcessCapture>();

/** Name every rejected field reported by the production parser. */
const rejectedPaths = (input: unknown): readonly string[] => {
  try {
    parseProcessCapture(input);
  } catch (cause: unknown) {
    if (cause instanceof z.ZodError)
      return cause.issues.map(({ path }) => path.join("."));
    throw cause;
  }
  throw new Error("Process capture was accepted");
};

const captureWithEnumerationOmission = (
  omission: FilesystemCoverage["enumeration_omissions"][number],
) => {
  const capture = emptyCapture();
  const scenario = {
    ...capture.manifest.scenario,
    filesystem_observation_paths: ["/fixture/selected"],
  };
  return {
    ...capture,
    manifest: {
      ...capture.manifest,
      scenario,
      full_scenario_sha256: digestProcessCommitment(scenario),
    },
    truncated: true,
    filesystem_checkpoints: capture.filesystem_checkpoints.map((checkpoint) =>
      checkpoint.name === "after_settlement"
        ? { ...checkpoint, truncated: true }
        : checkpoint,
    ),
    truncation_details: {
      ...capture.truncation_details,
      filesystem_after: {
        ...capture.truncation_details.filesystem_after,
        enumeration_truncated: true,
        enumeration_reasons: [omission.reason],
        enumeration_omissions: [omission],
      },
    },
  };
};

const captureWithSamplingInterruption = () => {
  const capture = emptyCapture();
  return {
    ...capture,
    truncated: true,
    truncation_details: {
      ...capture.truncation_details,
      process: {
        ...capture.truncation_details.process,
        sampling_partial: true,
        sampling_failures: 1,
        first_sampling_failure: "Process sampling interrupted by shutdown",
      },
    },
  };
};

it("requires interrupted sampling diagnostics to agree with partial and aggregate truncation", () => {
  const interrupted = captureWithSamplingInterruption();
  expect(parseProcessCapture(interrupted)).toEqual(interrupted);
  expect(() =>
    parseProcessCapture({
      ...interrupted,
      truncated: false,
    }),
  ).toThrow("truncation_details");
  expect(
    rejectedPaths({
      ...interrupted,
      truncation_details: {
        ...interrupted.truncation_details,
        process: {
          ...interrupted.truncation_details.process,
          sampling_partial: false,
        },
      },
    }),
  ).toContain("truncation_details.process");
  expect(
    rejectedPaths({
      ...interrupted,
      truncation_details: {
        ...interrupted.truncation_details,
        process: {
          ...interrupted.truncation_details.process,
          first_sampling_failure: null,
        },
      },
    }),
  ).toContain("truncation_details.process");
});

it("limits interruption impact to process comparison", () => {
  const baseline = emptyCapture();
  const interrupted = captureWithSamplingInterruption();
  expect(compareProcessCaptures(interrupted, baseline)).toMatchObject({
    status: "unknown",
    terminal: "unchanged",
    interaction: "unchanged",
    exit: "unchanged",
    filesystem: "unchanged",
    process: "unknown",
  });
});

it.each([
  { path: "root_0:.", reason: "entry_unavailable", system_code: "ENOENT" },
  { path: "root_0:.", reason: "identity_changed", system_code: null },
] as const)("accepts a partial entry with $reason evidence", (omission) => {
  const capture = captureWithEnumerationOmission(omission);
  expect(parseProcessCapture(capture)).toEqual(capture);
});

it("preserves distinct byte-name omissions at one directory through finalized capture parsing", () => {
  const capture = captureWithEnumerationOmission({
    path: "root_0:.",
    reason: "unrepresentable_name",
    system_code: null,
    raw_name_hex: "ff",
  });
  const coverage = capture.truncation_details.filesystem_after;
  coverage.enumeration_omissions.push({
    path: "root_0:.",
    reason: "unrepresentable_name",
    system_code: null,
    raw_name_hex: "fe",
  });
  expect(parseProcessCapture(capture)).toEqual(capture);
  coverage.enumeration_omissions.push({
    path: "root_0:.",
    reason: "identity_changed",
    system_code: null,
  });
  coverage.enumeration_reasons.push("identity_changed");
  expect(parseProcessCapture(capture)).toEqual(capture);
  // Re-reading the same raw basename is not a distinct omission.
  coverage.enumeration_omissions.push({
    path: "root_0:.",
    reason: "unrepresentable_name",
    system_code: null,
    raw_name_hex: "ff",
  });
  expect(() => parseProcessCapture(capture)).toThrow("enumeration_omissions");
});

it("requires raw-name evidence for an unrepresentable-name coverage reason", () => {
  const capture = captureWithEnumerationOmission({
    path: "root_0:.",
    reason: "unrepresentable_name",
    system_code: null,
    raw_name_hex: "ff",
  });
  expect(parseProcessCapture(capture)).toEqual(capture);
  capture.truncation_details.filesystem_after.enumeration_omissions = [];
  expect(() => parseProcessCapture(capture)).toThrow("enumeration_omissions");
});

it.each([
  { path: "root_0:.", reason: "entry_unavailable", system_code: null },
  { path: "root_0:.", reason: "identity_changed", system_code: "ENOENT" },
  { path: "root_0:.", reason: "directory_unavailable", system_code: "ENOENT" },
  { path: "root_0:.", reason: "symlink_not_followed", system_code: null },
] as const)("rejects an inconsistent omission %j", (omission) => {
  expect(() =>
    parseProcessCapture(captureWithEnumerationOmission(omission)),
  ).toThrow("enumeration_omissions");
});

it("requires entry-unavailability details and matching aggregate reasons", () => {
  const capture = captureWithEnumerationOmission({
    path: "root_0:.",
    reason: "entry_unavailable",
    system_code: "ENOENT",
  });
  for (const changes of [
    { enumeration_omissions: [] },
    { enumeration_reasons: ["identity_changed"] },
    {
      enumeration_omissions: [
        ...capture.truncation_details.filesystem_after.enumeration_omissions,
        ...capture.truncation_details.filesystem_after.enumeration_omissions,
      ],
    },
  ])
    expect(() =>
      parseProcessCapture({
        ...capture,
        truncation_details: {
          ...capture.truncation_details,
          filesystem_after: {
            ...capture.truncation_details.filesystem_after,
            ...changes,
          },
        },
      }),
    ).toThrow("enumeration_omissions");
});

it("binds unfollowed coverage to observed symlink metadata without inventing an OS failure", () => {
  const partial = captureWithEnumerationOmission({
    path: "root_0:.",
    reason: "symlink_not_followed",
    system_code: null,
  });
  const link = {
    path: "root_0:.",
    type: "symlink" as const,
    mode: 0o120777,
    size: 7,
    sha256: null,
    symlink_target: "reports",
  };
  const effect = {
    path: link.path,
    status: "created" as const,
    before: null,
    after: link,
  };
  const capture = {
    ...partial,
    files_after: [link],
    filesystem_effects: [effect],
    filesystem_checkpoints: partial.filesystem_checkpoints.map((checkpoint) =>
      checkpoint.name === "after_settlement"
        ? { ...checkpoint, files: [link], effects: [effect] }
        : checkpoint,
    ),
  };
  expect(parseProcessCapture(capture)).toEqual(capture);
  for (const changes of [
    { enumeration_omissions: [] },
    {
      enumeration_omissions: [
        {
          path: link.path,
          reason: "symlink_not_followed",
          system_code: "ENOENT",
        },
      ],
    },
  ])
    expect(() =>
      parseProcessCapture({
        ...capture,
        truncation_details: {
          ...capture.truncation_details,
          filesystem_after: {
            ...capture.truncation_details.filesystem_after,
            ...changes,
          },
        },
      }),
    ).toThrow("enumeration_omissions");
  expect(() =>
    parseProcessCapture({
      ...capture,
      files_after: [{ ...link, type: "directory", symlink_target: null }],
    }),
  ).toThrow("enumeration_omissions");
});

it("never considers truncated captures equivalent", () => {
  const complete = emptyCapture();
  const capture = {
    ...complete,
    truncated: true,
    truncation_details: {
      ...complete.truncation_details,
      raw_terminal: {
        ...complete.truncation_details.raw_terminal,
        observed_bytes: 1,
        observed_frames: 1,
      },
    },
  };
  expect(compareProcessCaptures(capture, capture).status).toBe("unknown");
});

it("rejects altered v4 commitments and accepts canonical key reordering", () => {
  const capture = emptyCapture();
  expect(parseProcessCapture(capture)).toEqual(capture);
  expect(digestProcessCommitment({ second: 2, first: 1 })).toBe(
    digestProcessCommitment({ first: 1, second: 2 }),
  );
  expect(() =>
    parseProcessCapture({
      ...capture,
      manifest: {
        ...capture.manifest,
        normalization_sha256: "f".repeat(64),
      },
    }),
  ).toThrow("normalization_sha256");
  expect(() =>
    parseProcessCapture({
      ...capture,
      manifest: {
        ...capture.manifest,
        executable_sha256: "f".repeat(64),
      },
    }),
  ).toThrow("executable_identity");
});

it("requires producer coverage accounting in every parsed capture", () => {
  const capture = emptyCapture();
  const { truncation_details: _details, ...missingCoverage } = capture;
  expect(() => parseProcessCapture(missingCoverage)).toThrow(
    "truncation_details",
  );
});

it("requires rendered normalization omissions to be a subset of unknown-size frames", () => {
  const complete = emptyCapture();
  const withRenderedCoverage = (
    observed_frames: number,
    unknown_size_frames: number | undefined,
    normalization_over_budget_frames: number | undefined,
  ) => ({
    ...complete,
    truncated: observed_frames > 0,
    truncation_details: {
      ...complete.truncation_details,
      rendered_terminal: {
        ...complete.truncation_details.rendered_terminal,
        observed_frames,
        ...(unknown_size_frames === undefined ? {} : { unknown_size_frames }),
        ...(normalization_over_budget_frames === undefined
          ? {}
          : { normalization_over_budget_frames }),
      },
    },
  });

  // Retention-only omissions and historical captures need no stage counter.
  for (const capture of [
    complete,
    withRenderedCoverage(1, 1, undefined),
    withRenderedCoverage(2, 2, 1),
  ])
    expect(parseProcessCapture(capture)).toEqual(capture);

  for (const capture of [
    withRenderedCoverage(0, undefined, 1),
    withRenderedCoverage(1, undefined, 1),
    withRenderedCoverage(2, 1, 2),
  ])
    expect(rejectedPaths(capture)).toContain(
      "truncation_details.rendered_terminal.normalization_over_budget_frames",
    );
});

it("does not infer normalized retention budget from missing scenario defaults", () => {
  const capture = emptyCapture();
  const scenario = {
    ...capture.manifest.scenario,
    limits: {
      files: 10_000,
      file_bytes: 10_000_000,
      processes: 1_000,
      filesystem_depth: 16,
    },
  };
  expect(
    rejectedPaths({
      ...capture,
      manifest: {
        ...capture.manifest,
        scenario,
        full_scenario_sha256: digestProcessCommitment(scenario),
      },
      truncation_details: {
        ...capture.truncation_details,
        normalized_terminal: {
          budget_bytes: 1_000_000,
          retained_bytes: 0,
          omitted_frames: 0,
        },
      },
    }),
  ).toContain("manifest.scenario.limits.output_bytes");
});

it("rejects settlement and cleanup combinations that cannot occur", () => {
  const capture = emptyCapture();
  expect(() =>
    parseProcessCapture({
      ...capture,
      settlement: {
        state: "quiesced",
        elapsed_ms: 0,
        cleanup_outcome: "cleaned",
      },
    }),
  ).toThrow("cleanup_outcome");
  expect(() =>
    parseProcessCapture({
      ...capture,
      settlement: {
        state: "alive_at_deadline",
        elapsed_ms: 1,
        cleanup_outcome: "not_required",
      },
    }),
  ).toThrow("cleanup_outcome");
});

it("rejects finalization evidence that no deadline could have produced", () => {
  const capture = emptyCapture();
  const finalization = {
    requested_ms: 500,
    exit_code: null,
    signals: [
      {
        signal: "SIGTERM" as const,
        sent_at_ms: 0,
        delivery: "signaled" as const,
      },
    ],
    elapsed_ms: 10,
  };
  expect(
    () =>
      parseProcessCapture({
        ...capture,
        exit: { code: 0, signal: null, reason: "exited", finalization },
      }),
    "an exit without a deadline cannot carry a finalization record",
  ).toThrow("finalization");
});

it("rejects a finalization reason on a verified delivery", () => {
  const finalization = {
    requested_ms: 500,
    exit_code: null,
    elapsed_ms: 10,
    signals: [
      {
        signal: "SIGTERM" as const,
        sent_at_ms: 0,
        delivery: "signaled" as const,
        reason: "should not be retained",
      },
    ],
  };

  expect(
    () =>
      parseProcessCapture({
        ...withCommittedFinalization(500, {
          code: null,
          signal: null,
          reason: "timeout",
          finalization,
        }),
      }),
    "a finalization reason is reserved for unverified delivery",
  ).toThrow("finalization");
});

const withCommittedFinalization = (
  committed: number | undefined,
  exit: Record<string, unknown>,
  comparisonCommitted: number | "same" | "absent" = "same",
) => {
  const capture = emptyCapture();
  const scenario = {
    ...capture.manifest.scenario,
    ...(committed === undefined ? {} : { finalization_ms: committed }),
  };
  const comparisonContract = {
    ...capture.manifest.comparison_contract,
    ...(comparisonCommitted === "absent"
      ? {}
      : comparisonCommitted === "same"
        ? committed === undefined
          ? {}
          : { finalization_ms: committed }
        : { finalization_ms: comparisonCommitted }),
  };
  return {
    ...capture,
    manifest: {
      ...capture.manifest,
      scenario,
      comparison_contract: comparisonContract,
      full_scenario_sha256: digestProcessCommitment(scenario),
      comparison_contract_sha256: digestProcessCommitment(comparisonContract),
    },
    exit,
  };
};

it("binds finalization evidence to the committed finalization interval", () => {
  const finalization = {
    requested_ms: 500,
    exit_code: null,
    signals: [
      {
        signal: "SIGTERM" as const,
        sent_at_ms: 0,
        delivery: "signaled" as const,
      },
    ],
    elapsed_ms: 10,
  };
  const exit = { code: null, signal: null, reason: "timeout", finalization };

  expect(
    parseProcessCapture(withCommittedFinalization(500, exit)).exit,
    "a record matching the committed interval is accepted",
  ).toMatchObject({ finalization });
  expect(
    () => parseProcessCapture(withCommittedFinalization(700, exit)),
    "a different committed interval contradicts the record",
  ).toThrow("finalization");
  expect(
    () => parseProcessCapture(withCommittedFinalization(undefined, exit)),
    "a scenario that committed no interval cannot have finalized",
  ).toThrow("finalization");
  expect(
    () =>
      parseProcessCapture(
        withCommittedFinalization(500, {
          ...exit,
          finalization: { ...finalization, elapsed_ms: null },
        }),
      ),
    "a complete capture requires an observed finalization exit time",
  ).toThrow("finalization");
});

it("validates finalization signal observations", () => {
  const finalization = {
    requested_ms: 500,
    exit_code: null,
    signals: [
      {
        signal: "SIGTERM" as const,
        sent_at_ms: 0,
        delivery: "signaled" as const,
      },
    ],
    elapsed_ms: 10,
  };
  expect(
    finalizationConsistencyIssue({
      reason: "exited",
      finalization,
    }),
    "an exited reason cannot carry finalization",
  ).toContain("finalization");
  expect(
    finalizationConsistencyIssue({
      reason: "timeout",
      finalization: {
        ...finalization,
        signals: [{ signal: "SIGKILL", sent_at_ms: 500 }],
      },
    }),
    "the first attempt is SIGTERM",
  ).toContain("SIGTERM");
  expect(
    finalizationConsistencyIssue({
      reason: "timeout",
      finalization: {
        ...finalization,
        signals: [
          { signal: "SIGTERM", sent_at_ms: 0 },
          { signal: "SIGKILL", sent_at_ms: 500 },
          { signal: "SIGKILL", sent_at_ms: 600 },
        ],
      },
    }),
    "only one SIGKILL is allowed",
  ).toContain("one final SIGKILL");
  expect(
    finalizationConsistencyIssue({
      reason: "timeout",
      finalization: {
        ...finalization,
        signals: [
          { signal: "SIGTERM", sent_at_ms: 10 },
          { signal: "SIGKILL", sent_at_ms: 5 },
        ],
      },
    }),
    "attempt times stay ordered",
  ).toContain("must not decrease");
  expect(
    finalizationConsistencyIssue({
      reason: "timeout",
      finalization: {
        ...finalization,
        signals: [
          { signal: "SIGTERM", sent_at_ms: 0 },
          { signal: "SIGKILL", sent_at_ms: 499 },
        ],
      },
    }),
    "a non-cancelled early SIGKILL is rejected",
  ).toContain("requested interval");
  expect(
    finalizationConsistencyIssue({
      reason: "cancelled",
      finalization: {
        ...finalization,
        signals: [
          { signal: "SIGTERM", sent_at_ms: 0 },
          { signal: "SIGKILL", sent_at_ms: 1 },
        ],
      },
    }),
    "a cancelled early SIGKILL is accepted",
  ).toBeUndefined();
  expect(
    finalizationConsistencyIssue({
      reason: "timeout",
      finalization: {
        ...finalization,
        signals: [{ signal: "SIGTERM", sent_at_ms: 1 }],
        elapsed_ms: 0,
      },
    }),
    "the observed exit cannot precede the first attempt",
  ).toContain("elapsed_ms");
  expect(
    finalizationConsistencyIssue({
      reason: "timeout",
      finalization: { ...finalization, elapsed_ms: null },
    }),
    "an observed exit requires elapsed time",
  ).toContain("elapsed_ms");
  expect(
    finalizationConsistencyIssue(
      { reason: "timeout" },
      { finalization_ms: 500 },
    ),
    "a deadline exit with a committed interval must carry the record",
  ).toContain("finalization evidence");
});

it("validates finalization evidence in partial captures and rejects malformed records", () => {
  const { cleanup: _cleanup, ...completed } = emptyCapture();
  const partial = (exit: Record<string, unknown>) =>
    partialProcessCaptureObservationSchema.safeParse({
      capture: { ...completed, exit },
      cleanup: {
        owned_process_group: { state: "cleaned", reason: null },
        terminal_renderer: { state: "cleaned", reason: null },
        temporary_root: { state: "cleaned", reason: null },
      },
      execution_failure: "capture ended after a fixture error",
    });
  const partialWithCommittedFinalization = (exit: Record<string, unknown>) => {
    const { cleanup: _cleanup, ...completed } = withCommittedFinalization(500, {
      code: null,
      signal: null,
      reason: "timeout",
    });
    return partialProcessCaptureObservationSchema.safeParse({
      capture: { ...completed, exit },
      cleanup: {
        owned_process_group: { state: "cleaned", reason: null },
        terminal_renderer: { state: "cleaned", reason: null },
        temporary_root: { state: "cleaned", reason: null },
      },
      execution_failure: "capture ended after a fixture error",
    });
  };
  const finalization = {
    requested_ms: 500,
    exit_code: null,
    signals: [
      {
        signal: "SIGTERM" as const,
        sent_at_ms: 0,
        delivery: "signaled" as const,
      },
    ],
    elapsed_ms: 10,
  };

  expect(
    partial({ code: null, signal: null, reason: "timeout" }).success,
    "a partial exit without finalization stays valid",
  ).toBe(true);
  expect(
    partial({ code: 0, signal: null, reason: "exited", finalization }).success,
    "a partial exit cannot finalize without a deadline",
  ).toBe(false);
  expect(
    partial({
      code: null,
      signal: null,
      reason: "timeout",
      finalization: { ...finalization, requested_ms: 700 },
    }).success,
    "a partial record must match the committed interval",
  ).toBe(false);
  expect(
    partialWithCommittedFinalization({
      code: null,
      signal: null,
      reason: "timeout",
      finalization: { ...finalization, elapsed_ms: null },
    })
      .error?.issues.map(({ message }) => message)
      .join("; "),
    "a capture variant requires an observed finalization exit time",
  ).toContain("elapsed_ms");
  expect(
    () =>
      parseProcessCapture(
        withCommittedFinalization(500, {
          code: null,
          signal: null,
          reason: "timeout",
          finalization: {
            ...finalization,
            signals: [
              { signal: "SIGINT", sent_at_ms: 0, delivery: "signaled" },
            ],
          },
        }),
      ),
    "only SIGTERM can start finalization",
  ).toThrow();
  expect(
    () =>
      parseProcessCapture(
        withCommittedFinalization(500, {
          code: null,
          signal: null,
          reason: "timeout",
          finalization: { ...finalization, elapsed_ms: -1 },
        }),
      ),
    "elapsed time cannot be negative",
  ).toThrow();
});

it("binds the comparison contract to the committed finalization interval", () => {
  const exit = { code: 0, signal: null, reason: "exited" };

  expect(
    () => parseProcessCapture(withCommittedFinalization(500, exit, "absent")),
    "a scenario interval missing from the comparison contract is contradictory",
  ).toThrow("comparison_contract");
  expect(
    () => parseProcessCapture(withCommittedFinalization(500, exit, 900)),
    "a different comparison interval is contradictory",
  ).toThrow("comparison_contract");
  expect(
    () => parseProcessCapture(withCommittedFinalization(undefined, exit, 500)),
    "a comparison interval the scenario never committed is contradictory",
  ).toThrow("comparison_contract");
});

// This single scenario shares one deliberately complete incomplete-capture fixture.
// oxlint-disable-next-line max-lines-per-function
it("validates finalization evidence in incomplete observations", () => {
  const finalization = {
    requested_ms: 500,
    exit_code: null,
    signals: [
      {
        signal: "SIGTERM" as const,
        sent_at_ms: 0,
        delivery: "signaled" as const,
      },
    ],
    elapsed_ms: 10,
  };
  const unavailable = { state: "unavailable", reason: "not observed" };
  const incomplete = (
    exit: Record<string, unknown> | undefined,
    manifest: ReturnType<typeof withCommittedFinalization>["manifest"],
    incompleteFinalization: Record<string, unknown> | undefined = undefined,
  ) => {
    const result = partialProcessCaptureObservationSchema.safeParse({
      observations: {
        target_pid: unavailable,
        frames: { state: "available", value: [] },
        rendered_frames: unavailable,
        interaction_events: unavailable,
        exit:
          exit === undefined
            ? unavailable
            : { state: "available", value: exit },
        finalization:
          incompleteFinalization === undefined
            ? unavailable
            : { state: "available", value: incompleteFinalization },
        settlement: unavailable,
        process_samples: unavailable,
        filesystem_snapshots: { before: unavailable, after: unavailable },
        event_journal: unavailable,
        manifest: { state: "available", value: manifest },
      },
      cleanup: {
        owned_process_group: { state: "cleaned", reason: null },
        terminal_renderer: { state: "cleaned", reason: null },
        temporary_root: { state: "cleaned", reason: null },
      },
      execution_failure: "capture ended after a fixture error",
    });
    return {
      success: result.success,
      messages: result.success
        ? ""
        : result.error.issues.map(({ message }) => message).join("; "),
    };
  };
  const timeout = { code: null, signal: null, reason: "timeout" };
  const normal = { code: 0, signal: null, reason: "exited" };
  const committed = withCommittedFinalization(500, timeout).manifest;

  expect(
    incomplete({ ...timeout, finalization }, committed).success,
    "a consistent incomplete record is accepted",
  ).toBe(true);
  expect(
    incomplete({ ...timeout, finalization }, committed, { ...finalization })
      .success,
    "matching exit and sibling finalization observations are accepted",
  ).toBe(true);
  const disagreement = incomplete({ ...timeout, finalization }, committed, {
    ...finalization,
    elapsed_ms: 11,
  });
  expect(
    disagreement.success,
    "conflicting finalization observations are rejected",
  ).toBe(false);
  expect(disagreement.messages, "the conflict names finalization").toContain(
    "finalization observation must agree",
  );
  expect(
    incomplete(undefined, committed, { ...finalization, elapsed_ms: null })
      .success,
    "a finalization observed without an exit permits null elapsed time",
  ).toBe(true);
  const unavailableExitElapsed = incomplete(undefined, committed, finalization);
  expect(
    unavailableExitElapsed.success,
    "a finalization without an exit rejects a claimed elapsed time",
  ).toBe(false);
  expect(
    unavailableExitElapsed.messages,
    "the unavailable-exit rule names elapsed_ms",
  ).toContain("elapsed_ms");
  const sigkillFirst = incomplete(undefined, committed, {
    ...finalization,
    elapsed_ms: null,
    signals: [{ signal: "SIGKILL", sent_at_ms: 0, delivery: "signaled" }],
  });
  expect(
    sigkillFirst.success,
    "an incomplete finalization still starts with SIGTERM",
  ).toBe(false);
  expect(
    sigkillFirst.messages,
    "only the SIGTERM-first rule fires, not the null-elapsed rule",
  ).toContain("start with SIGTERM");
  expect(
    incomplete(normal, withCommittedFinalization(undefined, normal).manifest)
      .success,
    "an incomplete capture that never committed an interval is accepted",
  ).toBe(true);
  expect(
    incomplete(
      { code: 0, signal: null, reason: "exited", finalization },
      committed,
    ).success,
    "an incomplete exit cannot finalize without a deadline",
  ).toBe(false);
  expect(
    incomplete(
      { ...timeout, finalization: { ...finalization, requested_ms: 700 } },
      committed,
    ).success,
    "an incomplete record must match the committed interval",
  ).toBe(false);
  const scenarioOnly = withCommittedFinalization(
    500,
    normal,
    "absent",
  ).manifest;
  const comparisonOnly = withCommittedFinalization(
    undefined,
    normal,
    500,
  ).manifest;
  const differing = withCommittedFinalization(500, normal, 900).manifest;
  for (const [label, manifest] of [
    ["a scenario interval missing from the comparison contract", scenarioOnly],
    ["a comparison interval the scenario never committed", comparisonOnly],
    ["differing intervals", differing],
  ] as const) {
    const verdict = incomplete(normal, manifest);
    expect(verdict.success, `${label} is rejected`).toBe(false);
    expect(
      verdict.messages,
      `${label} is rejected for the comparison contract`,
    ).toContain("comparison_contract");
  }
  const earlyKill = {
    requested_ms: 500,
    exit_code: null,
    elapsed_ms: 600,
    signals: [
      { signal: "SIGTERM", sent_at_ms: 0, delivery: "signaled" },
      { signal: "SIGKILL", sent_at_ms: 40, delivery: "unverified" },
    ],
  };
  expect(
    incomplete(
      {
        code: null,
        signal: null,
        reason: "cancelled",
        finalization: earlyKill,
      },
      committed,
      earlyKill,
    ).success,
    "a cancellation may keep an early SIGKILL attempt",
  ).toBe(true);
  const earlyKillDeadline = incomplete(
    { ...timeout, finalization: earlyKill },
    committed,
    earlyKill,
  );
  expect(
    earlyKillDeadline.success,
    "a deadline exit cannot carry a SIGKILL before the requested interval",
  ).toBe(false);
  expect(
    earlyKillDeadline.messages,
    "the early SIGKILL negative isolates the requested interval rule",
  ).toContain("requested interval");
  expect(
    incomplete(undefined, differing).success,
    "an unavailable exit still cannot hide a contradictory manifest",
  ).toBe(false);
});

it("rejects chronologically impossible or repeated finalization attempts", () => {
  const attempt = (signal: "SIGTERM" | "SIGKILL", sent_at_ms: number) => ({
    signal,
    sent_at_ms,
    delivery: "signaled" as const,
  });
  const exit = (
    elapsed_ms: number | null,
    signals: ReturnType<typeof attempt>[],
  ) => ({
    reason: "timeout",
    finalization: { requested_ms: 500, elapsed_ms, exit_code: null, signals },
  });

  expect(
    finalizationConsistencyIssue(
      exit(10, [attempt("SIGTERM", 0), attempt("SIGKILL", 500)]),
    ),
    "an exit cannot be observed before the last recorded attempt",
  ).toContain("elapsed_ms");
  expect(
    finalizationConsistencyIssue(
      exit(600, [attempt("SIGTERM", 0), attempt("SIGTERM", 10)]),
    ),
    "SIGTERM is attempted once",
  ).toContain("finalization");
  expect(
    finalizationConsistencyIssue(
      exit(600, [attempt("SIGTERM", 0), attempt("SIGKILL", 500)]),
    ),
    "a consistent record is accepted",
  ).toBeUndefined();
});

it("keeps the finalization exit code tied to an observed exit not caused by a signal", () => {
  const attempt = {
    signal: "SIGTERM" as const,
    sent_at_ms: 0,
    delivery: "signaled" as const,
  };
  const record = (
    elapsed_ms: number | null,
    exit_code: number | null,
    signal?: number | null,
  ) => ({
    reason: "timeout",
    ...(signal === undefined ? {} : { signal }),
    finalization: {
      requested_ms: 500,
      elapsed_ms,
      exit_code,
      signals: [attempt],
    },
  });

  expect(
    finalizationConsistencyIssue(record(10, 3, 0)),
    "a code reported for an exit without a signal is accepted",
  ).toBeUndefined();
  expect(
    finalizationConsistencyIssue(record(10, 3, 9)),
    "a code cannot accompany an exit ended by a signal",
  ).toContain("exit_code");
  expect(
    finalizationConsistencyIssue(record(10, null, 9)),
    "a signal exit records a null code",
  ).toBeUndefined();

  const schemaFinalization = {
    requested_ms: 500,
    elapsed_ms: null,
    exit_code: 3,
    signals: [attempt],
  };
  expect(
    () =>
      parseProcessCapture(
        withCommittedFinalization(500, {
          code: null,
          signal: null,
          reason: "timeout",
          finalization: schemaFinalization,
        }),
      ),
    "an exit code needs an observed exit",
  ).toThrow("exit_code");
});

it("accepts the canonical finalized capture example", () => {
  expect(
    parseProcessCapture(FINALIZED_PROCESS_CAPTURE_EXAMPLE).exit,
    "the advertised finalized example is a valid capture",
  ).toMatchObject({
    reason: "timeout",
    finalization: { requested_ms: 1_500, signals: [{ signal: "SIGTERM" }] },
  });
});

it("requires an explicit journal and validates complete journals", () => {
  const capture = emptyCapture();
  const { event_journal: _eventJournal, ...oldCapture } = capture;
  expect(() => parseProcessCapture(oldCapture)).toThrow("event_journal");

  const eventJournal = [
    { capture_order: 0, collection: "filesystem_checkpoints", index: 0 },
    { capture_order: 1, collection: "lifecycle", index: 0 },
    { capture_order: 2, collection: "lifecycle", index: 1 },
    { capture_order: 3, collection: "filesystem_checkpoints", index: 1 },
  ] as const;
  expect(
    processCaptureIssues({ ...capture, event_journal: eventJournal }),
  ).toEqual([]);

  for (const [candidate, message] of [
    [
      eventJournal.map((entry, index) =>
        index === 1 ? { ...entry, capture_order: 2 } : entry,
      ),
      "contiguous",
    ],
    [
      eventJournal.map((entry, index) =>
        index === 3
          ? { ...entry, collection: "lifecycle" as const, index: 1 }
          : entry,
      ),
      "unique",
    ],
    [eventJournal.slice(0, 3), "every captured observation"],
    [
      eventJournal.map((entry, index) =>
        index === 3 ? { ...entry, index: 2 } : entry,
      ),
      "outside",
    ],
  ] as const) {
    expect(
      processCaptureIssues({ ...capture, event_journal: candidate }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining(message),
        }),
      ]),
    );
  }
});

it("rejects old executable identity representations without migration", () => {
  const capture = emptyCapture();
  const {
    selected_executable_sha256: _selected,
    executable_identity: _identity,
    ...oldManifest
  } = capture.manifest;
  expect(() =>
    parseProcessCapture({ ...capture, manifest: oldManifest }),
  ).toThrow();
  expect(() =>
    parseProcessCapture({
      ...capture,
      manifest: {
        ...capture.manifest,
        legacy_executable_sha256: capture.manifest.executable_sha256,
      },
    }),
  ).toThrow("legacy_executable_sha256");
});

it("requires compatible contracts and enforces capture age through a clock seam", () => {
  const capture = emptyCapture();
  expect(() =>
    compareProcessCaptures(capture, {
      ...capture,
      manifest: {
        ...capture.manifest,
        comparison_contract: { changed: true },
        comparison_contract_sha256: digestProcessCommitment({
          changed: true,
        }),
      },
    }),
  ).toThrow(
    expect.objectContaining({
      issues: [
        expect.objectContaining({
          path: ["right"],
          message: expect.stringContaining(
            "incompatible comparison contracts; these scenario fields differ: changed",
          ),
          expected: ["changed"],
        }),
      ],
    }),
  );
  expect(() =>
    compareProcessCaptures(capture, capture, {
      maxCaptureAgeMs: 1,
      now: () => Date.parse("2026-01-01T00:00:01.000Z"),
    }),
  ).toThrow(
    expect.objectContaining({
      issues: [
        expect.objectContaining({
          path: ["max_capture_age_ms"],
          reason: "out_of_range",
          message: expect.stringContaining("left completed at"),
        }),
      ],
    }),
  );
});

it("requires interaction dispatch times to follow their sequence", () => {
  const capture = emptyCapture();
  const interaction = (sequence: number, dispatched: number) => ({
    sequence,
    scheduled_at_ms: 0,
    dispatched_at_ms: dispatched,
    type: "input" as const,
    data: "x",
    outcome: "dispatched" as const,
  });
  const issues = (dispatched: readonly number[]) =>
    processCaptureIssues({
      ...capture,
      interaction_events: dispatched.map((at, index) => interaction(index, at)),
    }).filter(({ message }) => message.includes("dispatch timestamps"));
  expect(issues([5, 5, 10])).toEqual([]);
  expect(issues([10, 5])).toEqual([
    {
      path: "interaction_events",
      message: expect.stringContaining("dispatch timestamps must be ordered"),
    },
  ]);
});

it("validates private interaction fields together while retaining legacy captures", () => {
  const event = {
    sequence: 0,
    scheduled_at_ms: 0,
    dispatched_at_ms: 0,
    type: "input",
    data: "",
    outcome: "dispatched",
  };
  const shape = processCaptureSchema.shape.interaction_events;
  expect(
    shape.safeParse([{ ...event, sensitive: true, input_bytes: 6 }]).success,
  ).toBe(true);
  expect(
    shape.safeParse([{ ...event, data: "<redacted-input:6-bytes>" }]).success,
  ).toBe(true);
  for (const invalid of [
    { ...event, sensitive: true },
    { ...event, input_bytes: 6 },
    { ...event, sensitive: true, input_bytes: 6, data: "original" },
    { ...event, sensitive: true, input_bytes: 6, type: "signal" },
  ])
    expect(shape.safeParse([invalid]).success).toBe(false);
  expect(() => parseProcessCapture(emptyCapture())).not.toThrow();
});
