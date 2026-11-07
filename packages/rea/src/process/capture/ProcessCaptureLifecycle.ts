import { createHash, randomUUID } from "node:crypto";
import { constants, statSync, type BigIntStats } from "node:fs";
import { open, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate, setTimeout as delay } from "node:timers/promises";
import { readFileHandleChunks } from "../../filesystem/readFileHandleChunks.js";
import type { IPty } from "@lydell/node-pty";
import {
  AnalysisCleanupLease,
  AnalysisCleanupLeaseGroup,
} from "../../artifacts/AnalysisCleanupLease.js";

import type { ProcessCapture } from "../../domain/process/processCaptureParsing.js";
import type { ProcessScenario } from "../../domain/process/processScenario.js";
import {
  digestProcessCommitment,
  processComparisonContract,
  processScenarioCommitment,
} from "../../domain/process/processScenario.js";
import { parseProcessCapture } from "../../domain/process/processCaptureParsing.js";
import { PRODUCT_IDENTITY } from "../../identity.js";
import {
  snapshotRoots,
  ProcessCaptureSnapshotFailure,
} from "./FilesystemSnapshot.js";
import {
  withProcessCaptureFile,
  ProcessCaptureReadFailure,
  type ProcessCaptureCleanupRetainer,
} from "./ProcessCaptureRead.js";
import { classifyFilesystemEffects } from "./ProcessFilesystemEffects.js";
import {
  cleanupOwnedProcessGroup,
  type OwnedProcessGroup,
  type ProcessOwnershipBaseline,
  type ProcessOwnershipHost,
} from "../ProcessOwnership.js";
import {
  observeOwnedProcessGroups,
  prepareProcessOwnershipInspection,
  systemProcessOwnershipHost,
} from "../ProcessOwnershipObservation.js";
import { ProcessOwnershipEvidenceOwner } from "../ProcessOwnershipEvidence.js";
import {
  describeProcessCaptureExecutionFailure,
  normalizeCaptureFailure,
  processCaptureCancelled,
  ProcessCaptureError,
} from "./ProcessCaptureError.js";
import { assertNotCancelled } from "./ProcessScenarioRuntimeValidation.js";
import {
  normalizeProcessElapsedTime,
  normalizeProcessSamples,
  normalizeRetainedTerminalFrames,
  type BoundedProcessTextNormalization,
} from "./ProcessNormalization.js";
import { PROCESS_PROVIDER } from "../../domain/process/processEvidenceProvider.js";
import { TerminalRenderer } from "./TerminalRenderer.js";
import type { ProcessSensitiveOutput } from "./ProcessSensitiveOutput.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import { jsonValueSchema } from "../../domain/jsonValue.js";
import {
  hasCaptureTruncation,
  type NormalizedTerminalRetention,
  type TerminalRetention,
  type ProcessCaptureTruncationDetails,
} from "../../domain/process/processCaptureCoverage.js";
import { scheduleProcessInterval, type ProcessTimer } from "./ProcessTimer.js";
import { monotonicProcessCaptureClock } from "./ProcessCaptureClock.js";

import type {
  FilesystemCheckpoint,
  InteractionEvent,
  ProcessCaptureFinalization,
  UnverifiedProcessCapture,
  ProcessSample,
  ProcessSettlement,
  ProcessCaptureCleanupReport,
  PartialProcessCaptureObservation,
  IncompleteProcessCaptureObservations,
  ProcessFilesystemSnapshot,
  PartialProcessObservationField,
  ProcessCaptureEventJournalEntry,
  RecordProcessCaptureEvent,
  TerminalFrame,
} from "../../domain/process/processCapture.js";
import { partialProcessCaptureObservationSchema } from "../../domain/process/processCapture.js";
interface TerminalExitOptions {
  readonly terminal: Pick<IPty, "onExit" | "kill">;
  readonly scenario: ProcessScenario;
  readonly started: number;
  readonly lastOutput: () => number;
  readonly signal: AbortSignal | undefined;
  /** Identity-checked signal to the captured root, used only during finalization. */
  readonly signalTarget: (signal: FinalizationSignal) => Promise<{
    readonly delivery: FinalizationDelivery;
    readonly reason?: string | undefined;
  }>;
  /** Receives the attempts so far, so a later failure keeps them. */
  readonly recordFinalization: (
    finalization: ProcessCaptureFinalization,
  ) => void;
  readonly timers: Set<ProcessTimer>;
  readonly interactions: InteractionEvent[];
  readonly dispatchedEventIndexes: ReadonlySet<number>;
  readonly recordEvent: RecordProcessCaptureEvent;
  readonly onLiveProgress?: () => void;
}

type FinalizationSignal =
  ProcessCaptureFinalization["signals"][number]["signal"];
type FinalizationDelivery =
  ProcessCaptureFinalization["signals"][number]["delivery"];

/** The capture's exit, or the facts known when no exit could be observed. */
export type TerminalExitResult =
  | {
      readonly unobserved?: false;
      readonly exitCode: number;
      readonly signal?: number;
      readonly reason: "exited" | "timeout" | "idle_timeout" | "cancelled";
      readonly finalization?: ProcessCaptureFinalization;
    }
  | {
      readonly unobserved: true;
      readonly reason: "timeout" | "idle_timeout" | "cancelled";
      readonly finalization: ProcessCaptureFinalization;
    };

/**
 * The target's normal exit code. A signal-terminated process has none, so a
 * nonzero signal yields null even when the PTY reports a numeric code.
 */
const normalExitCode = (exit: {
  readonly exitCode: number;
  readonly signal?: number;
}): number | null =>
  exit.exitCode >= 0 && (exit.signal ?? 0) === 0 ? exit.exitCode : null;

/** Project an observed exit; only an `exited` reason carries a normal code. */
export const captureExitObservation = <
  Reason extends TerminalExitResult["reason"],
>(exit: {
  readonly exitCode: number;
  readonly signal?: number;
  readonly reason: Reason;
  readonly finalization?: ProcessCaptureFinalization;
}) => ({
  code: exit.reason === "exited" ? normalExitCode(exit) : null,
  signal: exit.signal ?? null,
  reason: exit.reason,
  ...(exit.finalization === undefined
    ? {}
    : { finalization: exit.finalization }),
});

interface CaptureResultOptions {
  readonly frames: readonly TerminalFrame[];
  readonly exit: {
    readonly exitCode: number;
    readonly signal?: number;
    readonly reason: "exited" | "timeout" | "idle_timeout";
    readonly finalization?: ProcessCaptureFinalization;
  };
  readonly samples: readonly ProcessSample[];
  readonly before: ProcessFilesystemSnapshot;
  readonly after: ProcessFilesystemSnapshot;
  readonly truncationDetails: ProcessCaptureTruncationDetails;
  readonly scenario: ProcessScenario;
  readonly rootPid: number;
  readonly samplingPartial: boolean;
  readonly renderedFrames: UnverifiedProcessCapture["rendered_frames"];
  readonly interactions: readonly InteractionEvent[];
  readonly checkpoints: readonly FilesystemCheckpoint[];
  readonly settlement: ObservedProcessSettlement;
  readonly manifest: UnverifiedProcessCapture["manifest"];
  readonly eventJournal: readonly ProcessCaptureEventJournalEntry[];
}

/** Settlement observation before process-resource cleanup has completed. */
export type ObservedProcessSettlement =
  | Pick<
      Extract<ProcessSettlement, { readonly state: "quiesced" }>,
      "state" | "elapsed_ms"
    >
  | Pick<
      Exclude<ProcessSettlement, { readonly state: "quiesced" }>,
      "state" | "elapsed_ms"
    >;

/** Capture observations before owned-resource cleanup has been verified. */
export type PendingProcessCapture = Omit<
  UnverifiedProcessCapture,
  "cleanup" | "settlement"
> & {
  readonly settlement: ObservedProcessSettlement;
};

