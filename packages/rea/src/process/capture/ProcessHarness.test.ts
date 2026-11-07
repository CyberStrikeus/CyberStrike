import { expect, it, vi } from "vitest";
import { processScenarioSchema } from "../../domain/process/processScenario.js";
import { AnalysisCapabilityUnavailableError } from "../../domain/analysisErrorCore.js";
import {
  captureProcessScenario,
  retainRootSignaller,
} from "./ProcessHarness.js";
import {
  settleProcessCaptureJournal,
  releaseProcessResources,
  ProcessCaptureResourceScope,
  createProcessCaptureObservationBuffer,
  prepareProcessCapture,
  resolveProcessResult,
  type ProcessCaptureCleanupOutcome,
  type ProcessCaptureCleanupHost,
} from "./ProcessCaptureLifecycle.js";
import { parseProcessCapture } from "../../domain/process/processCaptureParsing.js";
import { EMPTY_PROCESS_CAPTURE_EXAMPLE } from "../../domain/process/processCaptureExample.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import {
  accountFullyObservedProcessCapture,
  emptyProcessCapture,
} from "../../domain/process/processCapture.fixture.js";
import { analysisErrorProjectionSchema } from "../../contracts/errorSchemas.js";
import {
  ProcessCaptureError,
  normalizeCaptureFailure,
  processCaptureCancelled,
} from "./ProcessCaptureError.js";
import { DarwinProcessOwnershipInspectionError } from "../DarwinProcessRunTokenReader.js";

import {
  partialProcessCaptureObservationSchema,
  processCaptureSchema,
  type ProcessCaptureCleanupReport,
} from "../../domain/process/processCapture.js";
const emptyFilesystemCoverage =
  emptyProcessCapture().truncation_details.filesystem_before;
const incompleteFilesystemCoverage = {
  ...emptyFilesystemCoverage,
  enumeration_truncated: true,
  enumeration_reasons: ["identity_changed"],
} satisfies typeof emptyFilesystemCoverage;
const historicalCleanupOutcome = (
  report: ProcessCaptureCleanupReport,
): ProcessCaptureCleanupOutcome => ({ report, cleanupLease: undefined });

it("retains cancellation and cleanup facts when ownership baseline inspection aborts", async () => {
  const controller = new AbortController();
  const reason = new Error("ownership baseline caller cancellation");
  const scenario = processScenarioSchema.parse({
    executable: process.execPath,
  });
  await expect(
    prepareProcessCapture(
      scenario,
      controller.signal,
      async () => ({
        files: [],
        truncated: false,
        completeRoots: [],
        coverage: emptyFilesystemCoverage,
      }),
      {
        createTemporaryRoot: async () => "/fixture/allocated-root",
        captureOwnershipBaseline: async () => {
          controller.abort(reason);
          controller.signal.throwIfAborted();
          return [];
        },
        cleanup: async () => undefined,
      },
    ),
  ).rejects.toMatchObject({
    reason: "cancelled",
    cause: reason,
    message: "process capture was cancelled",
    cleanupReport: {
      temporary_root: { state: "cleaned", reason: null },
    },
    partialObservation: {
      observations: {
        filesystem_snapshots: {
          before: {
            state: "available",
            value: {
              files: [],
              truncated: false,
              completeRoots: [],
              coverage: emptyFilesystemCoverage,
            },
          },
        },
      },
    },
  });
});

