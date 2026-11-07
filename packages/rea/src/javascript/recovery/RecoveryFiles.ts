import {
  artifactFileCancellationCause,
  ArtifactFileCancelled,
  ArtifactFileCleanupFailure,
  withArtifactRegularFile,
} from "../../artifacts/ArtifactFileOperation.js";
import { fileSnapshotPartialObservationSchema } from "../../domain/fileSnapshotObservation.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { OwnedDirectoryHandle } from "../../filesystem/OwnedDirectoryHandle.js";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  opendir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { TextDecoder } from "node:util";
import { normalizeArtifactPath } from "../../artifacts/ArtifactPaths.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
  AnalysisTimeoutError,
} from "../../domain/analysisErrorCore.js";
import {
  NonRegularFileReadError,
  sameRegularFileState,
} from "../../filesystem/RegularFile.js";
import { RECOVERY_LIMITS, wakaruFixedLimitRecovery } from "./WakaruRelease.js";

const OPERATION = "recover_javascript_sources";

/** Fingerprint exact selected or derived bytes. */
export const recoveryDigest = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** A file exceeded the byte bound its caller selected; the caller owns what that bound means. */
class RecoveryFileSizeError extends AnalysisOutputError {
  constructor(
    reason: string,
    readonly maximum: number,
  ) {
    super(OPERATION, reason);
  }
}

/** A bounded read stopped because the regular file exceeded the caller's maximum. */
export const isRecoveryFileSizeError = (
  cause: unknown,
  maximum?: number,
): boolean =>
  cause instanceof RecoveryFileSizeError &&
  (maximum === undefined || cause.maximum === maximum);

/** Read a stable regular file without retaining bytes during engine fingerprinting. */
const scanRecoveryFile = async (
  path: string,
  maximum: number,
  consume: (chunk: Buffer) => void,
  signal?: AbortSignal,
  resources?: ArtifactResourceScope,
) => {
  try {
    return await withArtifactRegularFile(
      path,
      resources ?? new ArtifactResourceScope(),
      signal,
      async ({ handle, initial: before }) => {
        const hash = createHash("sha256");
        if (before.size > maximum)
          throw new RecoveryFileSizeError(
            `Expected a regular file no larger than ${String(maximum)} bytes: ${path}`,
            maximum,
          );
        let bytes = 0;
        for await (const raw of handle.createReadStream({ autoClose: false })) {
          checkRecoveryCancellation(signal);
          const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          bytes += chunk.length;
          if (bytes > maximum)
            throw new RecoveryFileSizeError(
              `File exceeds ${String(maximum)} bytes: ${path}`,
              maximum,
            );
          hash.update(chunk);
          consume(chunk);
        }
        const after = await handle.stat();
        const current = await lstat(path);
        if (
          before.size !== bytes ||
          [after, current].some((state) => !sameRegularFileState(before, state))
        )
          throw new AnalysisArtifactChangedError(
            OPERATION,
            path,
            `File identity changed while reading: ${path}`,
          );
        return { sha256: hash.digest("hex"), bytes };
      },
    );
  } catch (cause: unknown) {
    if (cause instanceof ArtifactFileCleanupFailure) throw cause;
    if (cause instanceof ArtifactFileCancelled)
      throw new AnalysisCancelledError(OPERATION, {
        cause: cause.fileCancellation.reason,
        partialObservation: fileSnapshotPartialObservationSchema.parse(
          Object.assign({}, cause.fileCancellation.outcome.value, {
            kind: "file-snapshot-hash",
            path,
          }),
        ),
      });
    if (cause instanceof ArtifactReaderFailure && cause.reason === "cancelled")
      throw new AnalysisCancelledError(OPERATION, {
        cause: artifactFileCancellationCause(cause),
      });
    if (
      cause instanceof Error &&
      "code" in cause &&
      (cause.code === "EACCES" || cause.code === "EPERM")
    )
      throw new AnalysisAccessDeniedError(OPERATION, path, cause.code, {
        cause,
      });
    if (cause instanceof NonRegularFileReadError)
      throw new AnalysisOutputError(
        OPERATION,
        `Expected a regular file no larger than ${String(maximum)} bytes: ${path}`,
      );
    throw cause;
  }
};