/** Mutable collection of facts available if completion stops before a capture exists. */
export interface ProcessCaptureObservationBuffer {
  target_pid: PartialProcessObservationField<number>;
  frames: PartialProcessObservationField<readonly TerminalFrame[]>;
  rendered_frames: PartialProcessObservationField<
    UnverifiedProcessCapture["rendered_frames"]
  >;
  interaction_events: PartialProcessObservationField<
    UnverifiedProcessCapture["interaction_events"]
  >;
  exit: IncompleteProcessCaptureObservations["exit"];
  finalization?: IncompleteProcessCaptureObservations["finalization"];
  settlement: IncompleteProcessCaptureObservations["settlement"];
  process_samples: PartialProcessObservationField<readonly ProcessSample[]>;
  filesystem_snapshots: {
    before: PartialProcessObservationField<ProcessFilesystemSnapshot>;
    after: PartialProcessObservationField<ProcessFilesystemSnapshot>;
  };
  event_journal: PartialProcessObservationField<
    readonly ProcessCaptureEventJournalEntry[]
  >;
  manifest: IncompleteProcessCaptureObservations["manifest"];
}

/** Seed explicit observation availability before capture completion begins. */
export const createProcessCaptureObservationBuffer = (options: {
  readonly frames: readonly TerminalFrame[];
  readonly interactions: readonly InteractionEvent[];
  readonly samples: readonly ProcessSample[];
  readonly eventJournal: readonly ProcessCaptureEventJournalEntry[];
  readonly before: ProcessFilesystemSnapshot | undefined;
  /** Seed a finalization observation only for a scenario with an interval. */
  readonly finalizationEnabled?: boolean;
}): ProcessCaptureObservationBuffer => ({
  target_pid: {
    state: "unavailable",
    reason: "No PTY process was spawned before the run failed.",
  },
  frames: { state: "available", value: options.frames },
  rendered_frames: {
    state: "unavailable",
    reason:
      "Rendered terminal frames were not collected before capture completion finished.",
  },
  interaction_events: { state: "available", value: options.interactions },
  exit: {
    state: "unavailable",
    reason: "Terminal exit was not observed before the run failed.",
  },
  ...(options.finalizationEnabled === true
    ? {
        finalization: {
          state: "unavailable" as const,
          reason:
            "Finalization was not observed before capture completion finished.",
        },
      }
    : {}),
  settlement: {
    state: "unavailable",
    reason:
      "Process settlement was not observed before capture completion finished.",
  },
  process_samples: { state: "available", value: options.samples },
  filesystem_snapshots: {
    before:
      options.before === undefined
        ? {
            state: "unavailable",
            reason: "Initial filesystem snapshot did not complete.",
          }
        : { state: "available", value: options.before },
    after: {
      state: "unavailable",
      reason:
        "Final filesystem snapshot was not collected before capture completion finished.",
    },
  },
  event_journal: { state: "available", value: options.eventJournal },
  manifest: {
    state: "unavailable",
    reason:
      "Capture manifest was not produced before capture completion finished.",
  },
});

const normalizePartialProcessObservations = (
  observations: IncompleteProcessCaptureObservations,
  context: { readonly scenario: ProcessScenario; readonly rootPid?: number },
): IncompleteProcessCaptureObservations => {
  const targetPid = observations.target_pid;
  const target_pid =
    targetPid.state === "available" && context.rootPid !== undefined
      ? {
          state: "available" as const,
          value: context.scenario.normalization.pids ? 1 : context.rootPid,
        }
      : targetPid;
  const samples = observations.process_samples;
  const process_samples =
    samples.state === "available" && context.rootPid !== undefined
      ? {
          state: "available" as const,
          value: normalizeProcessSamples(
            samples.value,
            context.scenario,
            context.rootPid,
          ),
        }
      : samples;
  return { ...observations, target_pid, process_samples };
};

/** Wait for trailing PTY callbacks before the capture becomes immutable. */
export const settleProcessCaptureJournal = async (
  journal: readonly ProcessCaptureEventJournalEntry[],
  quietMs = 25,
  maxWaitMs = 500,
): Promise<void> => {
  const deadline = monotonicProcessCaptureClock() + maxWaitMs;
  let observed = journal.length;
  let lastChangeAt = monotonicProcessCaptureClock();
  while (monotonicProcessCaptureClock() < deadline) {
    await delay(4);
    // A stalled event loop can leave timer and poll callbacks that were already
    // due queued behind this wake-up. Drain them before judging silence so a
    // trailing observation is not dropped by an early settle.
    await setImmediate();
    if (journal.length !== observed) {
      observed = journal.length;
      lastChangeAt = monotonicProcessCaptureClock();
    } else if (monotonicProcessCaptureClock() - lastChangeAt >= quietMs) return;
  }
};

export const buildCaptureResult = (
  options: CaptureResultOptions,
): PendingProcessCapture => {
  const hasSensitiveScriptedInput = options.scenario.events.some(
    (event) => event.type === "input" && event.sensitive,
  );
  const sensitiveInputUnknown =
    "Sensitive scripted input literals and retained terminal echoes are redacted. Terminal states are reconstructed from the redacted stream; private display effects and transformed values remain unknown.";
  const filesystemObservationUnknown =
    "No filesystem observation paths were selected; filesystem effects remain unknown.";
  const hasFilesystemObservations =
    options.scenario.filesystem_observation_paths.length > 0;
  const filesystemEffects = classifyFilesystemEffects(
    options.before,
    options.after,
  );
  const filesystemUnknowns = [
    ...new Set(
      filesystemEffects.flatMap((effect) =>
        effect.status === "unknown" ? [effect.reason] : [],
      ),
    ),
  ];
  return {
    manifest: options.manifest,
    normalization: options.scenario.normalization,
    frames: options.frames,
    rendered_frames: options.renderedFrames,
    interaction_events: options.interactions,
    exit: captureExitObservation(options.exit),
    settlement: options.settlement,
    process_samples: normalizeProcessSamples(
      options.samples,
      options.scenario,
      options.rootPid,
    ),
    filesystem_checkpoints: options.checkpoints,
    event_journal: options.eventJournal,
    files_before: options.before.files,
    files_after: options.after.files,
    filesystem_effects: filesystemEffects,
    truncated: hasCaptureTruncation(options.truncationDetails),
    truncation_details: options.truncationDetails,
    limitations: [
      "The executable digest is a prelaunch file sample; matching path metadata immediately after spawn does not prove an atomic operating-system image binding.",
      ...(Date.parse(options.manifest.completed_at) <
      Date.parse(options.manifest.started_at)
        ? [
            "Wall-clock completion time precedes start time; elapsed capture timing is recorded separately and remains monotonic.",
          ]
        : []),
      "Process trees are sampled and may omit short-lived descendants.",
      ...(options.samplingPartial
        ? ["Process-tree sampling ended with an incomplete observation."]
        : []),
      "Filesystem observations are before/after snapshots, not syscall traces.",
      "Inherited host environment variables are not recorded and may affect results.",
      ...(!hasFilesystemObservations ? [filesystemObservationUnknown] : []),
      ...filesystemUnknowns,
      ...captureCoverageUnknowns(options.truncationDetails).map(
        ({ reason }) => reason,
      ),
      ...(hasSensitiveScriptedInput ? [sensitiveInputUnknown] : []),
    ],
    residual_unknowns: [
      {
        scope: "process",
        reason:
          "Process trees are sampled and may omit short-lived descendants.",
      },
      {
        scope: "process",
        reason:
          "The executable digest is a prelaunch file sample; operating-system image binding is not atomically observed.",
      },
      {
        scope: "environment",
        reason: "Inherited host environment variables are not recorded.",
      },
      {
        scope: "network",
        reason: "Network activity is not observed by this capture.",
      },
      ...(!hasFilesystemObservations
        ? [
            {
              scope: "filesystem" as const,
              reason: filesystemObservationUnknown,
            },
          ]
        : []),
      ...filesystemUnknowns.map((reason) => ({
        scope: "filesystem" as const,
        reason,
      })),
      ...(hasSensitiveScriptedInput
        ? [
            { scope: "interaction" as const, reason: sensitiveInputUnknown },
            { scope: "terminal" as const, reason: sensitiveInputUnknown },
          ]
        : []),
      ...captureCoverageUnknowns(options.truncationDetails).filter(
        ({ scope }) => scope !== "terminal",
      ),
    ],
  };
};