it("keeps prelaunch snapshot evidence and the ownership failure when root cleanup throws", async () => {
  const ownershipFailure = new Error("process identity baseline denied");
  const scenario = processScenarioSchema.parse({
    executable: process.execPath,
    filesystem_observation_paths: ["/fixture/root"],
  });
  try {
    await prepareProcessCapture(
      scenario,
      undefined,
      async () => ({
        files: [],
        truncated: true,
        completeRoots: [],
        coverage: incompleteFilesystemCoverage,
      }),
      {
        createTemporaryRoot: async () => "/fixture/allocated-root",
        captureOwnershipBaseline: async () => {
          throw ownershipFailure;
        },
        cleanup: async () => {
          throw new Error("root removal denied");
        },
      },
    );
    throw new Error("expected preparation failure");
  } catch (cause: unknown) {
    if (!(cause instanceof ProcessCaptureError)) throw cause;
    expect(cause.cause).toBe(ownershipFailure);
    const incomplete = cause.partialObservation;
    if (incomplete === undefined || !("observations" in incomplete))
      throw new Error("expected incomplete preparation observations");
    expect(
      Object.keys(incomplete.observations),
      "a default scenario keeps the base observation keys through the preparation path",
    ).not.toContain("finalization");
    expect(
      analysisErrorProjectionSchema.parse(projectAnalysisError(cause)),
    ).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        execution_failure: ownershipFailure.message,
        cleanup_report: {
          temporary_root: { state: "failed", reason: "root removal denied" },
        },
        partial_observation: {
          observations: {
            filesystem_snapshots: {
              before: {
                state: "available",
                value: {
                  files: [],
                  truncated: true,
                  completeRoots: [],
                  coverage: incompleteFilesystemCoverage,
                },
              },
            },
          },
        },
      },
    });
  }
});

it("projects complete after-snapshot metadata when a later capture stage fails", () => {
  const scenario = processScenarioSchema.parse({
    executable: process.execPath,
    filesystem_observation_paths: ["/fixture/root"],
  });
  const observations = createProcessCaptureObservationBuffer({
    frames: [],
    interactions: [],
    samples: [],
    eventJournal: [],
    before: {
      files: [],
      truncated: false,
      completeRoots: [],
      coverage: emptyFilesystemCoverage,
    },
  });
  observations.filesystem_snapshots.after = {
    state: "available",
    value: {
      files: [],
      truncated: true,
      completeRoots: [],
      coverage: incompleteFilesystemCoverage,
    },
  };
  const cleanup = {
    owned_process_group: { state: "cleaned" as const, reason: null },
    terminal_renderer: { state: "cleaned" as const, reason: null },
    temporary_root: { state: "cleaned" as const, reason: null },
  };

  let error: ProcessCaptureError | undefined;
  try {
    resolveProcessResult(
      undefined,
      new Error("capture manifest failed after final snapshot"),
      historicalCleanupOutcome(cleanup),
      observations,
      { scenario },
    );
  } catch (cause: unknown) {
    if (!(cause instanceof ProcessCaptureError)) throw cause;
    error = cause;
  }
  if (error === undefined) throw new Error("expected capture failure");

  expect(
    analysisErrorProjectionSchema.parse(projectAnalysisError(error)),
  ).toMatchObject({
    details: {
      partial_observation: {
        observations: {
          filesystem_snapshots: {
            after: {
              state: "available",
              value: {
                files: [],
                truncated: true,
                completeRoots: [],
                coverage: incompleteFilesystemCoverage,
              },
            },
          },
        },
      },
    },
  });
});

it("rejects legacy replay output instead of silently discarding it", () => {
  expect(
    processCaptureSchema.safeParse({
      ...EMPTY_PROCESS_CAPTURE_EXAMPLE,
      protocol_events: [],
    }).success,
  ).toBe(false);
});

it("preserves the actionable Darwin ownership compiler prerequisite", () => {
  const normalized = normalizeCaptureFailure(
    new DarwinProcessOwnershipInspectionError(
      "macOS process ownership inspection requires the Apple Swift compiler via xcrun",
    ),
    undefined,
  );

  expect(normalized).toBeInstanceOf(ProcessCaptureError);
  expect(normalized).toMatchObject({
    message:
      "macOS process ownership inspection requires the Apple Swift compiler via xcrun",
  });
});

it("settles the capture journal when the application timer is unavailable", async () => {
  const applicationTimer = vi
    .spyOn(globalThis, "setTimeout")
    .mockImplementation(() => {
      throw new Error("application timer is unavailable");
    });
  try {
    await expect(
      settleProcessCaptureJournal([], 0, 50),
    ).resolves.toBeUndefined();
    expect(applicationTimer).not.toHaveBeenCalled();
  } finally {
    applicationTimer.mockRestore();
  }
});

