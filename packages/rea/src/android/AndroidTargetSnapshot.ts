import { createHash } from "node:crypto";
import type { ReadStream, Stats, WriteStream } from "node:fs";
import { chmod, open, rm, stat, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  AnalysisInputError,
  AnalysisCapabilityUnavailableError,
} from "../domain/analysisErrorCore.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import {
  RegularFileCleanupFailure,
  withOwnedFileHandle,
} from "../filesystem/OwnedRegularFile.js";
import {
  openRegularFile,
  RegularFileAdmissionFailure,
  assertRegularFileActive,
  sameRegularFileState,
  type StableRegularFileDescriptor,
} from "../filesystem/RegularFile.js";
import type { AndroidOperation } from "../domain/android/androidAnalysis.js";

/** Completed snapshot bytes retained when descriptor close fails after the copy. */
export interface AndroidSnapshotCopy {
  readonly kind: "android-snapshot-copy";
  readonly sha256: string;
  readonly sourcePath: string;
  readonly snapshotPath: string;
  readonly bytes: number;
}

/** Recognize the copy record carried by a rejected snapshot close. */
export const androidSnapshotCopy = (
  value: unknown,
): AndroidSnapshotCopy | undefined =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  value.kind === "android-snapshot-copy" &&
  "sha256" in value &&
  typeof value.sha256 === "string" &&
  "sourcePath" in value &&
  typeof value.sourcePath === "string" &&
  "snapshotPath" in value &&
  typeof value.snapshotPath === "string" &&
  "bytes" in value &&
  typeof value.bytes === "number"
    ? {
        kind: "android-snapshot-copy",
        sha256: value.sha256,
        sourcePath: value.sourcePath,
        snapshotPath: value.snapshotPath,
        bytes: value.bytes,
      }
    : undefined;

/** Adopt a snapshot descriptor whose close rejected, keyed by its exact path. */
export type AndroidSnapshotCloseRetention = (
  path: string,
  owner: OwnedFileHandle,
) => void;

/** Bind decompiler input to the admitted artifact, even if the original changes. */
export const snapshotAndroidTarget = async (
  path: string,
  sha256: string,
  root: string,
  operation: AndroidOperation,
  signal?: AbortSignal,
  retainFailedClose?: AndroidSnapshotCloseRetention,
): Promise<string> => {
  const snapshot = join(root, "target.apk");
  try {
    await copyAndroidSnapshot(
      path,
      snapshot,
      sha256,
      signal,
      retainFailedClose,
    );
    assertRegularFileActive(signal);
    await chmod(snapshot, 0o400);
    return snapshot;
  } catch (cause: unknown) {
    throw projectSnapshotFailure(
      cause,
      (changed) =>
        new AnalysisInputError(operation, { cause: changed }, [
          {
            path: ["path"],
            reason: "invalid_value",
            message: `APK bytes changed after admission at ${path}; retry against a stable file.`,
          },
        ]),
    );
  }
};

/** Fingerprint the actual immutable engine bytes executed for this observation. */
export const snapshotAndroidEngine = async (
  source: string,
  sha256: string,
  root: string,
  operation: AndroidOperation,
  signal?: AbortSignal,
  retainFailedClose?: AndroidSnapshotCloseRetention,
): Promise<{ path: string; sha256: string }> => {
  const path = join(root, "engine.jar");
  try {
    const observed = await copyAndroidSnapshot(
      source,
      path,
      sha256,
      signal,
      retainFailedClose,
    );
    assertRegularFileActive(signal);
    await chmod(path, 0o400);
    return { path, sha256: observed.sha256 };
  } catch (cause: unknown) {
    throw projectSnapshotFailure(
      cause,
      (changed) =>
        new AnalysisCapabilityUnavailableError(
          "jadx",
          operation,
          `REA_JADX_MCP_JAR bytes changed during admission at ${source}; retry with a stable engine file.`,
          { cause: changed },
        ),
    );
  }
};

/**
 * Streams close their FileHandle on destroy. Route that close through the
 * owner so a stream shutdown and the explicit close confirm the same attempt.
 */
const adoptSnapshotHandle = (
  handle: FileHandle,
): { readonly handle: FileHandle; readonly owner: OwnedFileHandle } => {
  const close = handle.close.bind(handle);
  const owner = new OwnedFileHandle({
    get fd() {
      return handle.fd;
    },
    close,
  });
  handle.close = () => owner.close();
  // Callers read through `handle`. The owner only needs fd and close, which
  // is the whole contract withOwnedFileHandle and provider retry use.
  return { handle, owner: owner as OwnedFileHandle };
};