const captureCoverageUnknowns = (
  details: ProcessCaptureTruncationDetails,
): UnverifiedProcessCapture["residual_unknowns"] => {
  const unknowns: Array<UnverifiedProcessCapture["residual_unknowns"][number]> =
    [];
  if (
    details.raw_terminal.observed_frames > details.raw_terminal.retained_frames
  )
    unknowns.push({
      scope: "terminal",
      reason:
        (details.normalized_terminal?.omitted_frames ?? 0) > 0
          ? "Raw PTY chunks were omitted because original input exceeded output_bytes or an ordered normalization stage exceeded its remaining bound; final normalized sizes for the latter omissions are unknown. Rendered states also lack those inputs. See raw_terminal and normalized_terminal retention details, including the normalized omission count."
          : "Raw PTY chunks exceeded output_bytes and were omitted; rendered states also lack those inputs. See truncation_details.raw_terminal.",
    });
  if ((details.raw_terminal.redacted_bytes ?? 0) > 0)
    unknowns.push({
      scope: "terminal",
      reason:
        "Sensitive terminal text was removed before rendering. Redacted bytes still consume the original output budget. When retained input has gaps, all retained terminal text is withheld; private display effects remain unknown.",
    });
  if (
    details.rendered_terminal.observed_frames >
    details.rendered_terminal.retained_frames
  )
    unknowns.push({
      scope: "terminal",
      reason:
        (details.rendered_terminal.normalization_over_budget_frames ?? 0) > 0
          ? "Rendered frames were omitted because a normalization stage exceeded the remaining output_bytes budget; final rendered byte totals are unknown for those frames. See truncation_details.rendered_terminal."
          : "Cumulative rendered state and visible-line bytes exceeded output_bytes; whole rendered frames were omitted. Raw PTY coverage is reported separately. See truncation_details.rendered_terminal.",
    });
  for (const [name, coverage] of [
    ["before", details.filesystem_before],
    ["after_settlement", details.filesystem_after],
  ] as const) {
    for (const subtree of coverage.unobserved_subtrees ?? [])
      unknowns.push({
        scope: "filesystem",
        reason: `Filesystem ${name} subtree ${subtree.path} was outside observation: ${subtree.reason === "symlink_not_followed" ? "symbolic links are not followed" : "the exact observer-owned directory is excluded, including target activity within it"}.`,
      });
    if (coverage.enumeration_truncated)
      unknowns.push({
        scope: "filesystem",
        reason: `Filesystem ${name} path enumeration was incomplete: ${coverage.enumeration_reasons.join(", ")}. See truncation_details.`,
      });
    if (coverage.hash_omissions.length > 0)
      unknowns.push({
        scope: "filesystem",
        reason: `Filesystem ${name} omitted ${String(coverage.hash_omissions.length)} whole-file digests; per-path reasons and remaining file_bytes budget are in truncation_details.`,
      });
  }
  if (details.process.sampling_partial)
    unknowns.push({
      scope: "process",
      reason:
        details.process.first_sampling_failure !== null
          ? `Process sampling has incomplete observations: ${details.process.first_sampling_failure}. See truncation_details.process.`
          : "The process sample limit was reached; see truncation_details.process.",
    });
  return unknowns;
};

interface ExecutableFileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly mode: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

export interface SelectedExecutableObservation {
  readonly sha256: string | null;
  readonly identity: ExecutableFileIdentity | null;
  readonly reason: string | null;
}

export interface LaunchedExecutableObservation {
  readonly selectedSha256: string | null;
  readonly sha256: string | null;
  readonly state: "path_metadata_unchanged" | "unknown";
  readonly reason: string | null;
}

const identityFromStats = (stats: BigIntStats): ExecutableFileIdentity => ({
  dev: stats.dev,
  ino: stats.ino,
  mode: stats.mode,
  size: stats.size,
  mtimeNs: stats.mtimeNs,
  ctimeNs: stats.ctimeNs,
});

const sameExecutableIdentity = (
  left: ExecutableFileIdentity,
  right: ExecutableFileIdentity,
): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs;

const filesystemFailure = (cause: unknown): string | undefined => {
  if (!(cause instanceof Error) || !("code" in cause) || !("syscall" in cause))
    return undefined;
  return `Executable file observation failed: ${cause.message}`;
};

/** Metadata IO seam for deterministic prelaunch cancellation and identity checks. */
export interface SelectedExecutableFileSystem {
  open(path: string, flags: number): ReturnType<typeof open>;
  stat(path: string): Promise<BigIntStats>;
}

const selectedExecutableFileSystem: SelectedExecutableFileSystem = {
  open,
  stat: (path) => stat(path, { bigint: true }),
};

/** Sample the selected file without launching it; retain cancellation and file identity. */
export const observeSelectedExecutable = async (
  path: string,
  signal?: AbortSignal,
  fileSystem: SelectedExecutableFileSystem = selectedExecutableFileSystem,
  cleanupRetainer?: ProcessCaptureCleanupRetainer,
): Promise<SelectedExecutableObservation> => {
  assertNotCancelled(signal);
  try {
    const handle = await fileSystem.open(
      path,
      constants.O_RDONLY | constants.O_NONBLOCK,
    );
    return await withProcessCaptureFile(
      path,
      handle,
      signal,
      cleanupRetainer,
      async (handle): Promise<SelectedExecutableObservation> => {
        const openedStats = await handle.stat({ bigint: true });
        if (!openedStats.isFile())
          return {
            sha256: null,
            identity: null,
            reason: "Selected executable is not a regular file.",
          };
        const openedIdentity = identityFromStats(openedStats);
        const selectedPathIdentity = identityFromStats(
          await fileSystem.stat(path),
        );
        if (!sameExecutableIdentity(openedIdentity, selectedPathIdentity))
          return {
            sha256: null,
            identity: null,
            reason:
              "Selected executable path changed while it was being opened.",
          };

        // IO above can settle after cancellation. Native FileHandle streams can
        // invalidate the descriptor on abort even with autoClose:false; borrowed
        // positional reads leave its close exclusively with the capture owner.
        assertNotCancelled(signal);
        const hash = createHash("sha256");
        for await (const chunk of readFileHandleChunks(handle, {
          signal,
          cancellationFailure: processCaptureCancelled,
        })) {
          assertNotCancelled(signal);
          hash.update(chunk);
        }
        assertNotCancelled(signal);
        const finalIdentity = identityFromStats(
          await handle.stat({ bigint: true }),
        );
        if (!sameExecutableIdentity(openedIdentity, finalIdentity))
          return {
            sha256: null,
            identity: null,
            reason:
              "Selected executable changed while its contents were sampled.",
          };
        return {
          sha256: hash.digest("hex"),
          identity: openedIdentity,
          reason: null,
        };
      },
    );
  } catch (cause: unknown) {
    if (
      cause instanceof ProcessCaptureReadFailure &&
      !cause.cleanupIncomplete &&
      cause.cancellation === undefined &&
      cause.outcome.kind === "failed"
    ) {
      const reason = filesystemFailure(cause.outcome.cause);
      if (reason !== undefined) return { sha256: null, identity: null, reason };
    }
    const failure = normalizeCaptureFailure(cause, signal);
    if (failure instanceof ProcessCaptureError) throw failure;
    const reason = filesystemFailure(failure);
    if (reason !== undefined) return { sha256: null, identity: null, reason };
    throw failure;
  }
};

