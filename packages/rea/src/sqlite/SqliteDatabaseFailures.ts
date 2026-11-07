import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  ArtifactFileCleanupFailure,
  bindArtifactFileCleanup,
  artifactFileCancellationCause,
} from "../artifacts/ArtifactFileOperation.js";
import {
  projectAnalysisError,
  projectAnalysisErrorWithoutCapturedOutput,
} from "../domain/analysisErrorProjection.js";
import {
  AnalysisError,
  primaryAnalysisError,
  type AnalysisCapturedOutput,
  type AnalysisErrorOptions,
} from "../domain/analysisErrorBase.js";
import type { JsonValue } from "../domain/jsonValue.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCapabilityUnavailableError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { OwnedCommandFailure } from "../process/OwnedCommand.js";
import type { ProviderProcessSnapshot } from "../process/ProviderProcess.js";
import {
  SQLITE_PROVIDER_IDENTITY,
  DEFAULT_SQLITE_WORKER_TIMEOUT_MS,
  MAX_SQLITE_WORKER_TIMEOUT_MS,
} from "../domain/sqlite/sqliteDatabase.js";
import { SQLITE_DATABASE_LIMITS } from "./SqliteDatabaseLimits.js";
import { SqliteSnapshotAcquisitionFailure } from "./SqliteDatabaseSnapshot.js";

/** Preserve diagnostics independently of worker exit and private-root cleanup. */
export const capturedSqliteOutput = (
  snapshot: ProviderProcessSnapshot,
): AnalysisCapturedOutput => ({
  stdout: snapshot.stdout.text,
  stderr: snapshot.stderr.text,
  truncated: snapshot.diagnosticTruncated === true,
});

/** Keep typed cleanup history and one canonical output owner, including after resolution. */
export const createSqliteCleanupError = (
  resources: readonly string[],
  diagnostics: Readonly<Record<string, JsonValue>>,
  options: Omit<AnalysisErrorOptions, "diagnostics">,
): ProviderCleanupError => {
  const capturedOutput =
    options.capturedOutput ?? options.cleanupPrimary?.capturedOutput;
  const previous =
    options.cleanupPrimary === undefined
      ? null
      : capturedOutput === undefined
        ? projectAnalysisError(options.cleanupPrimary)
        : projectAnalysisErrorWithoutCapturedOutput(options.cleanupPrimary);
  return new ProviderCleanupError(
    SQLITE_PROVIDER_IDENTITY.id,
    resources,
    {
      ...diagnostics,
      previous_error: previous ?? diagnostics.previous_error ?? null,
    },
    {
      ...options,
      operation: "inspect_sqlite_database",
      ...(capturedOutput === undefined ? {} : { capturedOutput }),
    },
  );
};

/** The file-set member a filesystem error names, if it is the database, its WAL or its journal. */
const busyMember = (cause: Error, path: string): string => {
  const failed = "path" in cause ? cause.path : undefined;
  return typeof failed === "string" &&
    [path, `${path}-wal`, `${path}-journal`].includes(failed)
    ? failed
    : path;
};

