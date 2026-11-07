import {
  createAnalysisExecution,
  type AnalysisExecution,
  type ExecutionOptions,
} from "../application/AnalysisProvider.js";
import type { SqliteDatabasePort } from "../application/sqlite/SqliteDatabasePort.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { bindArtifactFileCleanup } from "../artifacts/ArtifactFileOperation.js";
import type {
  AnalysisCapturedOutput,
  AnalysisError,
} from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { createEvidence } from "../domain/evidence.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  inspectSqliteDatabaseInputSchema,
  sqliteDatabaseSchema,
  type InspectSqliteDatabaseInput,
  SQLITE_PROVIDER_IDENTITY,
  DEFAULT_SQLITE_WORKER_TIMEOUT_MS,
  sqliteInspectionParameters,
} from "../domain/sqlite/sqliteDatabase.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";
import {
  OwnedCommandFailure,
  ownedCommandResources,
} from "../process/OwnedCommand.js";
import type {
  ProviderProcessStopResult,
  ProviderProcessSupervisor,
} from "../process/ProviderProcess.js";
import {
  createSqliteCleanupError,
  sqliteDatabaseFailure,
} from "./SqliteDatabaseFailures.js";
import { captureSqliteDatabaseSnapshot } from "./SqliteDatabaseSnapshot.js";
import { SQLITE_DATABASE_LIMITS } from "./SqliteDatabaseLimits.js";

import {
  executeSqliteDatabaseWorker,
  sqliteReplyFinalizationFailure,
  type SqliteWorkerLauncher,
} from "./SqliteDatabaseWorkerExecution.js";

const operation = "inspect_sqlite_database";
type SqliteOutcome = Result<AnalysisExecution, AnalysisError>;
type SqliteRuntimeRoot = Pick<PrivateRuntimeRoot, "path" | "close">;
interface PendingSnapshotCleanup {
  readonly input: InspectSqliteDatabaseInput;
  readonly result: SqliteOutcome;
  readonly output: AnalysisCapturedOutput | undefined;
  readonly rootFailure: AnalysisError;
  readonly processFailure: AnalysisError | undefined;
  process: ProviderProcessSupervisor | undefined;
}
/** Inspect a provider-owned copy through a cancellable SQLite child, without source writes. */
export class SqliteDatabaseProvider implements SqliteDatabasePort {
  readonly #active = new Set<Promise<SqliteOutcome>>();
  readonly #artifactResources = new ArtifactResourceScope();
  readonly #pendingCleanup = new Map<
    SqliteRuntimeRoot,
    PendingSnapshotCleanup
  >();
  #closed = false;
  #closePromise: Promise<void> | undefined;
  #retryPromise: Promise<Result<null, AnalysisError>> | undefined;
  constructor(
    readonly environment: Readonly<NodeJS.ProcessEnv> = process.env,
    readonly launcher?: SqliteWorkerLauncher,
    readonly createRuntime: () => Promise<
      Pick<PrivateRuntimeRoot, "path" | "close">
    > = () => PrivateRuntimeRoot.create({ prefix: "rea-sqlite-database-" }),
  ) {}

