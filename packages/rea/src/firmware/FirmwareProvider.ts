import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import { assertArtifactCommandPath } from "../process/ArtifactCommandPath.js";
import { join } from "node:path";
import type { FirmwareAnalysisPort } from "../application/firmware/FirmwareAnalysisPort.js";
import {
  createAnalysisExecution,
  type AnalysisExecution,
  type ExecutionOptions,
} from "../application/AnalysisProvider.js";
import {
  firmwareResultSchemas,
  DEFAULT_FIRMWARE_ANALYSIS_TIMEOUT_MS,
  type FirmwareRequest,
  type FirmwarePartialObservation,
} from "../domain/firmware/firmwareAnalysis.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { err, ok } from "../domain/result.js";
import { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";
import type { ProviderProcessSupervisor } from "../process/ProviderProcess.js";
import { SafeOutputTree } from "../artifacts/SafeOutputTree.js";
import { outputDirectoryAdmissionRefusal } from "../artifacts/SafeOutputTreeAdmission.js";
import { publishFirmwareExtraction } from "./FirmwarePublication.js";
import {
  BINWALK_PROVIDER_IDENTITY,
  UNBLOB_PROVIDER_IDENTITY,
} from "./FirmwareRelease.js";
import {
  startFirmwareDeadline,
  type FirmwareDeadline,
} from "./FirmwareDeadline.js";
import { admitFirmwareVersion } from "./FirmwareVersion.js";
import {
  firmwareToolUnavailable,
  resolveFirmwareCommand,
  runFirmwareCommand,
  readFirmwareCommandReport,
  type FirmwareLauncher,
} from "./FirmwareCommand.js";
import {
  inventoryFirmwareOutput,
  FirmwareFileAccess,
} from "./FirmwareFiles.js";
import {
  normalizeBinwalkReport,
  normalizeUnblobReport,
} from "./FirmwareReports.js";

import {
  firmwareFailure,
  firmwarePhaseInterruption,
} from "./FirmwareFailures.js";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";

type Outcome = Awaited<ReturnType<FirmwareAnalysisPort["execute"]>>;
interface PendingFirmwareCleanup {
  supervisor?: ProviderProcessSupervisor;
  tree?: {
    readonly tree: SafeOutputTree;
    readonly lease: AnalysisCleanupLease;
  };
  readonly root: PrivateRuntimeRoot;
  readonly rootLease: AnalysisCleanupLease;
  readonly engine: string;
  readonly operation: string;
}

const bindWorkspaceFailure = (
  pending: PendingFirmwareCleanup,
  failure: AnalysisError,
): AnalysisError => {
  pending.rootLease.bindCleanupError(failure);
  return failure;
};

interface FirmwareCleanupAttempt {
  readonly failure: AnalysisError | undefined;
  readonly executionBlocked: boolean;
}

const combineCleanupFailures = (
  failures: readonly AnalysisError[],
): AnalysisError | undefined => {
  if (failures.length < 2) return failures[0];
  return new ProviderCleanupError(
    "firmware",
    failures.flatMap((failure) => [...failure.cleanupResources]),
    {
      reason: "Multiple owned firmware resources could not be cleaned",
      failures: failures.map((failure) => ({
        engine:
          failure instanceof ProviderAdapterError
            ? failure.providerId
            : "firmware",
        operation:
          failure instanceof ProviderAdapterError
            ? failure.operation
            : "close_firmware",
        resources: [...failure.cleanupResources],
        reason: failure.diagnostics?.reason ?? failure.message,
      })),
    },
    { operation: "close_firmware", cause: new AggregateError(failures) },
  ).bindCleanupDependencies(failures);
};
const waitForPredecessor = (
  predecessor: Promise<void>,
  operation: string,
  signal?: AbortSignal,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const abort = () =>
      reject(new AnalysisCancelledError(operation, { cause: signal?.reason }));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted === true) abort();
    void predecessor.then(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    });
  });
const limitations = [
  "Signature matches and reported sizes do not establish partition validity, encryption or runtime mappings. Binwalk may infer unknown lengths before emitting its report.",
  "Only Linux is supported by this integration. One worker, inherited per-process address-space/file-size/CPU limits and a deadline constrain execution; staging byte and entry budgets are polled and may transiently overshoot. Limits are not aggregate process-memory or filesystem quotas.",
  "Unblob's default sandbox and skip rules remain enabled. Missing external extractors, unknown chunks, encrypted chunks and depth limits yield partial coverage. Extracted code is never executed; only regular files are published, without executable permission bits.",
  "extraction_gaps lists regions that were carved or left unextracted and names extractor dependencies the producer reported as missing. A listed gap does not mean the target is corrupt or that a retained region is empty.",
  "The actual launcher executable is hashed. Interpreter, shared libraries and installed Python package dependencies are not independently attested; source revision remains unknown for caller-supplied builds.",
] as const;