/** Fingerprint a regular file incrementally with bounded memory. */
export const fingerprintRecoveryFile = async (
  path: string,
  maximum: number,
  signal?: AbortSignal,
  resources?: ArtifactResourceScope,
) => scanRecoveryFile(path, maximum, () => {}, signal, resources);

/** Read only a regular file through one handle with a bounded, stable identity. */
export const readRecoveryFile = async (
  path: string,
  maximum: number,
  signal?: AbortSignal,
  resources?: ArtifactResourceScope,
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  const result = await scanRecoveryFile(
    path,
    maximum,
    (chunk) => chunks.push(chunk),
    signal,
    resources,
  );
  return Buffer.concat(chunks, result.bytes);
};

export type RecoveryInputSnapshot = {
  path: string;
  snapshot_path: string;
  relative_path: string;
  sha256: string;
  bytes: number;
};

/** Snapshot one script within the remaining operation-wide input budget. */
const snapshotRecoveryInput = async (
  path: string,
  snapshotPath: string,
  relativePath: string,
  maximum: number,
  signal?: AbortSignal,
  resources?: ArtifactResourceScope,
): Promise<RecoveryInputSnapshot> => {
  let bytes: Buffer;
  try {
    bytes = await readRecoveryFile(path, maximum, signal, resources);
  } catch (cause: unknown) {
    if (
      cause instanceof AnalysisCancelledError ||
      cause instanceof AnalysisAccessDeniedError ||
      cause instanceof AnalysisArtifactChangedError ||
      cause instanceof ArtifactFileCleanupFailure
    )
      throw cause;
    // The operation-wide input allowance is a deterministic byte budget, not
    // a malformed argument; the same selection fails again unchanged.
    if (cause instanceof RecoveryFileSizeError)
      throw new AnalysisResourceConstraintError(
        OPERATION,
        "file-size",
        `Selected JavaScript input ${path} exceeds the ${String(cause.maximum)} bytes remaining of the ${String(RECOVERY_LIMITS.inputBytes)}-byte total input allowance`,
        {
          maximum_input_bytes: RECOVERY_LIMITS.inputBytes,
          remaining_input_bytes: cause.maximum,
        },
        {
          cause,
          retryable: false,
          remediationAction: `Select JavaScript inputs whose combined size is within the ${String(RECOVERY_LIMITS.inputBytes)}-byte total input allowance (maximum_input_bytes). This release has no runtime override. Raising max_heap_mb does not raise it. Do not truncate required source; retrying the unchanged selection will fail again.`,
        },
      );
    throw recoveryInputFailure(
      "path",
      `Cannot snapshot UTF-8 JavaScript input ${path}: ${recoveryFailureMessage(cause)}`,
      cause,
    );
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause: unknown) {
    throw new AnalysisInputError(OPERATION, { cause }, [
      {
        path: ["path"],
        reason: "invalid_format",
        expected: "UTF-8",
        message: `JavaScript input is not valid UTF-8: ${path}`,
      },
    ]);
  }
  try {
    await mkdir(dirname(snapshotPath), { recursive: true, mode: 0o700 });
    await writeFile(snapshotPath, bytes, { flag: "wx", mode: 0o600 });
  } catch (cause: unknown) {
    // The snapshot directory starts empty, so a collision means another
    // selected input already took this name: the same file under another
    // spelling, or a name that differs only in a way this filesystem ignores.
    if (
      cause instanceof Error &&
      "code" in cause &&
      (cause.code === "EEXIST" || cause.code === "ENOTDIR")
    )
      throw recoveryInputFailure(
        "additional_paths",
        `Selected input ${path} collides with another selected input at ${relativePath} on this filesystem. Select each file once.`,
        cause,
      );
    throw cause;
  }
  return {
    path,
    snapshot_path: snapshotPath,
    relative_path: relativePath,
    sha256: recoveryDigest(bytes),
    bytes: bytes.length,
  };
};