  /** Return exact original DB/WAL identities and current schema/selected committed rows. */
  async inspect(
    input: InspectSqliteDatabaseInput,
    options?: ExecutionOptions,
  ): Promise<SqliteOutcome> {
    if (options?.signal?.aborted)
      return err(
        new AnalysisCancelledError(operation, {
          cause: options.signal.reason,
        }),
      );
    if (this.#closed) return err(new AnalysisCancelledError(operation));
    if (this.#active.size >= SQLITE_DATABASE_LIMITS.concurrentInspections)
      return err(
        new AnalysisResourceConstraintError(
          operation,
          "capacity",
          "SQLite inspection capacity is occupied. Retry after an active inspection completes.",
          {
            active_inspections: this.#active.size,
            max_concurrent_inspections:
              SQLITE_DATABASE_LIMITS.concurrentInspections,
            input_bytes_per_inspection: SQLITE_DATABASE_LIMITS.inputBytes,
          },
          {
            remediationAction: `The concurrent SQLite inspection allowance is ${String(SQLITE_DATABASE_LIMITS.concurrentInspections)}. This release has no runtime override. Waiting for an active inspection to finish can free a slot. worker_timeout_ms does not raise it. Retry after an active SQLite inspection completes.`,
          },
        ),
      );
    const inspection = this.#artifactResources
      .run(() => this.#inspect(input, options))
      .catch((cause: unknown) =>
        err(
          sqliteDatabaseFailure(
            cause,
            input.path,
            "artifact-read",
            options?.signal,
          ),
        ),
      );
    this.#active.add(inspection);
    try {
      return await inspection;
    } finally {
      this.#active.delete(inspection);
    }
  }

  /** Await inspections and retry retained descriptors, workers, and snapshot roots. */
  close(): Promise<void> {
    this.#closed = true;
    this.#closePromise ??= Promise.allSettled(this.#active)
      .then(async () => {
        let descriptorFailure: AnalysisError | undefined;
        try {
          await this.#artifactResources.close();
        } catch (cause: unknown) {
          const cleanup = ArtifactReaderFailure.cleanupObservation(
            cause,
            "SQLite artifact descriptors",
          );
          descriptorFailure = new ProviderCleanupError(
            SQLITE_PROVIDER_IDENTITY.id,
            cleanup.resources,
            { reason: cleanup.reason },
            { operation, cause },
          );
          bindArtifactFileCleanup(cause, descriptorFailure);
        }
        const cleaned = await this.#retryCleanup();
        if (descriptorFailure !== undefined && !cleaned.ok) {
          const failure = new ProviderCleanupError(
            SQLITE_PROVIDER_IDENTITY.id,
            [
              ...descriptorFailure.cleanupResources,
              ...cleaned.error.cleanupResources,
            ],
            {
              failures: [
                projectAnalysisError(descriptorFailure),
                projectAnalysisError(cleaned.error),
              ],
            },
            { operation },
          );
          failure.bindCleanupDependencies([descriptorFailure, cleaned.error]);
          throw failure;
        }
        if (descriptorFailure !== undefined) throw descriptorFailure;
        if (!cleaned.ok) throw cleaned.error;
      })
      .catch((cause: unknown) => {
        this.#closePromise = undefined;
        throw cause;
      });
    return this.#closePromise;
  }

  #retryCleanup(): Promise<Result<null, AnalysisError>> {
    this.#retryPromise ??= this.#cleanupPending().finally(() => {
      this.#retryPromise = undefined;
    });
    return this.#retryPromise;
  }

  async #cleanupPending(): Promise<Result<null, AnalysisError>> {
    const failures: AnalysisError[] = [];
    for (const [root, pending] of [...this.#pendingCleanup]) {
      if (pending.process !== undefined) {
        const stopped = await pending.process.stop();
        if (stopped.status === "incomplete" || stopped.status === "not-owned") {
          const reason =
            stopped.status === "incomplete"
              ? stopped.reason
              : "SQLite worker ownership remains unresolved.";
          const failure = sqliteCleanupFailure(
            [
              pending.process.launch.ownership?.runId ?? "owned-sqlite-worker",
              root.path,
            ],
            reason,
            pending.result,
            pending.input,
            pending.output,
          );
          failure.bindCleanupDependencies(
            [pending.processFailure, pending.rootFailure].filter(
              (dependency): dependency is AnalysisError =>
                dependency !== undefined,
            ),
          );
          failures.push(failure);
          continue;
        }
        pending.process = undefined;
        pending.processFailure?.resolveCleanup();
      }
      const cleaned = await cleanupSqliteRoot(
        root,
        pending.result,
        pending.input,
        pending.output,
      );
      if (cleaned.ok) {
        pending.rootFailure.resolveCleanup();
        this.#pendingCleanup.delete(root);
      } else {
        cleaned.error.bindCleanupDependencies([pending.rootFailure]);
        failures.push(cleaned.error);
      }
    }
    if (failures.length === 1 && failures[0] !== undefined)
      return err(failures[0]);
    return failures.length === 0
      ? ok(null)
      : err(
          new ProviderCleanupError(
            SQLITE_PROVIDER_IDENTITY.id,
            failures.flatMap((failure) => failure.cleanupResources),
            { failures: failures.map(projectAnalysisError) },
            { operation },
          ).bindCleanupDependencies(failures),
        );
  }