/** Preserve artifact, caller, process, resource and output failure meanings. */
export const sqliteDatabaseFailure = (
  cause: unknown,
  path: string,
  phase: string,
  signal?: AbortSignal,
  workerTimeoutMs = DEFAULT_SQLITE_WORKER_TIMEOUT_MS,
): AnalysisError => {
  const operation = "inspect_sqlite_database";
  if (cause instanceof SqliteSnapshotAcquisitionFailure) {
    const failure = sqliteDatabaseFailure(
      cause.operationCause,
      path,
      phase,
      signal,
      workerTimeoutMs,
    );
    const diagnostics = {
      snapshot_acquisition: {
        consistency: "unverified",
        members: cause.completedMembers.map((member) => ({ ...member })),
      },
    };
    failure.retainDiagnostics(diagnostics);
    // Keep the facts on the semantic error after its cleanup envelope resolves.
    const primary = primaryAnalysisError(failure);
    if (primary !== failure) primary.retainDiagnostics(diagnostics);
    return failure;
  }
  if (cause instanceof AnalysisError) return cause;
  if (cause instanceof ArtifactReaderFailure) {
    if (cause.cleanup !== undefined) {
      const physicalRead =
        cause instanceof ArtifactFileCleanupFailure
          ? cause.fileCleanupFailure.outcome
          : undefined;
      let previous: AnalysisError | undefined;
      if (physicalRead?.kind === "failed")
        previous = sqliteDatabaseFailure(
          physicalRead.cause,
          path,
          phase,
          undefined,
          workerTimeoutMs,
        );
      else if (cause.reason === "cancelled")
        previous = new AnalysisCancelledError(operation, {
          cause: artifactFileCancellationCause(cause),
        });
      else if (physicalRead?.kind === "completed") previous = undefined;
      else if (cause.cause !== undefined)
        previous = sqliteDatabaseFailure(
          cause.cause,
          path,
          phase,
          undefined,
          workerTimeoutMs,
        );

      const error = createSqliteCleanupError(
        cause.cleanup.resources,
        {
          reason: cause.cleanup.reason,
        },
        {
          cause,
          ...(previous === undefined ? {} : { cleanupPrimary: previous }),
        },
      );
      bindArtifactFileCleanup(cause, error);
      return error;
    }
    if (cause.reason === "io" && cause.cause !== undefined)
      return sqliteDatabaseFailure(
        cause.cause,
        path,
        phase,
        signal,
        workerTimeoutMs,
      );
    if (cause.reason === "integrity")
      return new AnalysisArtifactChangedError(operation, path, cause.message, {
        cause,
      });
    if (cause.reason === "cancelled")
      return new AnalysisCancelledError(operation, {
        cause: artifactFileCancellationCause(cause),
      });
    return new AnalysisInputError(operation, { cause }, [
      {
        path: ["path"],
        reason: "invalid_format",
        message: cause.message,
      },
    ]);
  }
  if (cause instanceof Error && cause.name === "AbortError")
    return new AnalysisCancelledError(operation, {
      cause:
        signal?.aborted === true && cause.cause === signal.reason
          ? signal.reason
          : cause,
    });
  if (cause instanceof OwnedCommandFailure) {
    const projected = ownedCommandFailure(cause, path, workerTimeoutMs);
    if (projected !== undefined) return projected;
  }
  if (phase === "artifact-read" && cause instanceof Error && "code" in cause) {
    if (cause.code === "EACCES" || cause.code === "EPERM")
      return new AnalysisAccessDeniedError(operation, path, cause.code, {
        cause,
      });
    // Windows reports a sharing violation as EBUSY: another process holds the file without read
    // sharing. The unchanged request succeeds once that process releases it. Name the member of the
    // file set that was busy (the database, its WAL or its journal) when the error identifies it.
    if (cause.code === "EBUSY")
      return new AnalysisCapabilityUnavailableError(
        SQLITE_PROVIDER_IDENTITY.id,
        operation,
        `Selected database file set is in use by another process (EBUSY): ${busyMember(cause, path)}`,
        {
          cause,
          retryable: true,
          userMessage:
            "The selected SQLite database is held open by another process without read sharing. Close that application or inspect a copy, then retry.",
        },
      );
    if (
      cause.code === "ENOENT" ||
      cause.code === "ENOTDIR" ||
      cause.code === "ELOOP" ||
      cause.code === "ENAMETOOLONG"
    )
      return new AnalysisInputError(operation, { cause }, [
        {
          path: ["path"],
          reason: "invalid_value",
          message: `Selected database file set could not be read (${String(cause.code)}): ${path}`,
        },
      ]);
  }
  return new ProviderAdapterError(SQLITE_PROVIDER_IDENTITY.id, operation, {
    cause,
    diagnostics: {
      phase,
      path,
      reason: cause instanceof Error ? cause.message : String(cause),
      ...(cause instanceof OwnedCommandFailure && cause.snapshot !== null
        ? {
            failure_kind: cause.reason,
            exit_code: cause.snapshot.exitCode ?? null,
            signal: cause.snapshot.signal ?? null,
            captured_output: { ...capturedSqliteOutput(cause.snapshot) },
          }
        : {}),
    },
  });
};