/** Unblob's safe-link handling rewrites absolute targets inside its output. */
const UNBLOB_LINK_TARGET_LIMITATION =
  "Symlink link_target values are read from Unblob's extracted tree, not from the firmware's filesystem metadata. Unblob rewrites absolute targets relative to the extraction root, so a relative link_target may have been stored as an absolute path in the image.";

const publishedSymlinks = (result: unknown): boolean => {
  const parsed = firmwareResultSchemas.extract_firmware.safeParse(result);
  return (
    parsed.success &&
    parsed.data.unpublished_entries.some((entry) => entry.kind === "symlink")
  );
};

/** Queued bring-your-own firmware adapters with private snapshots and owned cleanup. */
export class FirmwareProvider implements FirmwareAnalysisPort {
  #tail: Promise<void> = Promise.resolve();
  #closed = false;
  #closing: Promise<void> | undefined;
  readonly #files = new FirmwareFileAccess();
  readonly #pendingCleanup = new Map<string, PendingFirmwareCleanup>();
  constructor(
    readonly environment: Readonly<
      Record<string, string | undefined>
    > = process.env,
    readonly launcher?: FirmwareLauncher,
  ) {}

  /** Inspect regions or explicitly extract selected bytes without changing the source. */
  async execute(
    request: FirmwareRequest,
    options?: ExecutionOptions,
  ): Promise<Outcome> {
    if (this.#closed) return err(new AnalysisCancelledError(request.operation));
    const predecessor = this.#tail;
    let release = () => {};
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Cancel the caller promptly without letting a later request bypass its predecessor.
    try {
      await waitForPredecessor(predecessor, request.operation, options?.signal);
    } catch (cause: unknown) {
      void predecessor.then(release);
      return err(
        cause instanceof AnalysisError
          ? cause
          : new AnalysisCancelledError(request.operation),
      );
    }
    try {
      if (this.#closed)
        return err(new AnalysisCancelledError(request.operation));
      const cleanup = await this.#retryCleanup();
      if (cleanup.executionBlocked && cleanup.failure !== undefined)
        return err(cleanup.failure);
      return await this.#execute(request, options);
    } finally {
      release();
    }
  }

  /** Retry every retained owner, reporting failures without discarding other roots. */
  close(): Promise<void> {
    this.#closed = true;
    return (this.#closing ??= this.#close().finally(() => {
      this.#closing = undefined;
    }));
  }