  async #inspect(
    input: InspectSqliteDatabaseInput,
    options?: ExecutionOptions,
  ): Promise<SqliteOutcome> {
    let root: Pick<PrivateRuntimeRoot, "path" | "close"> | undefined;
    let processOwner: ProviderProcessSupervisor | undefined;
    let processCleanup:
      | Extract<ProviderProcessStopResult, { status: "incomplete" }>
      | undefined;
    let retainedOutput: AnalysisCapturedOutput | undefined;
    let phase = "configuration";
    let result: Result<AnalysisExecution, AnalysisError>;
    const workerTimeoutMs =
      input.worker_timeout_ms ?? DEFAULT_SQLITE_WORKER_TIMEOUT_MS;
    try {
      if (options?.signal?.aborted)
        throw new AnalysisCancelledError(operation, {
          cause: options.signal.reason,
        });
      validateSqliteInput(input);
      const retired = await this.#retryCleanup();
      if (!retired.ok) return retired;
      if (options?.signal?.aborted)
        throw new AnalysisCancelledError(operation, {
          cause: options.signal.reason,
        });
      if (this.#closed) throw new AnalysisCancelledError(operation);
      root = await this.createRuntime();
      phase = "artifact-read";
      const snapshot = await captureSqliteDatabaseSnapshot(
        input.path,
        root.path,
        this.#artifactResources,
        options?.signal,
      );
      phase = "worker";
      const completed = await executeSqliteDatabaseWorker({
        input,
        root: root.path,
        snapshotPath: snapshot.snapshotPath,
        timeoutMs: workerTimeoutMs,
        environment: this.environment,
        resourceScope: this.#artifactResources,
        ...(this.launcher === undefined ? {} : { launcher: this.launcher }),
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        captured: (output) => {
          retainedOutput = output;
        },
        retainCleanup: (owner, result) => {
          processOwner = owner;
          processCleanup = result;
        },
      });
      const validated = sqliteDatabaseSchema.safeParse({
        artifact: snapshot.artifact,
        wal: snapshot.wal,
        ...completed.inspection,
        worker_timeout_ms: workerTimeoutMs,
      });
      if (!validated.success)
        throw sqliteReplyFinalizationFailure(
          new AnalysisOutputError(
            operation,
            "SQLite worker report dimensions or identity fields are invalid",
            retainedOutput === undefined
              ? undefined
              : { capturedOutput: retainedOutput },
          ),
          completed.finalization,
        );
      const execution = createSqliteObservation(validated.data, input.path);
      result =
        completed.finalization === undefined
          ? ok(execution)
          : err(
              completed.finalization.retainPartialObservation(
                completedSqliteEvidence(input, execution),
              ),
            );
    } catch (cause: unknown) {
      // A failure rethrown after retainCleanup carries no owner of its own;
      // keep the retained worker instead of discarding it.
      if (
        cause instanceof OwnedCommandFailure &&
        cause.cleanupOwner !== undefined
      )
        processOwner = cause.cleanupOwner;
      const failure = sqliteDatabaseFailure(
        cause,
        input.path,
        phase,
        options?.signal,
        workerTimeoutMs,
      );
      retainedOutput ??= failure.capturedOutput;
      result = err(failure);
    }
    if (root !== undefined) {
      if (processOwner !== undefined) {
        const ownership = processOwner.launch.ownership;
        const rootFailure = new ProviderCleanupError(
          SQLITE_PROVIDER_IDENTITY.id,
          [root.path],
          { reason: "SQLite runtime root cleanup remains unresolved." },
          { operation },
        );
        const processReason =
          processCleanup?.reason ?? "SQLite worker cleanup remains unresolved.";
        const processFailure = new ProviderCleanupError(
          SQLITE_PROVIDER_IDENTITY.id,
          ownership === undefined
            ? ["owned-sqlite-worker"]
            : ownedCommandResources(ownership),
          { reason: processReason },
          { operation },
        );
        this.#pendingCleanup.set(root, {
          input,
          result,
          output: retainedOutput,
          rootFailure,
          processFailure,
          process: processOwner,
        });
        if (processCleanup !== undefined) {
          const failure = sqliteCleanupFailure(
            ownership === undefined
              ? ["owned-sqlite-worker", root.path]
              : ownedCommandResources(ownership, root.path),
            processCleanup.reason,
            result,
            input,
            retainedOutput,
            processCleanup.cleanupResult === undefined
              ? undefined
              : {
                  ...(processCleanup.cleanupResult.failures === undefined
                    ? {}
                    : {
                        failures: processCleanup.cleanupResult.failures.map(
                          (failure) => ({ ...failure }),
                        ),
                      }),
                  ...(processCleanup.cleanupResult.unverified === undefined
                    ? {}
                    : {
                        unverified: processCleanup.cleanupResult.unverified.map(
                          (process) => ({ ...process }),
                        ),
                      }),
                },
          );
          failure.bindCleanupDependencies([processFailure, rootFailure]);
          return err(failure);
        }
        if (!result.ok) {
          result.error.bindCleanupDependencies([processFailure, rootFailure]);
          return result;
        }
        const failure = sqliteCleanupFailure(
          [
            ...(ownership === undefined
              ? ["owned-sqlite-worker"]
              : ownedCommandResources(ownership)),
            root.path,
          ],
          processReason,
          result,
          input,
          retainedOutput,
        );
        failure.bindCleanupDependencies([processFailure, rootFailure]);
        return err(failure);
      }
      const cleaned = await cleanupSqliteRoot(
        root,
        result,
        input,
        retainedOutput,
      );
      if (!cleaned.ok) {
        const rootFailure = new ProviderCleanupError(
          SQLITE_PROVIDER_IDENTITY.id,
          [root.path],
          { reason: "SQLite runtime root cleanup remains unresolved." },
          { operation },
        );
        cleaned.error.bindCleanupDependencies([rootFailure]);
        this.#pendingCleanup.set(root, {
          input,
          result,
          output: retainedOutput,
          rootFailure,
          processFailure: undefined,
          process: undefined,
        });
        return cleaned;
      }
    }
    if (result.ok && options?.signal?.aborted)
      return err(
        new AnalysisCancelledError(operation, {
          cause: options.signal.reason,
          partialObservation: completedSqliteEvidence(input, result.value),
        }),
      );
    return result;
  }
}