/** Resolve native parent traversal while keeping the selected final filename. */
const recoveryInputLayoutPath = async (
  path: string,
  signal?: AbortSignal,
): Promise<string> => {
  if (!isAbsolute(path))
    throw recoveryInputFailure(
      "path",
      "Select an absolute JavaScript file path",
    );
  try {
    checkRecoveryCancellation(signal);
    const parent = dirname(path);
    // Native lookup must accept the parent before realpath can collapse it:
    // Darwin realpath(file/..) otherwise succeeds despite ENOTDIR on reads.
    if (!(await stat(parent)).isDirectory())
      throw new NonRegularFileReadError(path, false);
    const canonicalParent = await realpath(parent);
    checkRecoveryCancellation(signal);
    return join(canonicalParent, basename(path));
  } catch (cause: unknown) {
    if (cause instanceof AnalysisCancelledError) throw cause;
    if (
      cause instanceof Error &&
      "code" in cause &&
      (cause.code === "EACCES" || cause.code === "EPERM")
    )
      throw new AnalysisAccessDeniedError(OPERATION, path, cause.code, {
        cause,
      });
    throw recoveryInputFailure(
      "path",
      `Cannot resolve selected JavaScript input parent ${path}: ${recoveryFailureMessage(cause)}`,
      cause,
    );
  }
};

/** Own selected path interpretation, native collisions and sequential snapshots. */
export const snapshotRecoveryInputs = async (
  paths: readonly [string, ...string[]],
  directory: string,
  signal?: AbortSignal,
  resources?: ArtifactResourceScope,
): Promise<readonly [RecoveryInputSnapshot, ...RecoveryInputSnapshot[]]> => {
  const selections: [
    { readonly path: string; readonly layoutPath: string },
    ...{ readonly path: string; readonly layoutPath: string }[],
  ] = [
    {
      path: paths[0],
      layoutPath: await recoveryInputLayoutPath(paths[0], signal),
    },
  ];
  for (const path of paths.slice(1))
    selections.push({
      path,
      layoutPath: await recoveryInputLayoutPath(path, signal),
    });
  let commonDirectory = dirname(selections[0].layoutPath);
  for (const { layoutPath } of selections) {
    while (true) {
      const fromCommon = relative(commonDirectory, layoutPath);
      if (
        fromCommon !== ".." &&
        !fromCommon.startsWith(`..${sep}`) &&
        !isAbsolute(fromCommon)
      )
        break;
      const parent = dirname(commonDirectory);
      if (parent === commonDirectory)
        throw recoveryInputFailure(
          "additional_paths",
          "Selected files must share a filesystem root",
        );
      commonDirectory = parent;
    }
  }
  const snapshots: RecoveryInputSnapshot[] = [];
  let remaining = RECOVERY_LIMITS.inputBytes;
  for (const { path, layoutPath } of selections) {
    const relativePath =
      selections.length === 1
        ? "bundle.js"
        : relative(commonDirectory, layoutPath).split(sep).join("/");
    try {
      // Wakaru's multi-input public paths interpret backslashes as separators.
      if (relativePath.includes("\\"))
        throw new TypeError(
          "Wakaru cannot preserve literal backslashes in input paths",
        );
      if (normalizeArtifactPath(relativePath) !== relativePath)
        throw new TypeError(
          "Input names must already use NFC Unicode spelling",
        );
    } catch (cause: unknown) {
      throw recoveryInputFailure(
        "path",
        `Cannot preserve selected input path in published artifacts: ${path}: ${recoveryFailureMessage(cause)}`,
        cause,
      );
    }
    const snapshot = await snapshotRecoveryInput(
      path,
      join(directory, relativePath),
      relativePath,
      remaining,
      signal,
      resources,
    );
    snapshots.push(snapshot);
    remaining -= snapshot.bytes;
  }
  // The selected-input tuple guarantees a primary snapshot.
  const [primary, ...additional] = snapshots;
  if (primary === undefined)
    throw recoveryInputFailure("path", "Select a JavaScript input");
  return [primary, ...additional];
};

/** Inventory staging without following symlinks or publishing special files. */
export const inventoryRecoveryFiles = async (
  root: string,
  signal?: AbortSignal,
  resources: ArtifactResourceScope = new ArtifactResourceScope(),
): Promise<
  readonly { relativePath: string; path: string; bytes: number }[]
