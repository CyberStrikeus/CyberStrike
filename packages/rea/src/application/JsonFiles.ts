import {
  link,
  lstat,
  mkdtemp,
  open,
  realpath,
  rename,
  stat,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import {
  EvidenceFileError,
  type PublishedEvidenceFile,
} from "../domain/evidenceErrors.js";
import {
  AnalysisCancelledError,
  type AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  JsonInputPhysicalReadFailure,
  JsonInputCancellationFailure,
  readJsonInputFile,
  readJsonObjectFile,
  type JsonObjectMemberReader,
} from "./JsonInputFile.js";
import { NonRegularFileReadError } from "../filesystem/RegularFile.js";
import {
  RegularFileCleanupFailure,
  regularFileCancellation,
} from "../filesystem/OwnedRegularFile.js";
import { bindRegularFileCleanup } from "./RegularFileRead.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { bindArtifactFileCleanup } from "../artifacts/ArtifactFileOperation.js";
import {
  type AnalysisCleanupLease,
  AnalysisCleanupLeaseGroup,
} from "../artifacts/AnalysisCleanupLease.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import { OwnedStagedOutput } from "../filesystem/OwnedStagedOutput.js";
import { StagedOutputError } from "../filesystem/StagedOutputError.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";

/** Request control and its owning operation for an interruptible atomic write. */
export interface TextWriteCancellation {
  readonly signal: AbortSignal;
  readonly operation: string;
}

type TextWriteResult<Failure = EvidenceFileError | AnalysisCancelledError> =
  Result<{ readonly path: string; readonly bytes: number }, Failure>;

/** Read JSON data without changing the caller's existing data-only contract. */
export const readJsonFile = async (
  path: string,
  signal?: AbortSignal,
  resources?: ArtifactResourceScope,
  operation = "read_evidence_file",
): Promise<
  Result<
    unknown,
    EvidenceFileError | AnalysisResourceConstraintError | AnalysisCancelledError
  >
> => {
  const read = await readJsonFileWithSource(path, signal, resources, operation);
  return read.ok ? ok(read.value.data) : read;
};

/** Read data and the absolute selected path at the same owning regular-file boundary. */
export const readJsonFileWithSource = (
  path: string,
  signal?: AbortSignal,
  resources?: ArtifactResourceScope,
  operation = "read_evidence_file",
): Promise<
  Result<
    { readonly data: unknown; readonly path: string },
    EvidenceFileError | AnalysisResourceConstraintError | AnalysisCancelledError
  >
> =>
  readJsonFileInput(
    path,
    async (selected) => {
      const read = await readJsonInputFile(
        selected,
        operation,
        signal,
        resources,
      );
      return read.ok ? ok({ data: read.value, path: selected }) : read;
    },
    signal,
    operation,
  );

/** Read selected JSON members through the same regular-file error boundary. */
export const readJsonObjectMembersFile = (
  path: string,
  scans: readonly ReadonlyMap<string, JsonObjectMemberReader>[],
  signal?: AbortSignal,
  resources?: ArtifactResourceScope,
  operation = "read_evidence_file",
): Promise<
  Result<
    void,
    EvidenceFileError | AnalysisResourceConstraintError | AnalysisCancelledError
  >
> =>
  readJsonFileInput(
    path,
    (selected) =>
      readJsonObjectFile(selected, operation, scans, signal, resources),
    signal,
    operation,
  );

type JsonFileReadFailure =
  | EvidenceFileError
  | AnalysisResourceConstraintError
  | AnalysisCancelledError;
type DecodedJsonInput<Value> = Result<
  Value,
  AnalysisInputError | AnalysisResourceConstraintError
>;

const readJsonFileInput = async <Value>(
  path: string,
  read: (selected: string) => Promise<DecodedJsonInput<Value>>,
  signal?: AbortSignal,
  operation = "read_evidence_file",
): Promise<Result<Value, JsonFileReadFailure>> => {
  const requestedPath = absoluteCallerPath(path);
  try {
    return decodedJsonFileResult(await read(requestedPath), requestedPath);
  } catch (cause: unknown) {
    // Caller reasons are opaque, including instances of lifecycle failure types.
    if (signal?.aborted === true && cause === signal.reason)
      return err(new AnalysisCancelledError(operation, { cause }));
    if (cause instanceof RegularFileCleanupFailure)
      return err(
        jsonFileCleanupError(
          cause as RegularFileCleanupFailure<DecodedJsonInput<Value>>,
          requestedPath,
          operation,
          signal,
        ),
      );
    if (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined) {
      const primary =
        cause.reason === "cancelled"
          ? new AnalysisCancelledError(operation, {
              cause:
                cause.cancellation === undefined
                  ? cause.cause
                  : cause.cancellation.reason,
              partialObservation: cause.partialObservation,
            })
          : undefined;
      const error = new EvidenceFileError("read", "io", {
        cause,
        path: requestedPath,
        cleanup: cause.cleanup,
        partialObservation: cause.partialObservation,
        cleanupPrimary: primary,
        ...(primary === undefined
          ? {}
          : { diagnostics: { primary_error: projectAnalysisError(primary) } }),
      });
      bindRegularFileCleanup(cause, error);
      return err(error);
    }
    return err(jsonFileReadFailure(cause, requestedPath, operation, signal));
  }
};

/** Parsing owns its typed refusal even when final descriptor cleanup fails. */
const decodedJsonFileResult = <Value>(
  decoded: DecodedJsonInput<Value>,
  path: string,
): Result<Value, JsonFileReadFailure> => {
  if (decoded.ok) return decoded;
  if (decoded.error instanceof AnalysisResourceConstraintError)
    return err(decoded.error);
  return err(
    new EvidenceFileError("read", "invalid-json", {
      cause:
        decoded.error.cause ??
        new SyntaxError(
          decoded.error.issues[0]?.message ?? decoded.error.message,
        ),
      path,
      ...(decoded.error.userMessage === undefined
        ? {}
        : { userMessage: decoded.error.userMessage }),
      contentIssues: decoded.error.issues,
    }),
  );
};

const jsonFileReadFailure = (
  cause: unknown,
  path: string,
  operation: string,
  signal?: AbortSignal,
): JsonFileReadFailure => {
  if (cause instanceof AnalysisResourceConstraintError) return cause;
  if (cause instanceof JsonInputCancellationFailure)
    return new AnalysisCancelledError(operation, { cause: cause.reason });
  if (cause instanceof JsonInputPhysicalReadFailure)
    return new EvidenceFileError("read", "io", {
      cause: cause.physicalCause,
      path,
    });
  if (isJsonReadCancellation(cause, signal))
    return new AnalysisCancelledError(operation, { cause: signal?.reason });
  return new EvidenceFileError(
    "read",
    cause instanceof NonRegularFileReadError
      ? "not-file"
      : fileAccessFailureReason(cause),
    { cause, path },
  );
};

/** Translate the physical outcome once, binding the resulting Result to its owner. */
const jsonFileCleanupError = <Value>(
  failure: RegularFileCleanupFailure<DecodedJsonInput<Value>>,
  path: string,
  operation: string,
  signal?: AbortSignal,
): EvidenceFileError => {
  const cleanup = new EvidenceFileError("read", "io", {
    cause: failure,
    path,
    cleanup: {
      reason:
        failure.cleanupCause instanceof Error
          ? failure.cleanupCause.message
          : String(failure.cleanupCause),
      resources: [failure.path],
    },
  });
  bindRegularFileCleanup(failure, cleanup);
  const cancellation = regularFileCancellation(failure);
  let primary: AnalysisError | undefined;
  if (failure.outcome.kind === "failed") {
    primary =
      cancellation === undefined
        ? jsonFileReadFailure(failure.outcome.cause, path, operation, signal)
        : new AnalysisCancelledError(operation, { cause: cancellation.reason });
  } else {
    const decoded = decodedJsonFileResult(failure.outcome.value, path);
    if (!decoded.ok) primary = decoded.error;
    else if (cancellation !== undefined)
      primary = new AnalysisCancelledError(operation, {
        cause: cancellation.reason,
      });
  }
  if (primary === undefined) return cleanup;
  return new EvidenceFileError("read", "io", {
    path,
    cause: new AggregateError(
      [primary, cleanup],
      "JSON read and cleanup failures",
      { cause: primary },
    ),
    cleanupPrimary: primary,
    cleanup: cleanup.cleanup,
    diagnostics: { primary_error: projectAnalysisError(primary) },
  }).bindCleanupDependencies([primary, cleanup]);
};

const isJsonReadCancellation = (
  cause: unknown,
  signal?: AbortSignal,
): boolean => {
  if (signal?.aborted !== true) return false;
  if (cause === signal.reason) return true;
  return (
    cause instanceof Error &&
    cause.name === "AbortError" &&
    "code" in cause &&
    cause.code === "ABORT_ERR" &&
    cause.cause === signal.reason
  );
};

/** Atomically write text to the caller-supplied path. */
export const writeTextFile = async (
  encoded: string,
  path: string,
  overwrite: boolean,
  resources: ArtifactResourceScope,
): Promise<TextWriteResult<EvidenceFileError>> =>
  writeTextParts([encoded], path, overwrite, resources);

/** Publish streamed text atomically unless cancellation wins before publication. */
export function writeTextParts(
  parts: Iterable<string>,
  path: string,
  overwrite: boolean,
  resources: ArtifactResourceScope,
): Promise<TextWriteResult<EvidenceFileError>>;
export function writeTextParts(
  parts: Iterable<string>,
  path: string,
  overwrite: boolean,
  resources: ArtifactResourceScope,
  cancellation: TextWriteCancellation | undefined,
): Promise<TextWriteResult>;
export function writeTextParts(
  parts: Iterable<string>,
  path: string,
  overwrite: boolean,
  resources: ArtifactResourceScope,
  cancellation?: TextWriteCancellation,
): Promise<TextWriteResult> {
  return resources
    .run(() =>
      writeTextPartsOwned(parts, path, overwrite, resources, cancellation),
    )
    .catch((cause: unknown) => {
      const cleanup =
        cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined
          ? cause.cleanup
          : undefined;
      const error = new EvidenceFileError("write", "io", {
        cause,
        path: absoluteCallerPath(path),
        ...(cleanup === undefined ? {} : { cleanup }),
      });
      // A failed admission retry names its exact retained leases.
      bindArtifactFileCleanup(cause, error);
      return err(error);
    });
}

const writeTextPartsOwned = async (
  parts: Iterable<string>,
  path: string,
  overwrite: boolean,
  resources: ArtifactResourceScope,
  cancellation?: TextWriteCancellation,
): Promise<TextWriteResult> => {
  const requestedPath = absoluteCallerPath(path);
  try {
    assertWriteActive(cancellation);
    if (process.platform !== "win32" && requestedPath.endsWith("/"))
      return err(
        new EvidenceFileError("write", "not-file", { path: requestedPath }),
      );
    const selectedParent = dirname(requestedPath);
    // Native lookup must accept the parent before realpath can collapse it.
    // On macOS realpath(file/..) succeeds even though that traversal is ENOTDIR.
    if (!(await stat(selectedParent)).isDirectory())
      return err(
        new EvidenceFileError("write", "missing", { path: requestedPath }),
      );
    const canonicalParent = await realpath(selectedParent);
    const destination = resolve(canonicalParent, basename(requestedPath));
    const existing = await lstat(destination).catch((cause: unknown) => {
      if (fileErrorCode(cause) === "ENOENT") return undefined;
      throw cause;
    });
    if (existing !== undefined) {
      if (!existing.isFile() || existing.isSymbolicLink())
        return err(
          new EvidenceFileError("write", "not-file", { path: requestedPath }),
        );
      if (!overwrite)
        return err(
          new EvidenceFileError("write", "exists", { path: requestedPath }),
        );
    }
    assertWriteActive(cancellation);
    const bytes = await publishFile(
      destination,
      parts,
      overwrite,
      resources,
      cancellation,
    );
    return ok({ path: requestedPath, bytes });
  } catch (cause: unknown) {
    if (cause instanceof StagedOutputCleanupFailure) {
      const cleanup = {
        reason: failureMessage(cause.cleanupCause),
        resources: [cause.owner.directory],
      };
      if (cause.outcome.ok)
        return stagedCleanupFailure(
          new EvidenceFileError("write", "io", {
            cause,
            path: requestedPath,
            cleanup,
            published: { ...cause.outcome.value, path: requestedPath },
            ...stagedOutputDiagnostics(cause.cleanupCause),
          }),
          cause.lease,
        );
      if (cause.outcome.error instanceof AnalysisCancelledError)
        return stagedCleanupFailure(
          new AnalysisCancelledError(cause.outcome.error.operation, {
            cause: cause.outcome.error.cause,
            cleanupPrimary: cause.outcome.error,
            cleanup,
          }),
          cause.lease,
        );
      const failure = classifyWriteFailure(cause.outcome.error);
      return stagedCleanupFailure(
        new EvidenceFileError("write", failure.reason, {
          cause,
          path: requestedPath,
          cleanup,
          ...(failure.systemCode === undefined
            ? {}
            : { systemCode: failure.systemCode }),
          ...stagedOutputDiagnostics(
            !cause.outcome.ok &&
              cause.outcome.error instanceof StagedOutputError
              ? cause.outcome.error
              : cause.cleanupCause,
          ),
        }),
        cause.lease,
      );
    }
    if (
      cancellation?.signal.aborted === true &&
      cause instanceof AnalysisCancelledError &&
      cause.operation === cancellation.operation
    )
      return err(cause);
    if (!overwrite && fileErrorCode(cause) === "EEXIST")
      return err(
        new EvidenceFileError("write", "exists", {
          cause,
          path: requestedPath,
        }),
      );
    const failure = classifyWriteFailure(cause);
    return err(
      new EvidenceFileError("write", failure.reason, {
        cause,
        path: requestedPath,
        ...(failure.systemCode === undefined
          ? {}
          : { systemCode: failure.systemCode }),
        ...stagedOutputDiagnostics(cause),
      }),
    );
  }
};

/** Recognize only host codes that establish a publication resource refusal. */
const classifyWriteFailure = (
  cause: unknown,
): {
  readonly reason: EvidenceFileError["reason"];
  readonly systemCode?: "EFBIG" | "ENOSPC" | "EDQUOT";
} => {
  const code = fileErrorCode(cause);
  return code === "EFBIG" || code === "ENOSPC" || code === "EDQUOT"
    ? { reason: "storage-limit", systemCode: code }
    : { reason: fileAccessFailureReason(cause) };
};

/** The retained staging lease clears this error only when a retry confirms release. */
const stagedCleanupFailure = <
  Failure extends EvidenceFileError | AnalysisCancelledError,
>(
  error: Failure,
  lease: AnalysisCleanupLease,
): Result<never, Failure> => {
  new AnalysisCleanupLeaseGroup(error, [lease]);
  return err(error);
};

/** A missing path or parent is a selection error, not a permission failure. */
const fileAccessFailureReason = (
  cause: unknown,
): "missing" | "io" | "path-limit" | "symlink-traversal" => {
  const code = fileErrorCode(cause);
  if (code === "ENAMETOOLONG") return "path-limit";
  if (code === "ELOOP") return "symlink-traversal";
  return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "io";
};

const publishFile = async (
  destination: string,
  parts: Iterable<string>,
  overwrite: boolean,
  resources: ArtifactResourceScope,
  cancellation?: TextWriteCancellation,
): Promise<number> => {
  const { owner, staged, file } = await acquireStagedFile(
    dirname(destination),
    resources,
    cancellation,
  );
  let outcome: Result<PublishedEvidenceFile, unknown>;
  try {
    let written: Result<number, unknown>;
    try {
      const bytes = await writeStagedParts(file, parts, cancellation);
      assertWriteActive(cancellation);
      await file.sync();
      written = ok(bytes);
    } catch (cause: unknown) {
      written = err(cause);
    }
    try {
      await owner.closeFile();
    } catch (cause: unknown) {
      if (written.ok) written = err(cause);
    }
    if (!written.ok) throw written.error;
    // Once submitted, atomic publication can win a later cancellation race.
    assertWriteActive(cancellation);
    await owner.assertReadyForPublication(staged);
    assertWriteActive(cancellation);
    if (overwrite) {
      await rename(staged, destination);
      owner.recordPublishedRename();
    }
    // A hard link publishes complete bytes atomically and cannot replace an existing name.
    else await link(staged, destination);
    outcome = ok({ path: destination, bytes: written.value });
  } catch (cause: unknown) {
    outcome = err(cause);
  }

  // One cleanup phase owns both the open descriptor (if any) and its staging directory.
  const released = await resources.release({
    kind: "staged-output",
    resource: owner.directory,
    output: owner,
  });
  if (released.kind === "failed")
    throw new StagedOutputCleanupFailure(
      outcome,
      released.cause,
      owner,
      released.lease,
    );
  if (!outcome.ok) throw outcome.error;
  return outcome.value.bytes;
};

/** Keep staging on the destination filesystem without imposing a shorter path ceiling. */
const acquireStagedFile = async (
  destinationParent: string,
  resources: ArtifactResourceScope,
  cancellation?: TextWriteCancellation,
): Promise<{
  readonly owner: OwnedStagedOutput;
  readonly staged: string;
  readonly file: FileHandle;
}> => {
  const destinationDevice = (await lstat(destinationParent)).dev;
  let parent = destinationParent;
  for (;;) {
    assertWriteActive(cancellation);
    let failure: unknown;
    let directory: string | undefined;
    try {
      directory = await mkdtemp(resolve(parent, ".rea-write-"));
    } catch (cause: unknown) {
      if (fileErrorCode(cause) !== "ENAMETOOLONG") throw cause;
      failure = cause;
    }
    if (directory !== undefined) {
      const owner = await OwnedStagedOutput.create(directory);
      const staged = resolve(directory, "content");
      try {
        const file = await open(staged, "wx", 0o600);
        owner.setFile(new OwnedFileHandle(file));
        return { owner, staged, file };
      } catch (cause: unknown) {
        const released = await resources.release({
          kind: "staged-output",
          resource: owner.directory,
          output: owner,
        });
        if (released.kind === "failed")
          throw new StagedOutputCleanupFailure(
            err(cause),
            released.cause,
            owner,
            released.lease,
          );
        if (fileErrorCode(cause) !== "ENAMETOOLONG") throw cause;
        failure = cause;
      }
    }
    const ancestor = dirname(parent);
    if (ancestor === parent) throw failure;
    const metadata = await lstat(ancestor);
    if (metadata.dev !== destinationDevice) throw failure;
    parent = ancestor;
  }
};

class StagedOutputCleanupFailure extends Error {
  constructor(
    readonly outcome: Result<PublishedEvidenceFile, unknown>,
    readonly cleanupCause: unknown,
    readonly owner: OwnedStagedOutput,
    readonly lease: AnalysisCleanupLease,
  ) {
    super("Staged output cleanup failed", {
      cause: outcome.ok ? cleanupCause : outcome.error,
    });
  }
}

const stagedOutputDiagnostics = (
  cause: unknown,
): {
  readonly diagnostics?: Readonly<Record<string, string | number>>;
} => {
  if (!(cause instanceof StagedOutputError)) return {};
  return { diagnostics: { code: cause.code, ...cause.detail } };
};

const failureMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message || cause.name : String(cause);

const writeStagedParts = async (
  file: FileHandle,
  parts: Iterable<string>,
  cancellation?: TextWriteCancellation,
): Promise<number> => {
  assertWriteActive(cancellation);
  const iterator = parts[Symbol.iterator]();
  let exhausted = false;
  let bytes = 0;
  try {
    for (;;) {
      assertWriteActive(cancellation);
      const part = iterator.next();
      if (part.done) exhausted = true;
      assertWriteActive(cancellation);
      if (part.done) return bytes;
      await file.writeFile(part.value, { encoding: "utf8" });
      bytes += Buffer.byteLength(part.value, "utf8");
    }
  } finally {
    if (!exhausted) iterator.return?.();
  }
};

const assertWriteActive = (cancellation?: TextWriteCancellation): void => {
  if (cancellation?.signal.aborted === true)
    throw new AnalysisCancelledError(cancellation.operation, {
      cause: cancellation.signal.reason,
    });
};

const fileErrorCode = (cause: unknown): unknown =>
  typeof cause === "object" && cause !== null && "code" in cause
    ? cause.code
    : undefined;