  async #close(): Promise<void> {
    await this.#tail;
    const failures: AnalysisError[] = [];
    try {
      await this.#files.close();
    } catch (cause: unknown) {
      failures.push(
        firmwareFailure(cause, {
          engine: "firmware",
          operation: "close_firmware",
        }),
      );
    }
    const workspace = await this.#retryWorkspaceCleanup();
    if (workspace.failure !== undefined) failures.push(workspace.failure);
    const failure = combineCleanupFailures(failures);
    if (failure !== undefined) throw failure;
  }

  async #retryCleanup(): Promise<FirmwareCleanupAttempt> {
    let fileFailure: AnalysisError | undefined;
    try {
      await this.#files.retryCleanup();
    } catch (cause: unknown) {
      fileFailure = firmwareFailure(cause, {
        engine: "firmware",
        operation: "close_firmware",
      });
    }
    const workspace = await this.#retryWorkspaceCleanup();
    return {
      failure: combineCleanupFailures([
        ...(fileFailure === undefined ? [] : [fileFailure]),
        ...(workspace.failure === undefined ? [] : [workspace.failure]),
      ]),
      executionBlocked: fileFailure !== undefined || workspace.executionBlocked,
    };
  }

  async #retryWorkspaceCleanup(): Promise<FirmwareCleanupAttempt> {
    const failures: AnalysisError[] = [];
    let executionBlocked = false;
    for (const [path, pending] of this.#pendingCleanup) {
      try {
        const stopped = await pending.supervisor?.stop();
        if (stopped?.status === "incomplete") {
          executionBlocked = true;
          failures.push(
            bindWorkspaceFailure(
              pending,
              new ProviderCleanupError(
                pending.engine,
                [path],
                { reason: stopped.reason },
                { operation: pending.operation },
              ),
            ),
          );
          continue;
        }
        delete pending.supervisor;
      } catch (cause: unknown) {
        executionBlocked = true;
        failures.push(
          bindWorkspaceFailure(
            pending,
            new ProviderCleanupError(
              pending.engine,
              [path],
              {
                reason: cause instanceof Error ? cause.message : String(cause),
              },
              { operation: pending.operation, cause },
            ),
          ),
        );
        continue;
      }
      try {
        if (pending.tree !== undefined) {
          await pending.tree.lease.release();
          delete pending.tree;
        }
      } catch (cause: unknown) {
        failures.push(
          bindWorkspaceFailure(
            pending,
            new ProviderCleanupError(
              pending.engine,
              [path, pending.tree?.tree.outputRoot ?? path],
              {
                reason: cause instanceof Error ? cause.message : String(cause),
              },
              { operation: pending.operation, cause },
            ),
          ),
        );
      }
      if (pending.tree !== undefined) continue;
      try {
        await pending.rootLease.release();
        this.#pendingCleanup.delete(path);
      } catch (cause: unknown) {
        // A verified stopped process cannot use this root. Keep ownership for
        // later removal without blocking a new operation's disjoint workspace.
        failures.push(
          bindWorkspaceFailure(
            pending,
            new ProviderCleanupError(
              pending.engine,
              [path],
              {
                reason: cause instanceof Error ? cause.message : String(cause),
              },
              { operation: pending.operation, cause },
            ),
          ),
        );
      }
    }
    return { failure: combineCleanupFailures(failures), executionBlocked };
  }

  async #execute(
    request: FirmwareRequest,
    options?: ExecutionOptions,
  ): Promise<Outcome> {
    // Capture configuration after queue admission; later operations may select updates.
    const environment = snapshotEnvironment(this.environment);
    let root: PrivateRuntimeRoot | undefined;
    let rootLease: AnalysisCleanupLease | undefined;
    const engineName =
      request.operation === "inspect_firmware_regions" ? "binwalk" : "unblob";
    const withCaller = (phase: FirmwareDeadline) =>
      options?.signal === undefined
        ? phase.signal
        : AbortSignal.any([options.signal, phase.signal]);
    // Extraction and publication have separate budgets: publication time depends on the
    // destination filesystem, so it must not be charged to the extraction deadline.
    const analysisTimeoutMs =
      request.input.analysis_timeout_ms ?? DEFAULT_FIRMWARE_ANALYSIS_TIMEOUT_MS;
    let deadline = startFirmwareDeadline("analysis", analysisTimeoutMs);
    let signal = withCaller(deadline);
    let outcome: Outcome;
    try {
      if (signal.aborted)
        throw new AnalysisCancelledError(request.operation, {
          cause: signal.reason,
        });
      if (request.operation === "extract_firmware")
        await SafeOutputTree.checkDestination(
          request.input.output_directory,
        ).catch((cause: unknown) => {
          throw outputDirectoryAdmissionRefusal(
            request.operation,
            "output_directory",
            cause,
          );
        });
      const command = await resolveFirmwareCommand(
        environment,
        engineName,
        request.operation,
        this.#files,
        signal,
      );
      root = await PrivateRuntimeRoot.create({ prefix: "rea-firmware-" });
      const ownedRoot = root;
      const ownedRootLease = new AnalysisCleanupLease(() => ownedRoot.close());
      rootLease = ownedRootLease;
      const target = await this.#files.snapshot(request, root.path, signal);
      const run = async (
        args: readonly string[],
        outputBudget?: { root: string; bytes: number; entries: number },
      ) => {
        for (const selected of [command.command, command.limiter])
          await assertArtifactCommandPath(selected, request.operation, {
            signal,
          });
        const output = await runFirmwareCommand({
          engine: engineName,
          operation: request.operation,
          fileSizeCeiling: command.fileSizeCeiling,
          command: command.command.invocationPath,
          limiter: command.limiter.invocationPath,
          args,
          cwd: root?.path ?? "",
          environment,
          signal,
          deadline,
          retainCleanup: (supervisor) => {
            this.#pendingCleanup.set(ownedRoot.path, {
              supervisor,
              root: ownedRoot,
              rootLease: ownedRootLease,
              engine: engineName,
              operation: request.operation,
            });
          },
          ...(this.launcher === undefined ? {} : { launcher: this.launcher }),
          ...(outputBudget === undefined
            ? {}
            : { outputBudget, acceptReportedExtractionFailure: true }),
        });
        for (const selected of [command.command, command.limiter])
          await assertArtifactCommandPath(selected, request.operation, {
            capturedOutput: {
              stdout: output.stdout.text,
              stderr: output.stderr.text,
              stdout_bytes: output.stdout.bytes,
              stderr_bytes: output.stderr.bytes,
              exit_code: output.exit_code ?? null,
              signal: output.signal,
              truncated: false,
            },
          });
        return output;
      };
      const versionRun = await run(["--version"]);
      const version = versionRun.stdout.text.trim();
      if (versionRun.stdout.bytes > 1024)
        throw firmwareToolUnavailable(
          engineName,
          request.operation,
          `Tool version banner is ${String(versionRun.stdout.bytes)} bytes; expected a short ${engineName} version line.`,
        );
      const admitted = admitFirmwareVersion(engineName, version);
      if (admitted.status === "unsupported" || admitted.status === "unresolved")
        throw firmwareToolUnavailable(
          engineName,
          request.operation,
          admitted.message,
        );
      const engine = {
        name: engineName,
        version: admitted.version,
        executable_path: command.command.resolvedPath,
        executable_sha256: command.sha256,
        source_revision: null,
        worker_count: 1 as const,
      };
      const reportPath = join(root.path, "report.json");
      let result: unknown;
      let raw: unknown;
      if (request.operation === "inspect_firmware_regions") {
        const processRun = await run([
          "--quiet",
          "--search-all",
          "--threads",
          "1",
          "--log",
          reportPath,
          target.inputPath,
        ]);
        const report = await readFirmwareCommandReport({
          path: reportPath,
          engine: engineName,
          operation: request.operation,
          execution: processRun,
          files: this.#files,
          signal,
        });
        result = firmwareResultSchemas.inspect_firmware_regions.parse({
          analysis_timeout_ms: analysisTimeoutMs,
          engine,
          input_size: target.size,
          regions: normalizeBinwalkReport(
            report,
            target.inputPath,
            target.size,
          ),
          coverage: "signature_scan",
        });
        raw = { report, execution: processRun, version_execution: versionRun };
      } else {
        const outputRoot = join(root.path, "extracted");
        const processRun = await run(
          [
            "--process-num",
            "1",
            "--depth",
            String(request.input.max_depth),
            "--randomness-depth",
            "0",
            "--report",
            reportPath,
            "--log",
            join(root.path, "unblob.log"),
            "--extract-dir",
            outputRoot,
            target.inputPath,
          ],
          {
            root: outputRoot,
            bytes: request.input.max_output_bytes,
            entries: request.input.max_output_files,
          },
        );
        const report = await readFirmwareCommandReport({
          path: reportPath,
          engine: engineName,
          operation: request.operation,
          execution: processRun,
          files: this.#files,
          signal,
        });
        const normalized = normalizeUnblobReport(report, {
          inputPath: target.inputPath,
          outputRoot,
          ...target.selection,
          maxDepth: request.input.max_depth,
        });
        if (processRun.exit_code === 1 && normalized.diagnostics.length === 0)
          throw new AnalysisOutputError(
            request.operation,
            "Unblob failed without a reported extraction diagnostic",
          );
        const entries = await inventoryFirmwareOutput(
          outputRoot,
          request.input.max_output_bytes,
          request.input.max_output_files,
          request.operation,
          signal,
        );
        // The inventory can finish after its deadline expired; an expired
        // extraction must not publish under the fresh publication budget.
        const interruption = firmwarePhaseInterruption(
          request.operation,
          signal,
          deadline,
        );
        if (interruption !== undefined) throw interruption;
        deadline = startFirmwareDeadline(
          "publication",
          request.input.publication_timeout_ms,
        );
        signal = withCaller(deadline);
        result = await publishFirmwareExtraction({
          analysisTimeoutMs,
          files: this.#files,
          workspacePath: root.path,
          deadline,
          outputDirectory: request.input.output_directory,
          entries,
          normalized,
          selection: target.selection,
          maxDepth: request.input.max_depth,
          engine,
          signal,
          retainCleanup: (tree, lease, failure) => {
            ownedRootLease.bindCleanupError(failure);
            const pending: PendingFirmwareCleanup = this.#pendingCleanup.get(
              ownedRoot.path,
            ) ?? {
              root: ownedRoot,
              rootLease: ownedRootLease,
              engine: engineName,
              operation: request.operation,
            };
            pending.tree = { tree, lease };
            this.#pendingCleanup.set(ownedRoot.path, pending);
          },
        });
        raw = { report, execution: processRun, version_execution: versionRun };
      }
      const catalog =
        engineName === "binwalk"
          ? BINWALK_PROVIDER_IDENTITY
          : UNBLOB_PROVIDER_IDENTITY;
      outcome = ok(
        createAnalysisExecution(
          result,
          { ...catalog, version: admitted.version },
          {
            subject: target.subject,
            rawResult: raw,
            limitations: [
              ...limitations,
              ...(engineName === "unblob" && publishedSymlinks(result)
                ? [UNBLOB_LINK_TARGET_LIMITATION]
                : []),
              ...(admitted.status === "compatible"
                ? [admitted.limitation]
                : []),
            ],
            locations: [
              {
                kind: "file-offset-range",
                start: target.selection.offset,
                end: target.selection.offset + target.selection.length,
              },
            ],
          },
        ),
      );
    } catch (cause: unknown) {
      const failure = firmwareFailure(cause, {
        engine: engineName,
        operation: request.operation,
        deadline,
      });
      outcome = err(failure);
    }
    const finished = await finishFirmwareWorkspace(
      root,
      outcome,
      engineName,
      request,
      rootLease,
      signal,
      deadline,
    );
    if (
      !finished.ok &&
      finished.error.cleanupIncomplete &&
      root !== undefined &&
      rootLease !== undefined &&
      finished.error.cleanupResources.includes(root.path) &&
      !this.#pendingCleanup.has(root.path)
    )
      this.#pendingCleanup.set(root.path, {
        root,
        rootLease,
        engine: engineName,
        operation: request.operation,
      });
    if (
      !finished.ok &&
      root !== undefined &&
      rootLease !== undefined &&
      finished.error.cleanupResources.includes(root.path)
    )
      rootLease.bindCleanupError(finished.error);
    if (finished.ok) {
      const interruption = firmwarePhaseInterruption(
        request.operation,
        signal,
        deadline,
      );
      if (interruption !== undefined)
        return err(
          interruption.retainPartialObservation(
            completedFirmwareObservation(finished.value),
          ),
        );
    }
    return finished;
  }
}