const ownedCommandFailure = (
  cause: OwnedCommandFailure,
  selectedPath: string,
  workerTimeoutMs: number,
): AnalysisError | undefined => {
  const operation = "inspect_sqlite_database";
  const capturedOutput =
    cause.snapshot === null ? undefined : capturedSqliteOutput(cause.snapshot);
  const options = {
    cause,
    ...(capturedOutput === undefined ? {} : { capturedOutput }),
  };
  // Preserve the same typed primary whether or not owned cleanup also fails.
  const timeout =
    cause.reason === "timeout"
      ? new AnalysisTimeoutError(operation, workerTimeoutMs, {
          ...options,
          userMessage: `The SQLite worker reached its ${String(workerTimeoutMs)} ms server/provider deadline (worker_timeout_ms). This is not a whole-inspection or MCP client deadline.`,
          remediationAction: `${
            workerTimeoutMs < MAX_SQLITE_WORKER_TIMEOUT_MS
              ? `Increase worker_timeout_ms above ${String(workerTimeoutMs)} (integer milliseconds, maximum ${String(MAX_SQLITE_WORKER_TIMEOUT_MS)}), or use rea inspect-sqlite-database <path> --worker-timeout-ms <milliseconds> on the CLI.`
              : `worker_timeout_ms is already at the maximum supported ${String(MAX_SQLITE_WORKER_TIMEOUT_MS)} ms; no higher worker deadline is supported. Report the blocker or narrow the question with caller approval.`
          } This per-call setting needs no server restart. It covers worker startup, queries and reply writing, not snapshot acquisition or final reply reads/cleanup. Allow client headroom for the whole call; increasing only the client deadline does not change the worker budget. Keep the selected database/WAL and requested facts; narrow table/columns/schema_scope/row_limit only if the question permits it. Byte and heap safety limits remain fixed. Resolve incomplete cleanup before retrying; do not repeat the unchanged failed call.`,
        })
      : undefined;
  if (cause.cleanupFailure !== null)
    return createSqliteCleanupError(
      cause.resources,
      {
        reason: cause.cleanupFailure,
        ...(timeout === undefined
          ? {
              previous_error: {
                failure_kind: cause.reason,
                message: cause.message,
              },
            }
          : {}),
      },
      {
        ...options,
        ...(timeout === undefined ? {} : { cleanupPrimary: timeout }),
      },
    );
  if (cause.reason === "cancelled")
    return new AnalysisCancelledError(operation, {
      ...options,
      cause:
        cause.cancellation === undefined ? cause : cause.cancellation.reason,
    });
  if (timeout !== undefined) return timeout;
  if (cause.reason === "output-limit")
    return new AnalysisOutputError(operation, cause.message, {
      ...options,
      userMessage: `SQLite worker diagnostics exceeded the ${String(SQLITE_DATABASE_LIMITS.diagnosticBytes)}-byte capture allowance. This release has no runtime override.`,
      remediationAction: `The SQLite diagnostic capture allowance is ${String(SQLITE_DATABASE_LIMITS.diagnosticBytes)} bytes. This release has no runtime override. worker_timeout_ms does not raise it. Repeating the unchanged request fails the same way.`,
    });
  if (
    cause.snapshot?.stderr.text.includes("JavaScript heap out of memory") ===
    true
  )
    return new AnalysisResourceConstraintError(
      operation,
      "memory",
      "Owned SQLite worker reported JavaScript heap exhaustion.",
      {
        javascript_heap_bytes: 256 * 1024 * 1024,
      },
      { ...options, diagnostics: { selected_path: selectedPath } },
    );
  return undefined;
};
