import { snapshotEnvironment } from "../../process/snapshotEnvironment.js";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JavaScriptRecoveryPort } from "../../application/javascript/JavaScriptRecoveryPort.js";
import type {
  AnalysisExecution,
  ExecutionOptions,
} from "../../application/AnalysisProvider.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { AnalysisCleanupLease } from "../../artifacts/AnalysisCleanupLease.js";
import { SafeOutputTree } from "../../artifacts/SafeOutputTree.js";
import { SafeOutputTreeCreationFailure } from "../../artifacts/SafeOutputTreeCreationFailure.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { artifactFileCancellationCause } from "../../artifacts/ArtifactFileOperation.js";
import {
  javascriptRecoveryResultSchema,
  type JavaScriptRecoveryInput,
} from "../../domain/javascript/javascriptRecovery.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  checkRecoveryCancellation,
  checkRecoveryDeadline,
  recoveryFailureMessage,
  recoveryInputFailure,
  snapshotRecoveryInputs,
} from "./RecoveryFiles.js";
import {
  resolveWakaruCommand,
  type WakaruLauncher,
  WakaruCleanupFailure,
} from "./WakaruCommand.js";
import type { ProviderProcessSupervisor } from "../../process/ProviderProcess.js";
import { prepareWakaruExecution } from "./WakaruExecution.js";
import { RECOVERY_LIMITS } from "./WakaruRelease.js";

const OPERATION = "recover_javascript_sources";

interface PendingRecoveryCleanup {
  root: string | undefined;
  process: ProviderProcessSupervisor | undefined;
  tree: SafeOutputTree | undefined;
}

/** Serialized recovery adapter retaining failed process, workspace and publication cleanup. */
export class WakaruProvider implements JavaScriptRecoveryPort {
  readonly #resources = new ArtifactResourceScope();
  #tail: Promise<void> = Promise.resolve();
  #closing = false;
  #closePromise: Promise<void> | undefined;
  #pendingCleanup:
    | {
        readonly resources: PendingRecoveryCleanup;
        readonly lease: AnalysisCleanupLease;
      }
    | undefined;

  constructor(
    readonly environment: Readonly<
      Record<string, string | undefined>
    > = process.env,
    readonly launcher?: WakaruLauncher,
  ) {}