/** Compare the selected file metadata with the path immediately after PTY spawn. */
export const observeLaunchedExecutable = (
  path: string,
  selected: SelectedExecutableObservation,
): LaunchedExecutableObservation => {
  if (selected.identity === null || selected.sha256 === null)
    return {
      selectedSha256: selected.sha256,
      sha256: null,
      state: "unknown",
      reason: selected.reason ?? "Selected executable identity is unavailable.",
    };
  try {
    const currentStats = statSync(path, { bigint: true });
    const currentIdentity = identityFromStats(currentStats);
    if (
      currentStats.isFile() &&
      sameExecutableIdentity(selected.identity, currentIdentity)
    )
      return {
        selectedSha256: selected.sha256,
        sha256: selected.sha256,
        state: "path_metadata_unchanged",
        reason: null,
      };
    return {
      selectedSha256: selected.sha256,
      sha256: null,
      state: "unknown",
      reason: "Executable path metadata changed between sampling and spawn.",
    };
  } catch (cause: unknown) {
    const reason = filesystemFailure(cause);
    if (reason !== undefined)
      return {
        selectedSha256: selected.sha256,
        sha256: null,
        state: "unknown",
        reason,
      };
    throw cause;
  }
};

export const createRunManifest = async (
  scenario: ProcessScenario,
  startedAt: Date,
  completedAt: Date,
  executable: LaunchedExecutableObservation,
  host: {
    readonly platform: NodeJS.Platform;
    readonly architecture: NodeJS.Architecture;
  } = {
    platform: process.platform,
    architecture: process.arch,
  },
): Promise<UnverifiedProcessCapture["manifest"]> => {
  const scenarioCommitment = processScenarioCommitment(
    scenario,
    executable.selectedSha256 ?? undefined,
  );
  const comparisonContract = processComparisonContract(scenario);
  return {
    rea_version: PRODUCT_IDENTITY.packageVersion,
    provider_version: PROCESS_PROVIDER.version,
    platform: host.platform,
    architecture: host.architecture,
    pty_backend: "node-pty",
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    scenario: scenarioCommitment,
    comparison_contract: comparisonContract,
    full_scenario_sha256: digestProcessCommitment(scenarioCommitment),
    comparison_contract_sha256: digestProcessCommitment(comparisonContract),
    selected_executable_sha256: executable.selectedSha256,
    executable_sha256: executable.sha256,
    executable_identity: {
      state: executable.state,
      reason: executable.reason,
    },
    normalization_sha256: digestProcessCommitment(scenario.normalization),
  };
};

export const observeSettlement = async ({
  runId,
  processGroupIds,
  ownershipEvidence,
  settleMs,
  recordEvent = () => undefined,
  platform = process.platform,
  signal,
  ownershipHost,
  onLiveProgress,
}: {
  readonly runId: string;
  readonly processGroupIds: readonly number[];
  readonly ownershipEvidence: ProcessOwnershipEvidenceOwner;
  readonly settleMs: number;
  readonly recordEvent?: RecordProcessCaptureEvent;
  readonly platform?: NodeJS.Platform;
  readonly signal?: AbortSignal | undefined;
  readonly ownershipHost?: ProcessOwnershipHost;
  readonly onLiveProgress?: (() => void) | undefined;
}): Promise<ObservedProcessSettlement> => {
  assertNotCancelled(signal);
  onLiveProgress?.();
  if (platform === "win32") {
    recordEvent("lifecycle", 1);
    return { state: "unverifiable", elapsed_ms: 0 };
  }
  const started = monotonicProcessCaptureClock();
  let consecutiveEmpty = 0;
  let sawLive = false;
  let deadlineReached = false;
  while (!deadlineReached) {
    onLiveProgress?.();
    assertNotCancelled(signal);
    const observations = await observeOwnedProcessGroups(
      runId,
      processGroupIds,
      ownershipHost,
      signal,
      ownershipEvidence,
    );
    assertNotCancelled(signal);
    if (
      [...observations.values()].some(({ state }) => state === "unverifiable")
    ) {
      recordEvent("lifecycle", 1);
      return {
        state: "unverifiable",
        elapsed_ms: monotonicProcessCaptureClock() - started,
      };
    }
    if ([...observations.values()].every(({ state }) => state === "empty")) {
      consecutiveEmpty += 1;
      if (consecutiveEmpty >= 2) {
        recordEvent("lifecycle", 1);
        return {
          state: "quiesced",
          elapsed_ms: monotonicProcessCaptureClock() - started,
        };
      }
    } else {
      consecutiveEmpty = 0;
      sawLive = true;
    }
    deadlineReached = monotonicProcessCaptureClock() - started >= settleMs;
    if (deadlineReached) break;
    await delay(50, undefined, { signal });
  }
  recordEvent("lifecycle", 1);
  // A lone empty observation proves neither liveness nor quiescence; only an
  // observed live member justifies alive_at_deadline.
  return sawLive
    ? {
        state: "alive_at_deadline",
        elapsed_ms: monotonicProcessCaptureClock() - started,
      }
    : {
        state: "unverifiable",
        elapsed_ms: monotonicProcessCaptureClock() - started,
      };
};

/** Name why an attempt is unverified; a blank message never reaches the capture schema. */
export const describeUnverifiedCause = (
  cause: unknown,
  fallback: string,
): string => {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.trim() === "" ? fallback : message;
};

/**
 * Wait for the captured terminal to exit and report how it ended.
 *
 * A timeout or idle deadline kills the root at once when `finalization_ms` is
 * 0. With a positive interval it sends SIGTERM through `signalTarget`, keeps
 * observing, and sends SIGKILL once if the interval ends first; cancellation
 * during the interval sends that SIGKILL at once. Every attempt is recorded
 * with its delivery result before the delivery is awaited, and each wait is
 * bounded by the cleanup verification grace. If the SIGKILL cannot be
 * delivered the wait ends with `unobserved: true` and no invented exit, so the
 * caller can keep its observations and release the run through cleanup.
 */