it("waits for terminal observations delivered after the exit callback", async () => {
  const journal: Array<{
    capture_order: number;
    collection: "frames";
    index: number;
  }> = [{ capture_order: 0, collection: "frames", index: 0 }];
  const lateFrame = new Promise<void>((resolve) => {
    setTimeout(() => {
      journal.push({ capture_order: 1, collection: "frames", index: 1 });
      resolve();
    }, 12);
  });

  let settled = false;
  const wait = settleProcessCaptureJournal(journal, 20, 200).then(() => {
    settled = true;
  });
  await lateFrame;
  expect(settled).toBe(false);
  await wait;

  expect(journal).toHaveLength(2);
  expect(journal[1]).toMatchObject({ collection: "frames", index: 1 });
});

it("does not settle while a trailing observation is already due behind a stalled event loop", async () => {
  const journal: Array<{
    capture_order: number;
    collection: "frames";
    index: number;
  }> = [{ capture_order: 0, collection: "frames", index: 0 }];
  const lateFrame = new Promise<void>((resolve) => {
    setTimeout(() => {
      journal.push({ capture_order: 1, collection: "frames", index: 1 });
      resolve();
    }, 12);
  });

  const wait = settleProcessCaptureJournal(journal, 20, 200);
  // Stall the event loop past the quiet window so the settle wake-up and the
  // trailing observation are both already due when timer callbacks resume.
  const stalledUntil = Date.now() + 40;
  while (Date.now() < stalledUntil) {
    // Deliberately occupy the loop; no timer can run until this returns.
  }
  await wait;

  expect(journal).toHaveLength(2);
  expect(journal[1]).toMatchObject({ collection: "frames", index: 1 });
  await lateFrame;
});

it("keeps empty cleanup exception messages actionable in the report", async () => {
  const host: ProcessCaptureCleanupHost = {
    platform: process.platform,
    cleanupProcessGroup: async () => ({
      cleaned: false,
      reason: "unused process cleanup",
    }),
    removeTemporaryRoot: async () => {
      throw new Error("");
    },
  };
  const outcome = await releaseProcessResources({
    timers: new Set(),
    terminal: undefined,
    renderer: undefined,
    runId: "fixture-run",
    temporaryRoot: "/fixture/root",
    host,
  });

  expect(outcome.report.temporary_root).toEqual({
    state: "failed",
    reason: "Error",
  });
});

it("retains observations and retries the temporary root when process cleanup throws", async () => {
  const cleanupFailure = new Error("termination inspection failed");
  let rootRemovalFails = true;
  const removeTemporaryRoot = vi.fn(async () => {
    if (rootRemovalFails) throw new Error("root removal denied");
  });
  let failing = true;
  const scope = new ProcessCaptureResourceScope();
  const host: ProcessCaptureCleanupHost = {
    platform: "linux",
    cleanupProcessGroup: async () => {
      if (failing) throw cleanupFailure;
      return { cleaned: true, signaled: true };
    },
    removeTemporaryRoot,
  };
  const cleanup = await scope.release({
    timers: new Set(),
    terminal: { pid: 321 },
    renderer: undefined,
    runId: "fixture-run",
    temporaryRoot: "/fixture/root",
    host,
  });

  expect(removeTemporaryRoot).not.toHaveBeenCalled();
  expect(cleanup.report.temporary_root).toEqual({
    state: "unverified",
    reason: `temporary root retained because owned process cleanup is failed: ${cleanupFailure.message}`,
  });
  expect(cleanup.report.owned_process_group).toMatchObject({
    state: "failed",
    reason: cleanupFailure.message,
  });
  expect(cleanup.cleanupLease?.cleanupResources).toEqual([
    "owned_process_group",
    "/fixture/root",
  ]);
  const executionFailure = new Error("capture snapshot failed");
  const capture = parseProcessCapture({
    ...accountFullyObservedProcessCapture({
      ...emptyProcessCapture(),
      frames: [{ sequence: 0, at_ms: 0, data: "collected before failure" }],
    }),
    event_journal: [],
  });
  try {
    resolveProcessResult(capture, executionFailure, cleanup);
    throw new Error("expected cleanup failure");
  } catch (cause: unknown) {
    if (!(cause instanceof ProcessCaptureError)) throw cause;
    expect(cause.cause).toBe(executionFailure);
    expect(
      analysisErrorProjectionSchema.parse(projectAnalysisError(cause)),
    ).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        resources: ["owned_process_group", "/fixture/root"],
        cleanup_report: cleanup.report,
        execution_failure: "capture snapshot failed",
        partial_observation: {
          capture: { frames: [{ data: "collected before failure" }] },
        },
      },
    });
  }
  failing = false;
  await expect(scope.retryCleanup()).rejects.toMatchObject({
    cleanupResources: ["/fixture/root"],
  });
  expect(cleanup.cleanupLease?.cleanupResources).toEqual(["/fixture/root"]);
  rootRemovalFails = false;
  await scope.retryCleanup();
  expect(removeTemporaryRoot).toHaveBeenCalledWith("/fixture/root");
  await scope.close();
  expect(removeTemporaryRoot).toHaveBeenCalledTimes(2);
});

