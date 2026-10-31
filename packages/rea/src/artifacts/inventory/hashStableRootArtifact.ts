import { regularFileCancellation } from "../../filesystem/OwnedRegularFile.js";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { readArtifactFileChunks } from "../readArtifactFileChunks.js";
import { OwnedFileHandle } from "../../filesystem/OwnedFileHandle.js";

import { ArtifactReaderFailure } from "../ArtifactReader.js";
import {
  assertStableRegularFileIdentity,
  RegularFileChangedError,
  NonRegularFileReadError,
  RegularFileAdmissionFailure,
  openRegularFile,
  type StableRegularFileDescriptor,
} from "../../filesystem/RegularFile.js";
import {
  abortIfNeeded,
  hashReadable,
  type HashResult,
} from "../ArtifactHash.js";
import type { ArtifactResourceScope } from "../ArtifactResourceScope.js";
import { fileSnapshotPartialObservationSchema } from "../../domain/fileSnapshotObservation.js";

/** Finalize the admitted root while preserving its completed identity and exact owner. */
export const releaseRootArtifact = async (
  path: string,
  owner: OwnedFileHandle,
  resourceScope: ArtifactResourceScope,
  outcome:
    | { readonly kind: "completed"; readonly digest: HashResult | null }
    | { readonly kind: "failed"; readonly cause: unknown },
  signal?: AbortSignal,
): Promise<void> => {
  const cleanup = await resourceScope.release({
    kind: "file-handle",
    resource: `root artifact descriptor for ${path}`,
    handle: owner,
  });
  const observation =
    outcome.kind === "completed" && outcome.digest !== null
      ? fileSnapshotPartialObservationSchema.parse({
          kind: "file-snapshot-hash",
          path,
          sha256: outcome.digest.sha256,
          bytes: outcome.digest.bytes,
        })
      : undefined;
  const finalOutcome =
    outcome.kind === "completed" && signal?.aborted
      ? {
          kind: "failed" as const,
          cause: new ArtifactReaderFailure(
            "cancelled",
            "Root artifact inventory cancelled during descriptor finalization",
            { cause: signal.reason, partialObservation: observation },
          ),
        }
      : outcome;
  if (cleanup.kind === "failed")
    throw resourceScope.cleanupFailure(finalOutcome, [cleanup], observation);
  if (finalOutcome.kind === "failed") throw finalOutcome.cause;
};

/** Admit a root descriptor without losing ownership when validation cleanup fails. */
export const openRootArtifact = async (
  path: string,
  resourceScope: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<
  StableRegularFileDescriptor & { readonly owner: OwnedFileHandle }
> => {
  try {
    const source = await openRegularFile(path, { symlinks: "reject", signal });
    return { ...source, owner: new OwnedFileHandle(source.handle) };
  } catch (cause: unknown) {
    const primary =
      cause instanceof RegularFileAdmissionFailure ? cause.cause : cause;
    const cancellation = regularFileCancellation(primary);
    const failure =
      cancellation !== undefined
        ? new ArtifactReaderFailure(
            "cancelled",
            "Artifact admission cancelled",
            { cause: cancellation.reason },
          )
        : primary instanceof NonRegularFileReadError
          ? new ArtifactReaderFailure(
              "format",
              `Artifact root is not a regular file: ${path}`,
              { cause: primary },
            )
          : primary;
    if (cause instanceof RegularFileAdmissionFailure) {
      const resource = `root artifact descriptor for ${path}`;
      const cleanup = await resourceScope.release({
        kind: "file-handle",
        resource,
        handle: cause.owner,
      });
      if (cleanup.kind === "failed")
        throw resourceScope.cleanupFailure({ kind: "failed", cause: failure }, [
          cleanup,
        ]);
    }
    throw failure;
  }
};

/** Hash one stable regular root file from the same descriptor that was checked. */
export const hashStableRootArtifact = async (
  path: string,
  resourceScope: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<HashResult> => {
  const { handle, initial, owner } = await openRootArtifact(
    path,
    resourceScope,
    signal,
  );
  let outcome:
    | { readonly kind: "completed"; readonly value: HashResult }
    | { readonly kind: "failed"; readonly cause: unknown };
  try {
    outcome = {
      kind: "completed",
      value: await hashStableRootArtifactHandle(path, handle, initial, signal),
    };
  } catch (cause: unknown) {
    outcome = { kind: "failed", cause };
  }
  await releaseRootArtifact(
    path,
    owner,
    resourceScope,
    outcome.kind === "completed"
      ? { kind: "completed", digest: outcome.value }
      : outcome,
    signal,
  );
  if (outcome.kind === "failed") throw outcome.cause;
  return outcome.value;
};

/** Hash and revalidate the same open descriptor used for root classification. */
export const hashStableRootArtifactHandle = async (
  path: string,
  handle: FileHandle,
  initial: Stats,
  signal?: AbortSignal,
): Promise<HashResult> => {
  const digest = await hashReadable(
    // Read at most the admitted extent plus one byte to detect growth without
    // following an actively appended file indefinitely.
    readArtifactFileChunks(handle, { start: 0, end: initial.size, signal }),
    signal,
  );
  abortIfNeeded(signal);
  try {
    await assertStableRegularFileIdentity(handle, path, initial, {
      symlinks: "reject",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (cause: unknown) {
    abortIfNeeded(signal);
    if (cause instanceof RegularFileChangedError)
      throw new ArtifactReaderFailure(
        "integrity",
        `Root artifact changed during inventory: ${path}`,
        { cause: cause.cause ?? cause },
      );
    throw cause;
  }
  if (digest.bytes !== initial.size)
    throw new ArtifactReaderFailure(
      "integrity",
      `Root artifact changed during inventory: ${path}`,
    );
  abortIfNeeded(signal);
  return digest;
};