export const awaitTerminalExit = async ({
  terminal,
  scenario,
  started,
  lastOutput,
  signal,
  signalTarget,
  recordFinalization,
  timers,
  interactions,
  dispatchedEventIndexes,
  recordEvent,
  onLiveProgress,
}: TerminalExitOptions): Promise<TerminalExitResult> =>
  new Promise((resolveExit) => {
    // The kill caused by a deadline is observed later as an ordinary PTY exit.
    // Keep the initiating lifecycle reason so comparisons distinguish a target
    // exit from harness-owned timeout, idle-timeout, and cancellation cleanup.
    let reason: "exited" | "timeout" | "idle_timeout" | "cancelled" = "exited";
    onLiveProgress?.();
    // A deadline with a finalization interval sends SIGTERM first and keeps
    // observing; SIGKILL follows only when the interval elapses or the request
    // is cancelled. Both go through the identity-checked signaller.
    // The interval is measured on the monotonic clock so a wall-clock change
    // cannot shorten it or produce a negative elapsed time.
    let finalizationStartedAt: number | undefined;
    let escalationSent = false;
    let settled = false;
    let exitObserved = false;
    const finalizationSignals: {
      signal: FinalizationSignal;
      sent_at_ms: number;
      delivery: FinalizationDelivery;
      reason?: string | undefined;
    }[] = [];
    const pendingDeliveries: Promise<void>[] = [];
    const snapshot = (
      elapsed: number | null,
      exitCode: number | null = null,
    ): ProcessCaptureFinalization => ({
      requested_ms: scenario.finalization_ms,
      elapsed_ms: elapsed,
      exit_code: exitCode,
      signals: finalizationSignals.map((attempt) => ({ ...attempt })),
    });
    const unobservedExit = (): void => {
      if (settled || exitObserved || finalizationStartedAt === undefined)
        return;
      settled = true;
      for (const timer of timers) timer.cancel();
      timers.clear();
      resolveExit({
        unobserved: true,
        reason: reason === "exited" ? "timeout" : reason,
        finalization: snapshot(null),
      });
    };
    // An attempt is recorded before its delivery is awaited, so a hung or
    // failed delivery still leaves the attempt in the observations.
    const attempt = (finalizationSignal: FinalizationSignal): void => {
      if (finalizationStartedAt === undefined) return;
      const record: (typeof finalizationSignals)[number] = {
        signal: finalizationSignal,
        sent_at_ms: Math.max(
          0,
          monotonicProcessCaptureClock() - finalizationStartedAt,
        ),
        delivery: "unverified" as FinalizationDelivery,
        reason: "delivery had not settled when the record was published",
      };
      finalizationSignals.push(record);
      recordFinalization(snapshot(null));
      const deliveryBound = new AbortController();
      // The wait is bounded by the cleanup verification grace: a delivery that
      // never settles is recorded as unverified instead of holding the capture.
      pendingDeliveries.push(
        Promise.race([
          signalTarget(finalizationSignal),
          delay(
            PROCESS_FINALIZATION_DELIVERY_GRACE_MS,
            {
              delivery: "unverified" as const,
              reason: `delivery did not settle within ${String(PROCESS_FINALIZATION_DELIVERY_GRACE_MS)} ms`,
            },
            {
              ref: false,
              signal: deliveryBound.signal,
            },
          ).catch(() => ({
            delivery: "unverified" as const,
            reason: "delivery wait was interrupted",
          })),
        ])
          .finally(() => {
            deliveryBound.abort();
          })
          .then(
            ({ delivery, reason: deliveryReason }) => {
              record.delivery = delivery;
              if (deliveryReason !== undefined) record.reason = deliveryReason;
              else delete record.reason;
            },
            (cause: unknown) => {
              record.delivery = "unverified";
              record.reason = describeUnverifiedCause(
                cause,
                "signal delivery failed without a message",
              );
            },
          )
          .then(() => {
            recordFinalization(snapshot(null));
            // A kill that cannot reach the root leaves no exit to wait for.
            if (
              finalizationSignal === "SIGKILL" &&
              record.delivery !== "signaled" &&
              record.delivery !== "gone"
            )
              unobservedExit();
          }),
      );
    };
    const forceKill = (): void => {
      if (finalizationStartedAt !== undefined) {
        if (escalationSent) return;
        escalationSent = true;
        attempt("SIGKILL");
        return;
      }
      terminal.kill("SIGKILL");
    };
    const terminateAtDeadline = (): void => {
      if (scenario.finalization_ms === 0) {
        terminal.kill("SIGKILL");
        return;
      }
      finalizationStartedAt = monotonicProcessCaptureClock();
      attempt("SIGTERM");
    };
    terminal.onExit((exit) => {
      if (settled) return;
      exitObserved = true;
      // Measures when the exit was observed, not when the operating system
      // ended the process; the PTY layer can deliver the notification late.
      const finalizationElapsedMs =
        finalizationStartedAt === undefined
          ? undefined
          : Math.max(0, monotonicProcessCaptureClock() - finalizationStartedAt);
      recordEvent("lifecycle", 0);
      for (const [eventIndex, event] of scenario.events.entries()) {
        if (dispatchedEventIndexes.has(eventIndex)) continue;
        const sequence = interactions.length;
        interactions.push({
          sequence,
          scheduled_at_ms: event.at_ms,
          dispatched_at_ms: Math.max(
            0,
            monotonicProcessCaptureClock() - started,
          ),
          type: event.type,
          data:
            event.type === "input"
              ? "<not-dispatched>"
              : event.type === "resize"
                ? `${String(event.columns)}x${String(event.rows)}`
                : event.signal,
          outcome: "target_exited",
        });
        recordEvent("interaction_events", sequence);
      }
      for (const timer of timers) {
        timer.cancel();
      }
      timers.clear();
      const finish = (): void => {
        if (settled) return;
        settled = true;
        resolveExit({
          ...exit,
          reason,
          ...(finalizationElapsedMs === undefined
            ? {}
            : {
                finalization: snapshot(
                  finalizationElapsedMs,
                  normalExitCode(exit),
                ),
              }),
        });
      };
      if (pendingDeliveries.length === 0) {
        finish();
        return;
      }
      // A delivery that never settles must not hold back an observed exit;
      // its attempt stays recorded as unverified.
      const grace = new AbortController();
      void Promise.race([
        Promise.allSettled(pendingDeliveries),
        delay(PROCESS_FINALIZATION_DELIVERY_GRACE_MS, undefined, {
          ref: false,
          signal: grace.signal,
        }).catch(() => undefined),
      ])
        .finally(() => {
          grace.abort();
        })
        .then(finish);
    });
    const timeout = scheduleProcessInterval(() => {
      onLiveProgress?.();
      if (signal?.aborted === true) {
        reason = "cancelled";
        forceKill();
      } else if (finalizationStartedAt !== undefined) {
        if (
          monotonicProcessCaptureClock() - finalizationStartedAt >=
          scenario.finalization_ms
        )
          forceKill();
      } else if (
        monotonicProcessCaptureClock() - started >=
        scenario.timeout_ms
      ) {
        reason = "timeout";
        terminateAtDeadline();
      } else if (
        monotonicProcessCaptureClock() - lastOutput() >=
        scenario.idle_timeout_ms
      ) {
        reason = "idle_timeout";
        terminateAtDeadline();
      }
    }, 20);
    timers.add(timeout);
  });

/** Host operations used when releasing one captured process run. */
export interface ProcessCaptureCleanupHost {
  readonly platform: NodeJS.Platform;
  readonly cleanupProcessGroup: typeof cleanupOwnedProcessGroup;
  readonly removeTemporaryRoot: (path: string) => Promise<void>;
}

const processCaptureCleanupHost: ProcessCaptureCleanupHost = {
  platform: process.platform,
  cleanupProcessGroup: cleanupOwnedProcessGroup,
  removeTemporaryRoot: (path) => rm(path, { recursive: true, force: true }),
};

const PROCESS_FINALIZATION_DELIVERY_GRACE_MS = 1_000;

const releaseCapturedProcessGroup = async (
  ownership: Extract<
    OwnedProcessGroup,
    { readonly sweepTokenOwnedProcesses: true }
  >,
  host: ProcessCaptureCleanupHost,
): Promise<ProcessCaptureCleanupReport["owned_process_group"]> => {
  if (host.platform === "win32")
    return {
      state: "unverified",
      reason:
        "owned process cleanup is unverifiable on Windows without process-job authority",
    };
  let outcome: ProcessCaptureCleanupReport["owned_process_group"] = {
    state: "cleaned",
    reason: null,
  };
  const unverified: Array<{
    readonly pid: number;
    readonly diagnostic: string;
  }> = [];
  try {
    const cleaned = await host.cleanupProcessGroup(ownership);
    unverified.push(...(cleaned.unverified ?? []));
    if (!cleaned.cleaned)
      outcome = { state: "unverified", reason: cleaned.reason };
  } catch (cause: unknown) {
    outcome = {
      state: "failed",
      reason:
        cause instanceof Error
          ? cause.message || cause.name || "owned process cleanup failed"
          : "owned process cleanup failed",
    };
  }
  return unverified.length === 0
    ? outcome
    : {
        ...outcome,
        unverified_processes: [
          ...new Map(
            unverified.map(({ pid, diagnostic }) => [
              `${String(pid)}:${diagnostic}`,
              { pid, reason: diagnostic },
            ]),
          ).values(),
        ],
      };
};

export interface ProcessCaptureResourceCleanupOptions {
  readonly timers: ReadonlySet<ProcessTimer>;
  readonly terminal: Pick<IPty, "pid"> | undefined;
  readonly renderer: Pick<TerminalRenderer, "dispose"> | undefined;
  readonly runId: string;
  readonly temporaryRoot: string;
  readonly captureBaseline?: ProcessOwnershipBaseline;
  readonly sampledProcessGroupIds?: readonly number[];
  /** Shared with settlement observations for this exact captured run. */
  readonly ownershipEvidence?: ProcessOwnershipEvidenceOwner;
  readonly host?: ProcessCaptureCleanupHost;
}

/** Historical cleanup facts and the exact authority that can confirm recovery. */
export interface ProcessCaptureCleanupOutcome {
  readonly report: ProcessCaptureCleanupReport;
  /** Undefined means that only historical facts, not an owner, are available. */
  readonly cleanupLease: AnalysisCleanupLease | undefined;
}