  /** Recover selected scripts using validated reports and verified output bytes. */
  recover(
    input: JavaScriptRecoveryInput,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    if (this.#closing)
      return Promise.resolve(
        err(
          new ProviderCleanupError(
            "wakaru",
            [],
            { reason: "Provider is closing" },
            { operation: OPERATION },
          ),
        ),
      );
    const operation = this.#tail.then(() =>
      this.#closing
        ? err(
            new ProviderCleanupError(
              "wakaru",
              [],
              { reason: "Provider is closing" },
              { operation: OPERATION },
            ),
          )
        : this.#recover(input, options),
    );
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async #recover(
    input: JavaScriptRecoveryInput,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const pending = await this.#retire();
    if (pending !== undefined) return err(pending);
    // Capture configuration after queue/cleanup admission; later requests may select updates.
    const environment = snapshotEnvironment(this.environment);
    let root: string | undefined;
    let tree: SafeOutputTree | undefined;
    let failed: { readonly cause: unknown } | undefined;
    let execution: AnalysisExecution | undefined;
    const deadline = performance.now() + RECOVERY_LIMITS.timeoutMs;
    try {
      checkRecoveryCancellation(options?.signal);
      const engine = await resolveWakaruCommand(
        environment,
        this.#resources,
        options?.signal,
      );
      root = await mkdtemp(join(tmpdir(), "rea-wakaru-"));
      const inputs = join(root, "inputs");
      const staging = join(root, "modules");
      await mkdir(inputs, { mode: 0o700 });
      await mkdir(staging, { mode: 0o700 });
      const sources = await snapshotRecoveryInputs(
        [input.path, ...(input.additional_paths ?? [])],
        inputs,
        options?.signal,
        this.#resources,
      );
      try {
        tree = await SafeOutputTree.create(input.output_directory);
      } catch (cause: unknown) {
        if (cause instanceof SafeOutputTreeCreationFailure) tree = cause.tree;
        throw recoveryInputFailure(
          "output_directory",
          `Cannot create new recovery directory ${input.output_directory}: ${recoveryFailureMessage(cause)}`,
          cause,
        );
      }
      execution = await prepareWakaruExecution({
        root,
        tree,
        resources: this.#resources,
        input,
        sources,
        engine,
        environment,
        launcher: this.launcher,
        options,
        deadline,
      });
      checkRecoveryDeadline(deadline, options?.signal);
      await rm(root, { recursive: true, force: true });
      root = undefined;
      checkRecoveryDeadline(deadline, options?.signal);
      await tree.commit(options?.signal);
    } catch (cause: unknown) {
      failed = { cause };
    }
    if (failed !== undefined) {
      const failure =
        failed.cause instanceof ArtifactReaderFailure &&
        failed.cause.reason === "cancelled" &&
        failed.cause.cleanup === undefined
          ? new AnalysisCancelledError(OPERATION, {
              cause: artifactFileCancellationCause(failed.cause),
            })
          : failed.cause;
      const residuals: string[] = [];
      const cleanupFailures: { resource: string; reason: string }[] = [];
      const cleanupOwner =
        failure instanceof WakaruCleanupFailure
          ? failure.cleanupOwner
          : undefined;
      let failedTree: SafeOutputTree | undefined;
      try {
        await tree?.rollback();
      } catch (cause: unknown) {
        if (tree !== undefined) {
          failedTree = tree;
          residuals.push(tree.outputRoot);
          cleanupFailures.push({
            resource: tree.outputRoot,
            reason: recoveryFailureMessage(cause),
          });
        }
      }
      if (cleanupOwner !== undefined)
        residuals.push(cleanupOwner.launch.ownership?.runId ?? "wakaru-worker");
      const filesPending = this.#resources.hasPending;
      if (filesPending) residuals.push(...this.#resources.cleanupResources);
      if (root !== undefined && cleanupOwner === undefined && !filesPending) {
        const failedRoot = root;
        try {
          await rm(failedRoot, { recursive: true, force: true });
          root = undefined;
        } catch (cause: unknown) {
          residuals.push(failedRoot);
          cleanupFailures.push({
            resource: failedRoot,
            reason: recoveryFailureMessage(cause),
          });
        }
      }
      if (
        cleanupOwner !== undefined ||
        failedTree !== undefined ||
        root !== undefined ||
        filesPending
      ) {
        const resources: PendingRecoveryCleanup = {
          root,
          process: cleanupOwner,
          tree: failedTree,
        };
        const files = this.#resources;
        const lease = new AnalysisCleanupLease(
          () => this.#releasePending(resources),
          {
            get cleanupResources() {
              return [
                ...files.cleanupResources,
                ...(resources.process === undefined
                  ? []
                  : [
                      resources.process.launch.ownership?.runId ??
                        "wakaru-worker",
                    ]),
                ...(resources.tree === undefined
                  ? []
                  : [resources.tree.outputRoot]),
                ...(resources.root === undefined ? [] : [resources.root]),
              ];
            },
          },
        );
        this.#pendingCleanup = { resources, lease };
        if (root !== undefined) residuals.push(root);
        root = undefined;
      }
      if (residuals.length > 0) {
        const error = new ProviderCleanupError(
          "wakaru",
          residuals,
          {
            ...(failure instanceof WakaruCleanupFailure
              ? failure.diagnostics
              : {}),
            previous_error:
              failure instanceof WakaruCleanupFailure
                ? (failure.diagnostics?.previous_error ?? null)
                : recoveryFailureMessage(failure),
            cleanup_failures: cleanupFailures,
          },
          {
            operation: OPERATION,
            cause: failure,
            ...(tree?.published && execution !== undefined
              ? {
                  partialObservation: {
                    kind: "javascript-recovery" as const,
                    result: javascriptRecoveryResultSchema.parse(
                      execution.result,
                    ),
                  },
                }
              : {}),
          },
        );
        const lease = this.#pendingCleanup?.lease;
        if (lease !== undefined) {
          lease.bindCleanupError(error);
          error.bindCleanupResourceOwner(lease);
        }
        return err(error);
      }
      if (tree?.published === true && execution !== undefined)
        return ok(execution);
      return err(
        failure instanceof AnalysisError
          ? failure
          : new ProviderAdapterError("wakaru", OPERATION, {
              cause: failure,
              diagnostics: { reason: recoveryFailureMessage(failure) },
            }),
      );
    }
    return execution === undefined
      ? err(
          new AnalysisOutputError(OPERATION, "Recovery returned no execution"),
        )
      : ok(execution);
  }

  async close(): Promise<void> {
    this.#closing = true;
    this.#closePromise ??= this.#tail
      .then(async () => {
        const failure = await this.#retire();
        if (failure !== undefined) throw failure;
      })
      .catch((cause: unknown) => {
        this.#closePromise = undefined;
        throw cause;
      });
    return this.#closePromise;
  }

  async #retire(): Promise<ProviderCleanupError | undefined> {
    const pending = this.#pendingCleanup;
    if (pending === undefined) return undefined;
    try {
      await pending.lease.release();
      this.#pendingCleanup = undefined;
      return undefined;
    } catch (cause: unknown) {
      const error = new ProviderCleanupError(
        "wakaru",
        pending.lease.cleanupResources ?? [],
        { reason: recoveryFailureMessage(cause) },
        { operation: OPERATION, cause },
      ).bindCleanupResourceOwner(pending.lease);
      pending.lease.bindCleanupError(error);
      return error;
    }
  }

  async #releasePending(pending: PendingRecoveryCleanup): Promise<void> {
    if (pending.process !== undefined) {
      const stopped = await pending.process.stop();
      if (stopped.status === "incomplete") throw new Error(stopped.reason);
      pending.process = undefined;
    }
    await this.#resources.retryCleanup();
    if (pending.tree !== undefined) {
      await pending.tree.rollback();
      pending.tree = undefined;
    }
    if (pending.root !== undefined) {
      await rm(pending.root, { recursive: true, force: true });
      pending.root = undefined;
    }
  }
}