it("retains unrelated withheld processes through cleanup, capture, and JSON", async () => {
  const host: ProcessCaptureCleanupHost = {
    platform: "darwin",
    cleanupProcessGroup: async () => ({
      cleaned: true,
      signaled: true,
      unverified: [
        { pid: 900, diagnostic: "platform_binary_environment_withheld" },
        { pid: 901, diagnostic: "foreign uid: EINVAL" },
      ],
    }),
    removeTemporaryRoot: async () => undefined,
  };
  const outcome = await releaseProcessResources({
    timers: new Set(),
    terminal: { pid: 321 },
    renderer: undefined,
    runId: "fixture-run",
    temporaryRoot: "/fixture/root",
    host,
  });
  const unverified = [
    { pid: 900, reason: "platform_binary_environment_withheld" },
    { pid: 901, reason: "foreign uid: EINVAL" },
  ];
  expect(outcome.report.owned_process_group).toEqual({
    state: "cleaned",
    reason: null,
    unverified_processes: unverified,
  });
  const original = emptyProcessCapture();
  const { cleanup: previousCleanup, ...pending } = original;
  for (const input of [pending, original]) {
    const resolved = resolveProcessResult(input, undefined, outcome);
    const serialized: unknown = JSON.parse(JSON.stringify(resolved));
    const capture = parseProcessCapture(serialized);
    expect(capture.cleanup).toEqual({
      ...previousCleanup,
      unverified_processes: unverified,
    });
    expect(capture.residual_unknowns).toEqual([
      ...original.residual_unknowns,
      {
        scope: "process",
        reason: expect.stringContaining("900 could not be verified"),
      },
      {
        scope: "process",
        reason: expect.stringContaining("901 could not be verified"),
      },
    ]);
  }
});

it("passes sampled detached groups into cleanup even when their token is unknown", async () => {
  let sampledGroups: readonly number[] | undefined;
  const host: ProcessCaptureCleanupHost = {
    platform: "linux",
    cleanupProcessGroup: async (ownership) => {
      sampledGroups = ownership.sampledProcessGroupIds;
      return {
        cleaned: false,
        reason: "sampled group has no verifiable run token",
      };
    },
    removeTemporaryRoot: async () => undefined,
  };

  const outcome = await releaseProcessResources({
    timers: new Set(),
    terminal: { pid: 321 },
    renderer: undefined,
    runId: "fixture-run",
    temporaryRoot: "/fixture/root",
    sampledProcessGroupIds: [654],
    host,
  });

  expect(sampledGroups).toEqual([654]);
  expect(outcome.report.owned_process_group).toEqual({
    state: "unverified",
    reason: "sampled group has no verifiable run token",
  });
});