const createSqliteObservation = (
  report: ReturnType<typeof sqliteDatabaseSchema.parse>,
  path: string,
): AnalysisExecution => {
  const locations: AnalysisExecution["locations"][number][] = [
    { kind: "artifact-path", path },
  ];
  if (report.wal !== null)
    locations.push({ kind: "artifact-path", path: report.wal.path });
  return createAnalysisExecution(
    report,
    { ...SQLITE_PROVIDER_IDENTITY, version: `SQLite ${report.engine.version}` },
    {
      rawResult: null,
      subject: { path, format: "file", sha256: report.artifact.sha256 },
      locations,
      limitations: report.limitations,
    },
  );
};
const cleanupSqliteRoot = async (
  root: Pick<PrivateRuntimeRoot, "path" | "close">,
  result: Result<AnalysisExecution, AnalysisError>,
  input: InspectSqliteDatabaseInput,
  output?: AnalysisCapturedOutput,
): Promise<Result<null, AnalysisError>> => {
  try {
    await root.close();
    return ok(null);
  } catch (cause: unknown) {
    return err(
      sqliteCleanupFailure(
        [root.path],
        cause instanceof Error ? cause.message : String(cause),
        result,
        input,
        output,
        undefined,
        cause,
      ),
    );
  }
};

const sqliteCleanupFailure = (
  resources: readonly string[],
  reason: string,
  result: SqliteOutcome,
  input: InspectSqliteDatabaseInput,
  output?: AnalysisCapturedOutput,
  details?: Readonly<Record<string, JsonValue>>,
  cause?: unknown,
): ProviderCleanupError => {
  const partialObservation = result.ok
    ? completedSqliteEvidence(input, result.value)
    : result.error.partialObservation;
  return createSqliteCleanupError(
    resources,
    {
      ...details,
      reason,
    },
    {
      ...(output === undefined ? {} : { capturedOutput: output }),
      ...(result.ok ? {} : { cleanupPrimary: result.error }),
      ...(cause === undefined ? {} : { cause }),
      ...(partialObservation === undefined ? {} : { partialObservation }),
    },
  );
};

const completedSqliteEvidence = (
  input: InspectSqliteDatabaseInput,
  execution: AnalysisExecution,
) =>
  createEvidence(execution.subject ?? undefined, execution.provider, {
    operation,
    parameters: sqliteInspectionParameters(input),
    result: execution.result,
    confidence: "observed",
    locations: execution.locations,
    limitations: execution.limitations,
  });

const validateSqliteInput = (input: InspectSqliteDatabaseInput): void => {
  const parsed = inspectSqliteDatabaseInputSchema.safeParse(input);
  if (!parsed.success)
    throw analysisInputErrorFromIssues(operation, parsed.error.issues, input, {
      cause: parsed.error,
    });
};