/** One capture's exact resource owner, with completion tracked per resource. */
class ProcessCaptureResourceOwner {
  readonly cleanupLease: AnalysisCleanupLease;
  readonly #host: ProcessCaptureCleanupHost;
  readonly #ownershipEvidence: ProcessOwnershipEvidenceOwner;
  #terminalRenderer:
    | ProcessCaptureCleanupReport["terminal_renderer"]
    | undefined;
  #ownedProcessGroup:
    | ProcessCaptureCleanupReport["owned_process_group"]
    | undefined;
  #temporaryRoot: ProcessCaptureCleanupReport["temporary_root"] | undefined;

  constructor(private readonly options: ProcessCaptureResourceCleanupOptions) {
    this.#host = options.host ?? processCaptureCleanupHost;
    this.#ownershipEvidence =
      options.ownershipEvidence ?? new ProcessOwnershipEvidenceOwner();
    if (options.renderer === undefined)
      this.#terminalRenderer = { state: "not_required", reason: null };
    if (options.terminal === undefined)
      this.#ownedProcessGroup = { state: "not_required", reason: null };
    this.cleanupLease = new AnalysisCleanupLease(async () => {
      const report = await this.close();
      const failure = cleanupReportFailure(report);
      if (failure === undefined) return;
      const error = new ProcessCaptureError(failure, {
        reason: "cleanup_incomplete",
        cleanup: { reason: failure, resources: this.cleanupResources },
        cleanupReport: report,
      });
      new AnalysisCleanupLeaseGroup(error, [this.cleanupLease]);
      throw error;
    }, this);
  }

  get cleanupResources(): readonly string[] {
    return unresolvedCleanupResources(this.report).map((resource) =>
      resource === "temporary_root" ? this.options.temporaryRoot : resource,
    );
  }

  get report(): ProcessCaptureCleanupReport {
    // Reports are observations; consumers cannot edit the owner's completion state.
    return structuredClone({
      owned_process_group: this.#ownedProcessGroup ?? {
        state: "unverified",
        reason: "owned process cleanup was not attempted",
      },
      terminal_renderer: this.#terminalRenderer ?? {
        state: "unverified",
        reason: "terminal renderer cleanup was not attempted",
      },
      temporary_root: this.#temporaryRoot ?? {
        state: "unverified",
        reason: "temporary root cleanup was not attempted",
      },
    });
  }

  async close(): Promise<ProcessCaptureCleanupReport> {
    for (const timer of this.options.timers) timer.cancel();
    await this.#releaseOwnedProcessGroup();
    await this.#releaseRenderer();
    await this.#releaseTemporaryRoot();
    return this.report;
  }

  async release(): Promise<ProcessCaptureCleanupOutcome> {
    try {
      await this.cleanupLease.release();
      return { report: this.report, cleanupLease: this.cleanupLease };
    } catch (cause: unknown) {
      if (
        !(cause instanceof ProcessCaptureError) ||
        cause.cleanupReport === undefined
      )
        throw cause;
      return { report: cause.cleanupReport, cleanupLease: this.cleanupLease };
    }
  }

  async #releaseRenderer(): Promise<void> {
    if (
      this.options.renderer === undefined ||
      this.#terminalRenderer?.state === "cleaned" ||
      this.#terminalRenderer?.state === "not_required"
    )
      return;
    try {
      await this.options.renderer.dispose();
      this.#terminalRenderer = { state: "cleaned", reason: null };
    } catch (cause: unknown) {
      this.#terminalRenderer = {
        state: "failed",
        reason: cleanupFailureMessage(cause, "renderer dispose failed"),
      };
    }
  }

  async #releaseOwnedProcessGroup(): Promise<void> {
    if (
      this.options.terminal === undefined ||
      this.#ownedProcessGroup?.state === "cleaned" ||
      this.#ownedProcessGroup?.state === "not_required"
    )
      return;
    this.#ownedProcessGroup = await releaseCapturedProcessGroup(
      {
        runId: this.options.runId,
        leaderPid: this.options.terminal.pid,
        processGroupId: this.options.terminal.pid,
        sweepTokenOwnedProcesses: true,
        evidenceOwner: this.#ownershipEvidence,
        ...(this.options.sampledProcessGroupIds === undefined
          ? {}
          : { sampledProcessGroupIds: this.options.sampledProcessGroupIds }),
        ...(this.options.captureBaseline === undefined
          ? {}
          : { captureBaseline: this.options.captureBaseline }),
      },
      this.#host,
    );
  }

  async #releaseTemporaryRoot(): Promise<void> {
    if (this.#temporaryRoot?.state === "cleaned") return;
    const owned = this.#ownedProcessGroup;
    if (owned?.state === "failed" || owned?.state === "unverified") {
      this.#temporaryRoot = {
        state: "unverified",
        reason: `temporary root retained because owned process cleanup is ${owned.state}: ${owned.reason ?? "ownership could not be verified"}`,
      };
      return;
    }
    try {
      await this.#host.removeTemporaryRoot(this.options.temporaryRoot);
      this.#temporaryRoot = { state: "cleaned", reason: null };
    } catch (cause: unknown) {
      this.#temporaryRoot = {
        state: "failed",
        reason: cleanupFailureMessage(cause, "temporary root removal failed"),
      };
    }
  }
}

const cleanupFailureMessage = (cause: unknown, fallback: string): string =>
  cause instanceof Error ? cause.message || cause.name || fallback : fallback;

/** Release one capture's resources, retaining the exact owner for scoped retry. */
export const releaseProcessResources = async (
  options: ProcessCaptureResourceCleanupOptions,
): Promise<ProcessCaptureCleanupOutcome> =>
  new ProcessCaptureResourceOwner(options).release();

/** Run-local owner collection for resources whose first cleanup did not finish. */
export class ProcessCaptureResourceScope {
  readonly #pending = new Set<AnalysisCleanupLease>();
  readonly #active = new Set<Promise<unknown>>();
  #draining: Promise<void> | undefined;
  #closed = false;