it("retains observations and both causes when process cleanup is unverifiable", () => {
  const verified = emptyProcessCapture();
  const capture = parseProcessCapture({
    ...accountFullyObservedProcessCapture({
      ...verified,
      frames: [{ sequence: 0, at_ms: 0, data: "observed output" }],
      process_samples: [
        {
          at_ms: 1,
          pid: 654,
          parent_pid: 321,
          command: "sanitized-detached-child",
          process_group_id: 654,
          session_id: 654,
        },
      ],
    }),
    event_journal: [],
  });
  const executionFailure = new Error("capture ended after a fixture error");
  const cleanup = {
    owned_process_group: {
      state: "unverified" as const,
      reason:
        "process ownership token could not be read for 1 live process(es): environment_unavailable=1; live candidates 900=environment_unavailable",
      unverified_processes: [
        { pid: 900, reason: "platform_binary_environment_withheld" },
      ],
    },
    terminal_renderer: { state: "cleaned" as const, reason: null },
    temporary_root: { state: "cleaned" as const, reason: null },
  };

  let error: ProcessCaptureError | undefined;
  try {
    resolveProcessResult(
      capture,
      executionFailure,
      historicalCleanupOutcome(cleanup),
    );
  } catch (cause: unknown) {
    if (!(cause instanceof ProcessCaptureError)) throw cause;
    error = cause;
  }
  if (error === undefined) throw new Error("expected cleanup-incomplete error");

  const projection = projectAnalysisError(error);
  const parsedProjection = analysisErrorProjectionSchema.parse(projection);
  expect(parsedProjection).toMatchObject({
    code: "cleanup_incomplete",
    details: {
      cleanup_report: cleanup,
      execution_failure: "capture ended after a fixture error",
      partial_observation: {
        capture: {
          frames: [{ data: "observed output" }],
          process_samples: [{ pid: 654, process_group_id: 654 }],
          settlement: { cleanup_outcome: "failed" },
        },
        execution_failure: "capture ended after a fixture error",
      },
    },
  });
  expect(error.cause).toBe(executionFailure);
  const partialObservation = error.partialObservation;
  expect(partialObservation).toBeDefined();
  if (partialObservation === undefined)
    throw new Error("expected validated partial observation");
  expect(
    partialProcessCaptureObservationSchema.safeParse({
      ...partialObservation,
      cleanup: {
        owned_process_group: { state: "cleaned", reason: null },
        terminal_renderer: { state: "cleaned", reason: null },
        temporary_root: { state: "cleaned", reason: null },
      },
      execution_failure: null,
    }).success,
  ).toBe(false);
  expect(
    partialProcessCaptureObservationSchema.safeParse({
      ...partialObservation,
      cleanup: {
        owned_process_group: { state: "cleaned", reason: null },
        terminal_renderer: { state: "cleaned", reason: null },
        temporary_root: { state: "cleaned", reason: null },
      },
      execution_failure: "capture ended after a fixture error",
    }).success,
  ).toBe(true);
  if (!("capture" in partialObservation))
    throw new Error("expected completed partial capture observations");
  const partialCapture = partialObservation.capture;
  expect(() => parseProcessCapture(partialCapture)).toThrow();
});

it("projects execution and cleanup failures when capture never completed", () => {
  const executionFailure = new Error("terminal startup failed");
  const cleanup = {
    owned_process_group: {
      state: "unverified" as const,
      reason: "process ownership token could not be read",
    },
    terminal_renderer: { state: "cleaned" as const, reason: null },
    temporary_root: { state: "cleaned" as const, reason: null },
  };

  let error: ProcessCaptureError | undefined;
  try {
    resolveProcessResult(
      undefined,
      executionFailure,
      historicalCleanupOutcome(cleanup),
    );
  } catch (cause: unknown) {
    if (!(cause instanceof ProcessCaptureError)) throw cause;
    error = cause;
  }
  if (error === undefined) throw new Error("expected cleanup-incomplete error");

  expect(error.partialObservation).toBeUndefined();
  expect(error.cause).toBe(executionFailure);
  expect(projectAnalysisError(error)).toMatchObject({
    code: "cleanup_incomplete",
    details: {
      cleanup_report: cleanup,
      execution_failure: "terminal startup failed",
    },
  });
});

