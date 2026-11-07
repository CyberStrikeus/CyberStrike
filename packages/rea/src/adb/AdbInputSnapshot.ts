import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import {
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  openRegularFile,
  RegularFileAdmissionFailure,
  sameRegularFileState,
} from "../filesystem/RegularFile.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import type { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";

export interface AdbInputSnapshotDependencies {
  readonly openSource?: typeof openRegularFile;
  readonly openDestination?: typeof open;
}

export interface AdbInputSnapshot {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** Snapshot failure with the handles that remain owned for a later retry. */
export class AdbInputSnapshotFailure extends Error {
  constructor(
    readonly operation: string,
    readonly sourcePath: string,
    readonly primaryCause: unknown,
    readonly cleanupResources: readonly string[],
    readonly cleanupCause: unknown,
  ) {
    super(`ADB input snapshot failed for ${sourcePath}`, {
      cause: primaryCause ?? cleanupCause,
    });
    this.name = "AdbInputSnapshotFailure";
  }
}

/** Copy one caller file into a private root, hashing the bytes adb will consume. */
export const snapshotAdbInput = async (
  sourcePath: string,
  root: Pick<PrivateRuntimeRoot, "path">,
  resources: ArtifactResourceScope,
  operation: string,
  signal?: AbortSignal,
  dependencies: AdbInputSnapshotDependencies = {},
): Promise<AdbInputSnapshot> => {
  let source: OwnedFileHandle | undefined;
  let destination: OwnedFileHandle | undefined;
  const cleanupResources: string[] = [];
  const cleanupCauses: unknown[] = [];
  let snapshot: AdbInputSnapshot | undefined;
  let primaryCause: unknown;

  try {
    const { handle, initial } = await (
      dependencies.openSource ?? openRegularFile
    )(sourcePath, {
      symlinks: "follow",
      signal,
    });
    source = new OwnedFileHandle(handle);
    const destinationPath = join(root.path, basename(sourcePath));
    destination = new OwnedFileHandle(
      await (dependencies.openDestination ?? open)(
        destinationPath,
        "wx",
        0o600,
      ),
    );
    if (!Number.isSafeInteger(initial.size) || initial.size < 0)
      throw new RangeError(
        `Regular file size cannot be represented safely: ${sourcePath}`,
      );
    const hash = createHash("sha256");
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < initial.size) {
      signal?.throwIfAborted();
      const read = await source.handle.read(
        chunk,
        0,
        Math.min(chunk.length, initial.size - position),
        position,
      );
      signal?.throwIfAborted();
      if (read.bytesRead === 0)
        throw new AnalysisArtifactChangedError(
          operation,
          sourcePath,
          "the file ended before its admitted size was copied",
        );
      const bytes = chunk.subarray(0, read.bytesRead);
      let written = 0;
      while (written < bytes.length) {
        signal?.throwIfAborted();
        const result = await destination.handle.write(
          bytes,
          written,
          bytes.length - written,
          position + written,
        );
        if (result.bytesWritten === 0)
          throw new Error("Private ADB input snapshot stopped accepting bytes");
        written += result.bytesWritten;
      }
      hash.update(bytes);
      position += read.bytesRead;
    }
    signal?.throwIfAborted();
    const [opened, named] = await Promise.all([
      source.handle.stat(),
      stat(sourcePath),
    ]);
    signal?.throwIfAborted();
    if (
      !sameRegularFileState(initial, opened) ||
      !sameRegularFileState(initial, named)
    )
      throw new AnalysisArtifactChangedError(
        operation,
        sourcePath,
        "the file changed while its private snapshot was copied",
      );
    await destination.handle.sync();
    // Keep the private snapshot non-writable while preserving executable intent
    // for adb push (which transmits the staged file's mode).
    await destination.handle.chmod(0o400 | (initial.mode & 0o111));
    snapshot = {
      path: destinationPath,
      bytes: position,
      sha256: hash.digest("hex"),
    };
  } catch (cause: unknown) {
    if (cause instanceof RegularFileAdmissionFailure) {
      source = cause.owner;
      primaryCause = cause.cause;
    } else if (cause instanceof AnalysisError) {
      primaryCause = cause;
    } else {
      primaryCause =
        signal?.aborted === true
          ? new AnalysisCancelledError(operation, { cause })
          : cause;
    }
  }

  for (const [owner, resource] of [
    [source, `${sourcePath} (ADB snapshot source handle)`],
    [
      destination,
      `${join(root.path, basename(sourcePath))} (ADB snapshot handle)`,
    ],
  ] as const) {
    if (owner === undefined) continue;
    const result = await resources.release({
      kind: "file-handle",
      resource,
      handle: owner,
    });
    if (result.kind === "failed") {
      cleanupResources.push(resource);
      cleanupCauses.push(result.cause);
    }
  }

  if (cleanupCauses.length > 0)
    throw new AdbInputSnapshotFailure(
      operation,
      sourcePath,
      primaryCause,
      cleanupResources,
      new AggregateError(cleanupCauses, "ADB snapshot handles remain open"),
    );
  if (primaryCause instanceof AnalysisError) throw primaryCause;
  if (primaryCause !== undefined)
    throw new AnalysisOutputError(
      operation,
      `The caller input could not be staged for adb: ${sourcePath}`,
      { cause: primaryCause },
    );
  if (snapshot === undefined)
    throw new Error("ADB input snapshot ended without a result");
  return snapshot;
};