  /** Admit one capture before it starts acquiring resources. */
  async run<T>(operation: () => Promise<T>): Promise<T> {
    while (true) {
      while (this.#draining !== undefined) await this.#draining;
      if (this.#closed)
        throw new ProcessCaptureError(
          "process capture lifecycle is closing; start a new server session before capturing again",
        );
      if (this.#pending.size === 0) break;
      await this.retryCleanup();
    }
    const running = Promise.resolve().then(operation);
    this.#active.add(running);
    try {
      return await running;
    } finally {
      this.#active.delete(running);
    }
  }

  /** Retain an exact child owner acquired by an already admitted capture. */
  retain(lease: AnalysisCleanupLease): void {
    if (!lease.released) this.#pending.add(lease);
  }

  async release(
    options: ProcessCaptureResourceCleanupOptions,
  ): Promise<ProcessCaptureCleanupOutcome> {
    const owner = new ProcessCaptureResourceOwner(options);
    this.#pending.add(owner.cleanupLease);
    const outcome = await owner.release();
    if (owner.cleanupLease.released) this.#pending.delete(owner.cleanupLease);
    return outcome;
  }

  /** Drain active captures, then retry their retained resources without closing admission. */
  retryCleanup(): Promise<void> {
    if (this.#draining !== undefined) return this.#draining;
    this.#draining = this.#drainAndRetry().finally(() => {
      this.#draining = undefined;
    });
    return this.#draining;
  }

  /** Stop admitting new captures, drain active runs, and retry all retained owners. */
  close(): Promise<void> {
    this.#closed = true;
    return this.retryCleanup();
  }

  async #drainAndRetry(): Promise<void> {
    while (this.#active.size > 0) await Promise.allSettled(this.#active);
    const failures: {
      readonly lease: AnalysisCleanupLease;
      readonly cause: unknown;
    }[] = [];
    for (const lease of this.#pending) {
      try {
        await lease.release();
        this.#pending.delete(lease);
      } catch (cause: unknown) {
        failures.push({ lease, cause });
      }
    }
    if (failures.length === 0) return;
    const reason = failures
      .map(({ cause }) => cleanupFailureMessage(cause, "cleanup incomplete"))
      .join("; ");
    const error = new ProcessCaptureError(
      `Process capture cleanup remains incomplete: ${reason}`,
      {
        cause: new AggregateError(
          failures.map(({ cause }) => cause),
          "Process capture resources remain owned",
        ),
        reason: "cleanup_incomplete",
        cleanup: {
          reason,
          resources: [
            ...new Set(
              failures.flatMap(({ lease }) => lease.cleanupResources ?? []),
            ),
          ],
        },
      },
    );
    new AnalysisCleanupLeaseGroup(
      error,
      failures.map(({ lease }) => lease),
    );
    throw error;
  }
}

const unresolvedCleanupOutcomes = (
  report: ProcessCaptureCleanupReport,
): [string, ProcessCaptureCleanupReport[keyof ProcessCaptureCleanupReport]][] =>
  Object.entries(report).filter(
    ([, outcome]) =>
      outcome.state === "failed" || outcome.state === "unverified",
  );

const unresolvedCleanupResources = (
  report: ProcessCaptureCleanupReport,
): string[] => unresolvedCleanupOutcomes(report).map(([resource]) => resource);

export const cleanupReportFailure = (
  report: ProcessCaptureCleanupReport,
): string | undefined => {
  const failures = unresolvedCleanupOutcomes(report);
  return failures.length === 0
    ? undefined
    : failures
        .map(
          ([resource, outcome]) =>
            `${resource}: ${outcome.reason ?? outcome.state}`,
        )
        .join("; ");
};

export const captureTerminalFrames = (options: {
  readonly terminal: IPty;
  readonly scenario: ProcessScenario;
  readonly frames: TerminalFrame[];
  readonly sensitiveOutput?: ProcessSensitiveOutput;
  readonly onSensitiveOutputFailure?: () => void;
  readonly started: number;
  readonly onOutput: () => void;
  readonly renderer: TerminalRenderer;
  readonly normalizeText: (
    value: string,
    maxBytes: number,
  ) => BoundedProcessTextNormalization;
  readonly recordEvent: RecordProcessCaptureEvent;
  readonly identifiers: () => readonly number[];
}): (() => TerminalCaptureRetention) => {
  let rawBytes = 0;
  let normalizedBytes = 0;
  let observedBytes = 0;
  let observedFrames = 0;
  let normalizedOmittedFrames = 0;
  let firstIdentifiers: readonly number[] | undefined;
  let sealed = false;
  let redactedBytes = 0;
  const subscription = options.terminal.onData((data) => {
    if (sealed) return;
    options.onOutput();
    const bytes = Buffer.byteLength(data);
    observedBytes += bytes;
    observedFrames += 1;
    const budget = options.scenario.limits.output_bytes;
    if (bytes > budget - rawBytes) {
      return;
    }
    const normalized = options.normalizeText(data, budget - normalizedBytes);
    if (normalized.state === "over_budget") {
      normalizedOmittedFrames += 1;
      return;
    }
    firstIdentifiers ??= options.identifiers();
    rawBytes += bytes;
    normalizedBytes += normalized.utf8Bytes;
    const atMs = normalizeProcessElapsedTime(
      monotonicProcessCaptureClock() - options.started,
      options.scenario.normalization.time_bucket_ms,
    );
    const sequence = options.frames.length;
    options.frames.push({
      sequence,
      at_ms: atMs,
      data: normalized.value,
      ...(normalized.value === data ? {} : { raw_data: data }),
    });
    options.renderer.write(
      options.sensitiveOutput === undefined
        ? data
        : () => {
            if (options.sensitiveOutput?.failure !== undefined)
              throw options.sensitiveOutput.failure;
            const frame = options.frames[sequence];
            if (frame === undefined)
              throw new ProcessCaptureError(
                "Retained terminal frame is unavailable.",
              );
            return frame.raw_data ?? frame.data;
          },
      atMs,
    );
    options.recordEvent("frames", sequence);
  });
  return () => {
    if (!sealed) {
      sealed = true;
      try {
        if (options.sensitiveOutput !== undefined) {
          const projection = options.sensitiveOutput.projectRawFrames(
            options.frames,
            observedFrames > options.frames.length,
          );
          if (!projection.ok) throw projection.error;
          redactedBytes = projection.value;
          normalizedBytes = normalizeRetainedTerminalFrames(
            options.frames,
            options.normalizeText,
            options.scenario.limits.output_bytes,
            "sensitive-input",
          );
          const normalized = options.sensitiveOutput.projectNormalizedFrames(
            options.frames,
          );
          if (!normalized.ok) throw normalized.error;
          normalizedBytes = normalized.value;
          rawBytes -= redactedBytes;
        }
      } catch (cause) {
        if (options.sensitiveOutput !== undefined) {
          const failure =
            cause instanceof AnalysisError
              ? cause
              : new ProcessCaptureError(
                  "Sensitive terminal projection failed; terminal text was withheld.",
                );
          options.sensitiveOutput.fail(failure);
          for (const [index, frame] of options.frames.entries())
            options.frames[index] = {
              sequence: frame.sequence,
              at_ms: frame.at_ms,
              data: "",
            };
          options.onSensitiveOutputFailure?.();
          throw failure;
        }
        throw cause;
      } finally {
        try {
          subscription.dispose();
        } catch (cause) {
          if (options.sensitiveOutput?.failure === undefined) throw cause;
          options.sensitiveOutput.failure.retainSecondaryFailure(
            new ProcessCaptureError("Terminal subscription disposal failed."),
          );
        }
      }
    }
    if (options.sensitiveOutput?.failure !== undefined)
      throw options.sensitiveOutput.failure;
    const identifiers = options.identifiers();
    if (
      options.sensitiveOutput === undefined &&
      options.scenario.normalization.pids &&
      firstIdentifiers !== undefined &&
      identifiers !== firstIdentifiers
    ) {
      normalizedBytes = normalizeRetainedTerminalFrames(
        options.frames,
        options.normalizeText,
        options.scenario.limits.output_bytes,
      );
      firstIdentifiers = identifiers;
    }
    return {
      raw_terminal: {
        budget_bytes: options.scenario.limits.output_bytes,
        observed_bytes: observedBytes,
        retained_bytes: rawBytes,
        ...(options.sensitiveOutput === undefined
          ? {}
          : { redacted_bytes: redactedBytes }),
        observed_frames: observedFrames,
        retained_frames: options.frames.length,
      },
      normalized_terminal: {
        budget_bytes: options.scenario.limits.output_bytes,
        retained_bytes: normalizedBytes,
        omitted_frames: normalizedOmittedFrames,
      },
    };
  };
};

export interface TerminalCaptureRetention {
  readonly raw_terminal: TerminalRetention;
  readonly normalized_terminal: NormalizedTerminalRetention;
}

export const resolveProcessResult = (
  capture: PendingProcessCapture | ProcessCapture | undefined,
  executionFailure: unknown,
  cleanupOutcome: ProcessCaptureCleanupOutcome,
  observations?: IncompleteProcessCaptureObservations,
  partialContext?: {
    readonly scenario: ProcessScenario;
    readonly rootPid?: number;
  },
): ProcessCapture => {
  const cleanup = cleanupOutcome.report;
  const cleanupFailure = cleanupReportFailure(cleanup);
  const executionFailureReason =
    describeProcessCaptureExecutionFailure(executionFailure);
  let partialObservation: PartialProcessCaptureObservation | undefined;
  if (
    (cleanupFailure !== undefined || executionFailure !== undefined) &&
    (capture !== undefined || observations !== undefined)
  ) {
    const normalizedObservations =
      observations === undefined || partialContext === undefined
        ? observations
        : normalizePartialProcessObservations(observations, partialContext);
    if (capture === undefined) {
      if (normalizedObservations !== undefined) {
        const partialResult = partialProcessCaptureObservationSchema.safeParse({
          observations: normalizedObservations,
          cleanup,
          execution_failure: executionFailureReason ?? null,
        });
        if (partialResult.success) partialObservation = partialResult.data;
      }
    } else {
      const captureData =
        "cleanup" in capture
          ? (() => {
              const { cleanup: _cleanup, ...data } = capture;
              void _cleanup;
              return data;
            })()
          : capture;
      const settlement =
        cleanupFailure !== undefined
          ? { ...capture.settlement, cleanup_outcome: "failed" as const }
          : capture.settlement.state === "quiesced"
            ? {
                ...capture.settlement,
                cleanup_outcome: "not_required" as const,
              }
            : { ...capture.settlement, cleanup_outcome: "cleaned" as const };
      const partialResult = partialProcessCaptureObservationSchema.safeParse({
        capture: { ...captureData, settlement },
        cleanup,
        execution_failure: executionFailureReason ?? null,
      });
      if (partialResult.success) partialObservation = partialResult.data;
    }
  }
  if (cleanupFailure !== undefined) {
    const cleanupResources = unresolvedCleanupResources(cleanup);
    const cleanupError = new ProcessCaptureError(cleanupFailure, {
      cause: executionFailure,
      reason: "cleanup_incomplete",
      cleanup: { reason: cleanupFailure, resources: cleanupResources },
      ...(executionFailureReason === undefined
        ? {}
        : { executionFailure: executionFailureReason }),
      ...(partialObservation === undefined ? {} : { partialObservation }),
      cleanupReport: cleanup,
    });
    if (cleanupOutcome.cleanupLease !== undefined)
      new AnalysisCleanupLeaseGroup(cleanupError, [
        cleanupOutcome.cleanupLease,
      ]);
    if (executionFailure instanceof ProcessCaptureError)
      throw executionFailure.withFinalization({
        ...(executionFailureReason === undefined
          ? {}
          : { executionFailure: executionFailureReason }),
        ...(partialObservation === undefined ? {} : { partialObservation }),
        cleanupReport: cleanup,
        cleanupFailure: cleanupError,
      });
    if (executionFailure instanceof AnalysisError) {
      if (partialObservation !== undefined)
        executionFailure.retainPartialObservation(partialObservation);
      throw analysisErrorWithCleanupFailure(
        executionFailure,
        cleanupError,
        "capture_process",
      ).bindCleanupDependencies([executionFailure, cleanupError]);
    }
    throw cleanupError;
  }
  if (executionFailure instanceof ProcessCaptureError) {
    throw executionFailure.withFinalization({
      ...(executionFailureReason === undefined
        ? {}
        : { executionFailure: executionFailureReason }),
      ...(partialObservation === undefined ? {} : { partialObservation }),
      cleanupReport: cleanup,
    });
  }
  if (executionFailure !== undefined) {
    if (executionFailure instanceof AnalysisError) {
      if (partialObservation !== undefined)
        executionFailure.retainPartialObservation(partialObservation);
      executionFailure.retainDiagnostics({
        cleanup_report: jsonValueSchema.parse(cleanup),
      });
      throw executionFailure;
    }
    throw new ProcessCaptureError("process capture failed", {
      cause: executionFailure,
      reason: "capture_failed",
      ...(executionFailureReason === undefined
        ? {}
        : { executionFailure: executionFailureReason }),
      ...(partialObservation === undefined ? {} : { partialObservation }),
      cleanupReport: cleanup,
    });
  }
  if (capture === undefined)
    throw new ProcessCaptureError("process capture produced no result");
  const unverifiedProcesses = cleanup.owned_process_group.unverified_processes;
  if ("cleanup" in capture && unverifiedProcesses === undefined) return capture;

  const settlement: UnverifiedProcessCapture["settlement"] =
    capture.settlement.state === "quiesced"
      ? { ...capture.settlement, cleanup_outcome: "not_required" }
      : { ...capture.settlement, cleanup_outcome: "cleaned" };
  try {
    return parseProcessCapture({
      ...capture,
      settlement,
      residual_unknowns: [
        ...capture.residual_unknowns,
        ...(unverifiedProcesses ?? []).map(({ pid, reason }) => ({
          scope: "process" as const,
          reason: `Ownership of unrelated process ${String(pid)} could not be verified; it was left untouched: ${reason}`,
        })),
      ],
      cleanup: {
        ...("cleanup" in capture ? capture.cleanup : {}),
        owned_process_group: "verified",
        temporary_root: "removed",
        ...(unverifiedProcesses === undefined
          ? {}
          : { unverified_processes: unverifiedProcesses }),
      },
    });
  } catch (cause: unknown) {
    throw new ProcessCaptureError(
      `process capture validation failed${cause instanceof Error ? `: ${cause.message}` : ""}`,
      { cause },
    );
  }
};

export const prepareProcessCapture = async (
  scenario: ProcessScenario,
  signal: AbortSignal | undefined,
  captureSnapshot: typeof snapshotRoots = snapshotRoots,
  host: ProcessPreparationHost = systemProcessPreparationHost,
  resourceScope?: ProcessCaptureResourceScope,
): Promise<{
  readonly temporaryRoot: string;
  readonly runId: string;
  readonly ownershipBaseline: ProcessOwnershipBaseline;
  readonly before: ProcessFilesystemSnapshot;
}> => {
  assertNotCancelled(signal);
  await host.prepareOwnershipInspector?.(signal);
  assertNotCancelled(signal);
  let before: ProcessFilesystemSnapshot | undefined;
  let temporaryRoot: string | undefined;
  const runId = randomUUID();
  try {
    temporaryRoot = await host.createTemporaryRoot();
    before = await captureSnapshot(scenario, signal, undefined, {
      ...(resourceScope === undefined ? {} : { cleanup: resourceScope }),
      observerPaths: [temporaryRoot],
    });
    assertNotCancelled(signal);
    const ownershipBaseline =
      (await host.captureOwnershipBaseline?.(signal)) ?? [];
    assertNotCancelled(signal);
    return { temporaryRoot, runId, ownershipBaseline, before };
  } catch (cause: unknown) {
    let failure = cause;
    if (cause instanceof ProcessCaptureSnapshotFailure) {
      before = cause.snapshot;
      for (const lease of cause.cleanupLeases) resourceScope?.retain(lease);
      failure = cause.failureForCaller();
    }
    const cleanupOptions =
      temporaryRoot === undefined
        ? undefined
        : ({
            timers: new Set<ProcessTimer>(),
            terminal: undefined,
            renderer: undefined,
            runId,
            temporaryRoot,
            host: {
              ...processCaptureCleanupHost,
              removeTemporaryRoot: host.cleanup,
            },
          } satisfies ProcessCaptureResourceCleanupOptions);
    const cleanup: ProcessCaptureCleanupOutcome =
      cleanupOptions === undefined
        ? {
            report: {
              terminal_renderer: { state: "not_required", reason: null },
              owned_process_group: { state: "not_required", reason: null },
              temporary_root: { state: "not_required", reason: null },
            },
            cleanupLease: undefined,
          }
        : resourceScope === undefined
          ? await releaseProcessResources(cleanupOptions)
          : await resourceScope.release(cleanupOptions);
    resolveProcessResult(
      undefined,
      normalizeCaptureFailure(failure, signal),
      cleanup,
      createProcessCaptureObservationBuffer({
        frames: [],
        interactions: [],
        samples: [],
        eventJournal: [],
        before,
        finalizationEnabled: scenario.finalization_ms > 0,
      }),
      { scenario },
    );
    throw failure;
  }
};

/** Filesystem seam for allocating and cleaning a capture's temporary root. */
export interface ProcessPreparationHost {
  prepareOwnershipInspector?(signal?: AbortSignal): Promise<void>;
  /** Capture the process baseline with the caller's startup cancellation. */
  captureOwnershipBaseline?(
    signal?: AbortSignal,
  ): Promise<ProcessOwnershipBaseline>;
  createTemporaryRoot(): Promise<string>;
  cleanup(path: string): Promise<void>;
}

const systemProcessPreparationHost: ProcessPreparationHost = {
  prepareOwnershipInspector: prepareProcessOwnershipInspection,
  captureOwnershipBaseline: (signal) =>
    systemProcessOwnershipHost.captureBaseline?.(signal) ?? Promise.resolve([]),
  createTemporaryRoot: () => mkdtemp(join(tmpdir(), "rea-process-")),
  cleanup: (path) => rm(path, { recursive: true, force: true }),
};