it("retains completed observations when finalization fails after clean cleanup", () => {
  const capture = parseProcessCapture({
    ...accountFullyObservedProcessCapture({
      ...emptyProcessCapture(),
      frames: [{ sequence: 0, at_ms: 0, data: "observed before finalization" }],
    }),
    event_journal: [],
  });
  const executionFailure = new Error("final filesystem snapshot failed");
  const cleanup = {
    owned_process_group: { state: "cleaned" as const, reason: null },
    terminal_renderer: { state: "cleaned" as const, reason: null },
    temporary_root: { state: "cleaned" as const, reason: null },
  };

  let error: ProcessCaptureError | undefined;
  try {
    resolveProcessResult(
      capture,
      executionFailure,
      historicalCleanupOutcome(cleanup),
    );
  } catch (cause: unknown) {
    if (!(cause instanceof ProcessCaptureError)) throw cause;
    error = cause;
  }
  if (error === undefined) throw new Error("expected capture failure");

  expect(error).toMatchObject({
    reason: "capture_failed",
    cleanupIncomplete: false,
    executionFailure: "final filesystem snapshot failed",
    cleanupReport: cleanup,
  });
  expect(error.cause).toBe(executionFailure);
  expect(error.partialObservation).toMatchObject({
    capture: {
      frames: [{ data: "observed before finalization" }],
      settlement: { cleanup_outcome: "not_required" },
    },
    cleanup,
    execution_failure: "final filesystem snapshot failed",
  });
  expect(projectAnalysisError(error)).toMatchObject({
    code: "process_capture_failed",
    details: {
      cleanup_report: cleanup,
      execution_failure: "final filesystem snapshot failed",
      partial_observation: {
        capture: { frames: [{ data: "observed before finalization" }] },
      },
    },
  });
  expect(
    analysisErrorProjectionSchema.safeParse(projectAnalysisError(error))
      .success,
  ).toBe(true);
});

it("preserves cancellation while projecting observations and successful cleanup", () => {
  const capture = parseProcessCapture({
    ...accountFullyObservedProcessCapture({
      ...emptyProcessCapture(),
      frames: [{ sequence: 0, at_ms: 0, data: "observed before cancellation" }],
    }),
    event_journal: [],
  });
  const cleanup = {
    owned_process_group: { state: "cleaned" as const, reason: null },
    terminal_renderer: { state: "cleaned" as const, reason: null },
    temporary_root: { state: "cleaned" as const, reason: null },
  };
  let error: ProcessCaptureError | undefined;
  try {
    resolveProcessResult(
      capture,
      processCaptureCancelled(),
      historicalCleanupOutcome(cleanup),
    );
  } catch (cause: unknown) {
    if (!(cause instanceof ProcessCaptureError)) throw cause;
    error = cause;
  }
  if (error === undefined) throw new Error("expected cancellation");

  expect(projectAnalysisError(error)).toMatchObject({
    code: "cancelled",
    message: "Process capture was cancelled. Start it again when ready.",
    details: {
      operation: "process_capture",
      cleanup: "complete",
      cleanup_report: cleanup,
      partial_observation: {
        capture: { frames: [{ data: "observed before cancellation" }] },
      },
    },
  });
});

it("fails closed on Windows before resolving or launching scenario paths", async () => {
  const scenario = processScenarioSchema.parse({
    executable: "Z:/missing/should-never-be-resolved.exe",
    working_directory: "Z:/missing/working-directory",
  });
  const result = await captureProcessScenario(scenario, undefined, "win32");
  if (result.ok) throw new Error("expected Windows ownership refusal");
  if (!(result.error instanceof AnalysisCapabilityUnavailableError))
    throw new Error("expected a capability-unavailable outcome");
  expect(result.error).toMatchObject({
    operation: "capture_process_scenario",
    reason: expect.stringContaining("Windows PTY process capture"),
  });
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "capability_unavailable",
    category: "unsupported_provider",
    message: expect.stringContaining("does not yet verify descendant cleanup"),
    details: {
      operation: "capture_process_scenario",
      reason: result.error.reason,
    },
  });
});

it("retains the root start identity once at launch and signals only with it", async () => {
  const observe = vi.fn(async () => ({
    state: "readable" as const,
    identity: "id-launch",
  }));
  const signal = vi.fn(async () => "signaled" as const);
  const signalRoot = retainRootSignaller(4242, 500, "captured-run", {
    observe,
    signal,
  });

  expect(
    observe,
    "the identity is read at launch, before any signal",
  ).toHaveBeenCalledTimes(1);
  expect(
    await signalRoot("SIGTERM"),
    "a matching identity is signalled",
  ).toEqual({
    delivery: "signaled",
  });
  await signalRoot("SIGKILL");

  expect(
    observe,
    "later signals never re-read the identity",
  ).toHaveBeenCalledTimes(1);
  expect(
    signal.mock.calls,
    "both signals carry the pid and the identity retained at launch",
  ).toEqual([
    [4242, "id-launch", "SIGTERM"],
    [4242, "id-launch", "SIGKILL"],
  ]);
});