/** Keep a completed extraction beside cleanup failure, or skip removal when ownership is uncertain. */
const finishFirmwareWorkspace = async (
  root: { readonly path: string; close(): Promise<void> } | undefined,
  outcome: Outcome,
  engineName: string,
  request: FirmwareRequest,
  rootLease: AnalysisCleanupLease | undefined,
  signal: AbortSignal,
  deadline: FirmwareDeadline,
): Promise<Outcome> => {
  if (
    !outcome.ok &&
    outcome.error.cleanupIncomplete &&
    (root === undefined || outcome.error.cleanupResources.includes(root.path))
  )
    return outcome;
  try {
    await rootLease?.release();
  } catch (cause: unknown) {
    const cleanup = new ProviderCleanupError(
      engineName,
      [
        root?.path ?? "unknown",
        ...(outcome.ok && request.operation === "extract_firmware"
          ? [request.input.output_directory]
          : []),
      ],
      { reason: cause instanceof Error ? cause.message : String(cause) },
      {
        cause,
        operation: request.operation,
        ...(outcome.ok
          ? {
              partialObservation: completedFirmwareObservation(outcome.value),
            }
          : outcome.error.partialObservation === undefined
            ? {}
            : { partialObservation: outcome.error.partialObservation }),
      },
    );
    rootLease?.bindCleanupError(cleanup);
    const primary = outcome.ok
      ? firmwarePhaseInterruption(request.operation, signal, deadline)
      : undefined;
    if (outcome.ok && primary !== undefined) {
      primary.retainPartialObservation(
        completedFirmwareObservation(outcome.value),
      );
      return err(
        analysisErrorWithCleanupFailure(
          primary,
          cleanup,
          request.operation,
        ).bindCleanupDependencies([cleanup]),
      );
    }
    return err(
      outcome.ok
        ? cleanup
        : analysisErrorWithCleanupFailure(
            outcome.error,
            cleanup,
            request.operation,
          ).bindCleanupDependencies([outcome.error, cleanup]),
    );
  }
  return outcome;
};

const completedFirmwareObservation = (
  execution: AnalysisExecution,
): FirmwarePartialObservation => ({
  kind: "firmware",
  result: execution.result,
  provenance: jsonValueSchema.parse({
    raw_result: execution.rawResult,
    provider: execution.provider,
    subject: execution.subject,
    locations: execution.locations,
    limitations: execution.limitations,
    ...(execution.analysisProfile === undefined
      ? {}
      : { analysis_profile: execution.analysisProfile }),
  }),
});