const copyAndroidSnapshot = async (
  sourcePath: string,
  snapshotPath: string,
  expectedSha256: string,
  signal: AbortSignal | undefined,
  retainFailedClose: AndroidSnapshotCloseRetention | undefined,
): Promise<AndroidSnapshotCopy> => {
  assertRegularFileActive(signal);
  let removeSnapshot = false;
  const retain = (path: string) =>
    retainFailedClose === undefined
      ? {}
      : {
          retainFailedClose: (owner: OwnedFileHandle) =>
            retainFailedClose(path, owner),
        };
  try {
    // Close each descriptor through its owner. A rejected close keeps the
    // copy outcome and stays retained until that owner is retried; the
    // partial file is removed only after those close attempts.
    const { handle, initial } = await openSnapshotSource(
      sourcePath,
      signal,
      retain(sourcePath),
    );
    const source = adoptSnapshotHandle(handle);
    return await withOwnedFileHandle(
      sourcePath,
      source.owner,
      {
        ...(signal === undefined ? {} : { signal }),
        ...retain(sourcePath),
      },
      async () => {
        assertRegularFileActive(signal);
        let copiedBytes = 0;
        const hash = createHash("sha256");
        const digest = new Transform({
          transform(
            chunk: Buffer,
            _encoding: BufferEncoding,
            callback: TransformCallback,
          ) {
            copiedBytes += chunk.length;
            if (copiedBytes > initial.size) {
              callback(
                new AndroidSnapshotChangedError(
                  `Android input grew while being copied: ${sourcePath}`,
                ),
              );
              return;
            }
            hash.update(chunk);
            callback(null, chunk);
          },
        });
        assertRegularFileActive(signal);
        const destination = adoptSnapshotHandle(
          await open(snapshotPath, "wx", 0o600),
        );
        let copyCompleted = false;
        try {
          return await withOwnedFileHandle(
            snapshotPath,
            destination.owner,
            {
              ...(signal === undefined ? {} : { signal }),
              ...retain(snapshotPath),
            },
            async () => {
              let inputStream: ReadStream | undefined;
              let outputStream: WriteStream | undefined;
              try {
                assertRegularFileActive(signal);
                inputStream = source.handle.createReadStream({
                  start: 0,
                  end: initial.size,
                  autoClose: false,
                });
                outputStream = destination.handle.createWriteStream({
                  autoClose: false,
                });
                await pipeline(inputStream, digest, outputStream, { signal });
                assertRegularFileActive(signal);
                await verifySourceState(
                  source.handle,
                  sourcePath,
                  initial,
                  copiedBytes,
                );
                const observedSha256 = hash.digest("hex");
                if (observedSha256 !== expectedSha256)
                  throw new AndroidSnapshotChangedError(
                    `Android snapshot digest mismatch for ${sourcePath}`,
                  );
                copyCompleted = true;
                return {
                  kind: "android-snapshot-copy" as const,
                  sha256: observedSha256,
                  sourcePath,
                  snapshotPath,
                  bytes: copiedBytes,
                };
              } finally {
                // Destroy drops the stream's FileHandle reference and closes
                // through the owner installed above. A later owner close joins
                // that attempt. The stream may surface the same close error.
                for (const stream of [inputStream, outputStream]) {
                  stream?.on("error", () => undefined);
                  stream?.destroy();
                }
              }
            },
          );
        } finally {
          if (!copyCompleted) removeSnapshot = true;
        }
      },
    );
  } finally {
    if (removeSnapshot)
      await rm(snapshotPath, { force: true }).catch(() => undefined);
  }
};

/**
 * Admission can reject after the descriptor opens. Keep that owner when its
 * own close also rejects; the success path still adopts one close owner.
 */
const openSnapshotSource = async (
  path: string,
  signal: AbortSignal | undefined,
  retention: {
    readonly retainFailedClose?: (owner: OwnedFileHandle) => void;
  },
): Promise<StableRegularFileDescriptor> => {
  try {
    return await openRegularFile(path, { symlinks: "follow", signal });
  } catch (cause: unknown) {
    if (!(cause instanceof RegularFileAdmissionFailure)) throw cause;
    throw new RegularFileCleanupFailure({
      path,
      owner: cause.owner,
      outcome: { kind: "failed", cause: cause.cause },
      cleanupCause: cause.cleanupCause,
      retention: retainAdmissionOwner(retention.retainFailedClose, cause.owner),
    });
  }
};

const retainAdmissionOwner = (
  retain: ((owner: OwnedFileHandle) => void) | undefined,
  owner: OwnedFileHandle,
): RegularFileCleanupFailure["retention"] => {
  if (retain === undefined) return { kind: "not_requested" };
  try {
    retain(owner);
    return { kind: "callback_returned" };
  } catch (cause: unknown) {
    return { kind: "callback_threw", cause };
  }
};

/** Keep a stable-file diagnosis when descriptor cleanup fails around it. */
const projectSnapshotFailure = (
  cause: unknown,
  projectChanged: (changed: AndroidSnapshotChangedError) => AnalysisError,
): unknown => {
  if (cause instanceof AndroidSnapshotChangedError)
    return projectChanged(cause);
  if (
    !(cause instanceof RegularFileCleanupFailure) ||
    cause.outcome.kind !== "failed"
  )
    return cause;
  const projected = projectSnapshotFailure(cause.outcome.cause, projectChanged);
  if (projected === cause.outcome.cause) return cause;
  return new RegularFileCleanupFailure({
    ...cause,
    outcome: { kind: "failed", cause: projected },
  });
};

const verifySourceState = async (
  handle: FileHandle,
  path: string,
  initial: Stats,
  observedBytes: number,
): Promise<void> => {
  const [opened, currentPath] = await Promise.all([handle.stat(), stat(path)]);
  if (
    observedBytes !== initial.size ||
    !sameRegularFileState(initial, opened) ||
    !sameRegularFileState(initial, currentPath)
  )
    throw new AndroidSnapshotChangedError(
      `Android input changed while being read: ${path}`,
    );
};

class AndroidSnapshotChangedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