> => {
  const files: { relativePath: string; path: string; bytes: number }[] = [];
  let bytes = 0;
  let entries = 0;
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      throw new AnalysisOutputError(
        OPERATION,
        `Unsafe staging directory: ${directory}`,
      );
    const handle = await opendir(directory);
    const owner = new OwnedDirectoryHandle(handle);
    const children: string[] = [];
    let outcome:
      | { readonly kind: "completed" }
      | { readonly kind: "failed"; readonly cause: unknown };
    try {
      for (;;) {
        const entry = await handle.read();
        if (entry === null) break;
        checkRecoveryCancellation(signal);
        entries++;
        if (entries > RECOVERY_LIMITS.outputEntries)
          throw new AnalysisOutputError(
            OPERATION,
            "Recovery staging exceeds the 10000-entry resource limit",
            wakaruFixedLimitRecovery(
              `Recovery staging exceeds the ${String(RECOVERY_LIMITS.outputEntries)}-entry resource limit`,
            ),
          );
        children.push(entry.name);
      }
      outcome = { kind: "completed" };
    } catch (cause: unknown) {
      outcome = { kind: "failed", cause };
    }
    const cleanup = await resources.release({
      kind: "directory-handle",
      handle: owner,
      resource: directory,
    });
    if (cleanup.kind === "failed") {
      const failure = resources.cleanupFailure(outcome, [cleanup]);
      if (outcome.kind === "completed" && signal?.aborted === true)
        throw new ArtifactReaderFailure(
          "cancelled",
          "Recovery inventory cancelled during directory close",
          {
            cause: failure,
            cancellation: { reason: signal.reason },
            cleanup: failure.cleanup,
            cleanupLeases: failure.cleanupLeases,
          },
        );
      throw failure;
    }
    if (outcome.kind === "failed") throw outcome.cause;
    checkRecoveryCancellation(signal);
    for (const name of children) {
      checkRecoveryCancellation(signal);
      const relativePath = prefix === "" ? name : `${prefix}/${name}`;
      const path = join(directory, name);
      const info = await lstat(path);
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
        throw new AnalysisOutputError(
          OPERATION,
          `Recovery produced a symlink or special file: ${relativePath}`,
        );
      if (info.isDirectory()) await visit(path, relativePath);
      else {
        bytes += info.size;
        if (bytes > RECOVERY_LIMITS.outputBytes)
          throw new AnalysisOutputError(
            OPERATION,
            "Recovery staging exceeds the 128 MiB resource limit",
            wakaruFixedLimitRecovery(
              `Recovery staging exceeds the ${String(RECOVERY_LIMITS.outputBytes)}-byte output allowance`,
            ),
          );
        files.push({ relativePath, path, bytes: info.size });
      }
    }
  };
  await visit(root, "");
  return files;
};

/** Preserve actionable caller constraints in the ordinary error algebra. */
export const recoveryInputFailure = (
  field: string,
  message: string,
  cause?: unknown,
): AnalysisInputError =>
  new AnalysisInputError(OPERATION, { cause }, [
    { path: [field], reason: "invalid_value", message },
  ]);

/** Convert one caught boundary cause into diagnostic text without masking its type. */
export const recoveryFailureMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** Cancellation remains distinct from malformed source or provider output. */
export const checkRecoveryCancellation = (signal?: AbortSignal): void => {
  if (signal?.aborted === true)
    throw new AnalysisCancelledError(OPERATION, { cause: signal.reason });
};

/** Keep both tool invocations within one operation's execution budget. */
export const checkRecoveryDeadline = (
  deadline: number,
  signal?: AbortSignal,
): void => {
  checkRecoveryCancellation(signal);
  if (performance.now() >= deadline)
    throw new AnalysisTimeoutError(OPERATION, RECOVERY_LIMITS.timeoutMs, {
      userMessage: `JavaScript source recovery reached its ${String(RECOVERY_LIMITS.timeoutMs)} ms Wakaru adapter deadline. This is REA's fixed per-operation deadline, not the MCP client deadline.`,
      remediationAction: `This release has no runtime override for the ${String(RECOVERY_LIMITS.timeoutMs)} ms Wakaru recovery deadline. Raising analysis_timeout_ms or max_heap_mb does not raise it. A smaller complete input may finish inside this deadline. An unchanged retry may hit this deadline again. Allow execution, cleanup and delivery headroom in the outer MCP client deadline. Confirm outstanding work and cleanup before retrying.`,
    });
};