it.each([
  ["a vanished root", async () => undefined, { delivery: "gone" }],
  [
    "an unreadable identity",
    async () => ({ state: "unavailable" as const, reason: "unsupported" }),
    { delivery: "unverified", reason: "unsupported" },
  ],
  [
    "a failed identity read",
    async () => {
      throw new Error("ps failed");
    },
    { delivery: "unverified", reason: "ps failed" },
  ],
])(
  "never signals without a retained identity: %s",
  async (_label, read, delivery) => {
    const signal = vi.fn(async () => "signaled" as const);
    const signalRoot = retainRootSignaller(4242, 500, "captured-run", {
      observe: read,
      signal,
    });

    expect(
      await signalRoot("SIGTERM"),
      "the delivery result is recorded",
    ).toEqual(delivery);
    expect(signal, "no identity means no signal at all").not.toHaveBeenCalled();
  },
);

it("does not read an identity when there is no finalization interval", async () => {
  const observe = vi.fn(async () => undefined);
  const signalRoot = retainRootSignaller(4242, 0, "captured-run", {
    observe,
    signal: vi.fn(async () => "signaled" as const),
  });

  expect(
    observe,
    "the zero-interval path never inspects the root",
  ).not.toHaveBeenCalled();
  expect(
    await signalRoot("SIGKILL"),
    "an unretained identity stays unverified",
  ).toEqual({
    delivery: "unverified",
    reason: "root identity was not retained",
  });
});

it.each(["signaled", "gone", "identity-changed", "unverified"] as const)(
  "reports the identity-checked delivery result %s unchanged",
  async (delivery) => {
    const signalRoot = retainRootSignaller(4242, 500, "captured-run", {
      observe: async () => ({ state: "readable", identity: "id-launch" }),
      signal: async () => delivery,
    });

    expect(
      await signalRoot("SIGKILL"),
      "the signaller result is not coerced",
    ).toEqual(
      delivery === "unverified"
        ? {
            delivery,
            reason:
              "start identity could not be verified or the signal call failed",
          }
        : { delivery },
    );
  },
);

it("seeds a finalization observation only for a scenario with an interval", () => {
  const seed = {
    frames: [],
    interactions: [],
    samples: [],
    eventJournal: [],
    before: {
      files: [],
      truncated: false,
      completeRoots: [],
      coverage: emptyFilesystemCoverage,
    },
  };

  expect(
    Object.keys(createProcessCaptureObservationBuffer(seed)),
    "a default scenario keeps the base observation keys",
  ).not.toContain("finalization");
  expect(
    Object.keys(
      createProcessCaptureObservationBuffer({
        ...seed,
        finalizationEnabled: true,
      }),
    ),
    "a scenario with an interval carries the finalization observation",
  ).toContain("finalization");
});

it("keeps a non-empty reason when the identity inspection fails without a message", async () => {
  const signalRoot = retainRootSignaller(4242, 500, "captured-run", {
    observe: async () => {
      throw new Error();
    },
    signal: vi.fn(async () => "signaled" as const),
  });

  const result = await signalRoot("SIGTERM");

  expect(result.delivery, "the attempt is unverified").toBe("unverified");
  expect(
    result.reason?.length,
    "the reason is never empty, which the capture schema would reject",
  ).toBeGreaterThan(0);
});

it("keeps a non-empty reason when the identity diagnostic is empty", async () => {
  const signalRoot = retainRootSignaller(4242, 500, "captured-run", {
    observe: async () => ({ state: "unavailable" as const, reason: "" }),
    signal: vi.fn(async () => "signaled" as const),
  });

  const result = await signalRoot("SIGTERM");

  expect(
    result.reason?.length,
    "an empty diagnostic is replaced by a named fallback",
  ).toBeGreaterThan(0);
});
