import type { BigIntStats, Dir, Dirent } from "node:fs";
import { opendir, readlink, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import type { ArtifactCleanupAttempt } from "../artifacts/ArtifactResourceScope.js";
import { OwnedDirectoryHandle } from "../filesystem/OwnedDirectoryHandle.js";
import {
  absoluteCallerPath,
  appendCallerPath,
} from "../filesystem/callerPath.js";
import { err, ok } from "../domain/result.js";

import {
  cancelled,
  entryFailure,
  failure,
  filesystemFailureDetail,
  safeSize,
  type FilesystemFailureDetail,
} from "./ReferenceSourceReaderErrors.js";
import { isPathWithinRoot } from "../domain/localPath.js";
import { pathFromRoot } from "./ReferenceSourceReaderPaths.js";
import { readStableFile } from "./ReferenceSourceReaderFile.js";
import { decodeDirectoryEntryName } from "../filesystem/decodeDirectoryEntryName.js";
import {
  isAborted,
  sameFile,
  validateDirectory,
  bigLstat,
} from "./ReferenceSourceReaderValidate.js";
import type {
  PendingDirectory,
  ReferenceSourceEntry,
  ReferenceSourceExclusionKind,
  ReferenceSourceFailureCode,
  ReferenceSourceResult,
  TraversalState,
} from "./ReferenceSourceReaderTypes.js";

const recordDirectoryFailure = (
  state: TraversalState,
  absolute: string,
  code: ReferenceSourceFailureCode,
  message: string,
  localDiagnostic?: string,
): void => {
  if (absolute === state.root)
    state.rootFailure = { code, message: localDiagnostic ?? message };
  else
    state.entries.push(
      entryFailure(
        pathFromRoot(state.root, absolute),
        "directory",
        code,
        message,
        undefined,
        localDiagnostic,
      ),
    );
};

export const traverseDirectory = async (
  state: TraversalState,
  current: PendingDirectory,
): Promise<ReferenceSourceResult<undefined>> => {
  const before = await validateDirectory(
    state.root,
    state.rootIdentity,
    current.path,
    state.signal,
  );
  if (isAborted(state.signal)) return { ok: false, error: cancelled() };
  if (!before.ok) {
    recordDirectoryFailure(
      state,
      current.path,
      before.code,
      before.message,
      before.localDiagnostic,
    );
    return { ok: true, value: undefined };
  }
  const directories: PendingDirectory[] = [];
  let readFailure: FilesystemFailureDetail | undefined;
  let unrepresentableNameCount = 0;
  let firstUnrepresentableNameHex: string | undefined;
  let handle: Dir | undefined;
  try {
    // Preserve directory-entry identity until UTF-8 validity is established.
    // Node's opendir accepts this byte-preserving encoding; @types/node's
    // OpenDirOptions currently narrows it to text encodings.
    handle = await opendir(current.path, {
      encoding: "buffer" as BufferEncoding,
    });
  } catch (cause: unknown) {
    readFailure = directoryReadFailure(cause);
  }
  if (handle !== undefined) {
    const owner = new OwnedDirectoryHandle(handle);
    let result: ReferenceSourceResult<undefined> = ok(undefined);
    let cleanup: ArtifactCleanupAttempt;
    try {
      // A directory that cannot be opened retains its ordinary partial-entry
      // failure; only an opened directory needs policy before enumeration.
      result = isAborted(state.signal)
        ? err(cancelled())
        : ((await state.beforeDirectory?.(
            pathFromRoot(state.root, current.path),
          )) ?? ok(undefined));
      if (result.ok && isAborted(state.signal)) result = err(cancelled());
      while (result.ok) {
        let child: Dirent | null;
        try {
          child = await handle.read();
        } catch (cause: unknown) {
          readFailure = directoryReadFailure(cause);
          break;
        }
        if (child === null) break;
        if (!Buffer.isBuffer(child.name)) {
          readFailure = {
            message: "Directory entry name was not returned as raw bytes",
          };
          break;
        }
        const decoded = decodeDirectoryEntryName(child.name);
        if (decoded.kind === "unrepresentable") {
          unrepresentableNameCount += 1;
          firstUnrepresentableNameHex ??= decoded.rawHex;
          continue;
        }
        result = await processEntry(state, current, decoded.name, directories);
      }
    } finally {
      cleanup = await state.resources.release({
        kind: "directory-handle",
        handle: owner,
        resource: current.path,
      });
    }
    if (cleanup.kind === "failed") {
      if (result.ok && !isAborted(state.signal) && readFailure !== undefined)
        recordDirectoryFailure(
          state,
          current.path,
          "io",
          readFailure.message,
          readFailure.localDiagnostic,
        );
      const observation = ArtifactReaderFailure.cleanupObservation(
        cleanup.cause,
        current.path,
      );
      const previous = result.ok ? undefined : result.error.cleanup;
      const primary = result.ok
        ? isAborted(state.signal)
          ? cancelled()
          : failure(
              "io",
              readFailure?.localDiagnostic ??
                readFailure?.message ??
                `Reference directory cleanup failed: ${current.path}`,
            )
        : result.error;
      return err({
        ...primary,
        cleanup:
          previous === undefined
            ? observation
            : {
                reason: `${previous.reason}; ${observation.reason}`,
                resources: [
                  ...new Set([...previous.resources, ...observation.resources]),
                ],
              },
        cause: primary.cause ?? cleanup.cause,
      });
    }
    if (!result.ok) return result;
  }
  if (isAborted(state.signal)) return { ok: false, error: cancelled() };
  if (readFailure !== undefined) {
    recordDirectoryFailure(
      state,
      current.path,
      "io",
      readFailure.message,
      readFailure.localDiagnostic,
    );
    scheduleObservedDirectories(state, directories);
    return { ok: true, value: undefined };
  }
  const after = await validateDirectory(
    state.root,
    state.rootIdentity,
    current.path,
    state.signal,
  );
  if (isAborted(state.signal)) return { ok: false, error: cancelled() };
  if (!after.ok || !sameFile(before.stats, after.stats)) {
    recordDirectoryFailure(
      state,
      current.path,
      after.ok ? "changed" : after.code,
      after.ok ? "Directory changed while it was read" : after.message,
      after.ok ? undefined : after.localDiagnostic,
    );
    scheduleObservedDirectories(state, directories);
    return { ok: true, value: undefined };
  }
  if (unrepresentableNameCount > 0) {
    recordDirectoryFailure(
      state,
      current.path,
      "unsupported",
      `Directory contains ${String(unrepresentableNameCount)} entry name(s) that are not valid UTF-8; no filesystem operations were performed for them. First raw basename bytes: ${firstUnrepresentableNameHex ?? "unknown"}.`,
    );
  } else if (current.path !== state.root)
    state.entries.push({
      status: "read",
      kind: "directory",
      path: pathFromRoot(state.root, current.path),
    });
  scheduleObservedDirectories(state, directories);
  return { ok: true, value: undefined };
};

const scheduleObservedDirectories = (
  state: TraversalState,
  directories: PendingDirectory[],
): void => {
  directories.reverse();
  state.pending.push(...directories);
};

const directoryReadFailure = (cause: unknown): FilesystemFailureDetail => {
  const detail = filesystemFailureDetail(cause, "Directory could not be read");
  if (detail === undefined) throw cause;
  return detail;
};

const readMetadata = async (
  path: string,
): Promise<
  | { readonly ok: true; readonly value: BigIntStats }
  | ({ readonly ok: false } & FilesystemFailureDetail)
> => {
  try {
    return { ok: true, value: await bigLstat(path) };
  } catch (cause: unknown) {
    const detail = filesystemFailureDetail(
      cause,
      "Entry metadata could not be read",
    );
    if (detail === undefined) throw cause;
    return { ok: false, ...detail };
  }
};

const processEntry = async (
  state: TraversalState,
  current: PendingDirectory,
  name: string,
  directories: PendingDirectory[],
): Promise<ReferenceSourceResult<undefined>> => {
  if (isAborted(state.signal)) return { ok: false, error: cancelled() };
  const absolute = join(current.path, name);
  const path = pathFromRoot(state.root, absolute);
  const metadata = await readMetadata(absolute);
  if (isAborted(state.signal)) return { ok: false, error: cancelled() };
  if (!metadata.ok) {
    const excluded = applyExclusion(state.shouldExclude, path, "unknown");
    if (!excluded.ok)
      return {
        ok: false,
        error: failure("io", "Reference source exclusion check failed"),
      };
    if (excluded.value) {
      state.exclusions.push({ path, kind: "unknown" });
      return { ok: true, value: undefined };
    }
    state.entries.push(
      entryFailure(
        path,
        "unknown",
        "io",
        metadata.message,
        undefined,
        metadata.localDiagnostic,
      ),
    );
    return { ok: true, value: undefined };
  }
  const kind = metadata.value.isSymbolicLink()
    ? "symlink"
    : metadata.value.isDirectory()
      ? "directory"
      : metadata.value.isFile()
        ? "file"
        : "other";
  const excluded = applyExclusion(state.shouldExclude, path, kind);
  if (!excluded.ok)
    return {
      ok: false,
      error: {
        tag: "reference-source-reader",
        code: "io",
        message: "Reference source exclusion check failed",
      },
    };
  if (excluded.value) {
    state.exclusions.push({ path, kind });
    return { ok: true, value: undefined };
  }
  if (isAborted(state.signal)) return { ok: false, error: cancelled() };
  if (kind === "symlink")
    state.entries.push(
      await readStableSymlinkTarget(
        absolute,
        path,
        metadata.value,
        state.signal,
        () => readSymlinkTarget(state.root, absolute, path),
      ),
    );
  else if (kind === "directory") {
    directories.push({ path: absolute });
  } else if (kind !== "file")
    state.entries.push(
      entryFailure(
        path,
        "other",
        "unsupported",
        "Entry is not a regular file",
        safeSize(metadata.value.size),
      ),
    );
  else return processFileEntry(state, absolute, path, metadata.value);
  return { ok: true, value: undefined };
};

const processFileEntry = async (
  state: TraversalState,
  absolute: string,
  path: string,
  metadata: BigIntStats,
): Promise<ReferenceSourceResult<undefined>> => {
  const result = await readStableFile({
    resources: state.resources,
    root: state.root,
    rootIdentity: state.rootIdentity,
    absolute,
    path,
    expected: metadata,
    ...(state.signal === undefined ? {} : { signal: state.signal }),
  });
  const { entry } = result;
  if (entry.status === "read" && entry.kind === "file")
    state.bytesRead += entry.bytes.byteLength;
  state.entries.push(entry);
  if (result.cleanup !== undefined)
    return err({
      tag: "reference-source-reader",
      code:
        entry.status === "failed" && entry.code === "cancelled"
          ? "cancelled"
          : "io",
      message:
        entry.status === "failed"
          ? entry.message
          : `Reference file cleanup failed: ${path}`,
      cleanup: result.cleanup,
    });
  return ok(undefined);
};

/** Bracket target observation with the symlink identity captured at enumeration. */
export const readStableSymlinkTarget = async (
  absolute: string,
  path: string,
  expected: BigIntStats,
  signal: AbortSignal | undefined,
  readTarget: () => Promise<ReferenceSourceEntry>,
): Promise<ReferenceSourceEntry> => {
  try {
    const before = await bigLstat(absolute);
    if (isAborted(signal)) return cancelledSymlink(path);
    if (!before.isSymbolicLink() || !sameFile(expected, before))
      return changedSymlink(path);
    const observed = await readTarget();
    if (isAborted(signal)) return cancelledSymlink(path);
    const after = await bigLstat(absolute);
    if (isAborted(signal)) return cancelledSymlink(path);
    if (!after.isSymbolicLink() || !sameFile(expected, after))
      return changedSymlink(path);
    return observed;
  } catch (cause: unknown) {
    if (isAborted(signal)) return cancelledSymlink(path);
    const code =
      cause instanceof Error ? Reflect.get(cause, "code") : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") return changedSymlink(path);
    const detail = filesystemFailureDetail(
      cause,
      "Symbolic link target could not be read safely",
    );
    if (detail === undefined) throw cause;
    return entryFailure(
      path,
      "symlink",
      "io",
      detail.message,
      undefined,
      detail.localDiagnostic,
    );
  }
};

const cancelledSymlink = (path: string) =>
  entryFailure(path, "symlink", "cancelled", "Symlink inspection cancelled");

const changedSymlink = (path: string) =>
  entryFailure(
    path,
    "symlink",
    "changed",
    "Symbolic link changed while its target was read",
  );

const readSymlinkTarget = async (
  root: string,
  absolute: string,
  path: string,
): Promise<ReferenceSourceEntry> => {
  let rawTarget: Buffer;
  try {
    // Keep the symlink's source bytes until UTF-8 validity is known. The
    // default string encoding can alias an invalid target with a real U+FFFD
    // sibling during the subsequent path lookup.
    rawTarget = await readlink(absolute, { encoding: "buffer" });
  } catch (cause: unknown) {
    // POSIX readlink reports EINVAL when the observed link became a non-link.
    // Keep this classification at the syscall, rather than hiding EINVAL from
    // unrelated metadata or target-resolution operations.
    if (cause instanceof Error && Reflect.get(cause, "code") === "EINVAL")
      return changedSymlink(path);
    throw cause;
  }
  let target: string;
  try {
    target = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(rawTarget);
  } catch {
    return entryFailure(
      path,
      "symlink",
      "unsupported",
      `Symlink target is not valid UTF-8 (raw target bytes: ${rawTarget.toString("hex")})`,
    );
  }
  const nativeTarget = absoluteCallerPath(target, { cwd: dirname(absolute) });
  let canonicalTarget: string;
  try {
    // The filesystem resolves parent segments after following symlinks. A
    // lexical containment check can both select a decoy and misclassify scope.
    // realpath can collapse file/.. on some hosts even though native lookup
    // rejects that traversal, so establish existence through stat first.
    await stat(nativeTarget);
    canonicalTarget = await realpath(nativeTarget);
  } catch (cause: unknown) {
    const code =
      cause instanceof Error ? Reflect.get(cause, "code") : undefined;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw cause;
    return {
      status: "read",
      kind: "symlink",
      path,
      target: await missingSymlinkPath(root, nativeTarget),
      targetState: "missing",
    };
  }
  const internal = isPathWithinRoot(root, canonicalTarget);
  return {
    status: "read",
    kind: "symlink",
    path,
    target: internal ? pathFromRoot(root, canonicalTarget) : canonicalTarget,
    targetState: internal ? "internal" : "external",
  };
};

/** Preserve the native spelling when a missing parent prevents canonical lookup. */
const missingSymlinkPath = async (
  root: string,
  target: string,
): Promise<string> => {
  if (basename(target) === "..") return target;
  let parent: string;
  try {
    await stat(dirname(target));
    parent = await realpath(dirname(target));
  } catch (cause: unknown) {
    const code =
      cause instanceof Error ? Reflect.get(cause, "code") : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") return target;
    throw cause;
  }
  const candidate = appendCallerPath(parent, basename(target));
  // A trailing separator requires a directory; relative() would erase it.
  if (target.endsWith(sep)) return `${candidate}${sep}`;
  return isPathWithinRoot(root, candidate)
    ? pathFromRoot(root, candidate)
    : candidate;
};

const applyExclusion = (
  shouldExclude:
    | ((path: string, kind: ReferenceSourceExclusionKind) => boolean)
    | undefined,
  path: string,
  kind: ReferenceSourceExclusionKind,
): { readonly ok: true; readonly value: boolean } | { readonly ok: false } => {
  try {
    return { ok: true, value: shouldExclude?.(path, kind) === true };
  } catch (cause: unknown) {
    // Exclusion predicates are caller-supplied; a throwing predicate fails
    // closed and the caller-visible `{ ok: false }` preserves the rejection
    // without propagating an arbitrary predicate cause.
    void cause;
    return { ok: false };
  }
};
