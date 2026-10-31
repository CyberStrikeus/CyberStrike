import { observedSymlinkTarget } from "../../domain/symlinkTarget.js";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, opendir, readlink, realpath } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { FileHandle } from "node:fs/promises";
import { appendCallerPath } from "../../filesystem/callerPath.js";
import { decodeDirectoryEntryName } from "../../filesystem/decodeDirectoryEntryName.js";
import { sameRegularFileState } from "../../filesystem/RegularFile.js";
import type { ProcessScenario } from "../../domain/process/processScenario.js";
import type { FilesystemCoverage } from "../../domain/process/processCaptureCoverage.js";
import type { Stats } from "node:fs";
import { err, ok, type Result } from "../../domain/result.js";
import { AnalysisAccessDeniedError } from "../../domain/analysisErrorCore.js";
import type {
  FileState,
  ProcessFilesystemSnapshot,
} from "../../domain/process/processCapture.js";
import {
  AnalysisCleanupLease,
  AnalysisCleanupLeaseGroup,
} from "../../artifacts/AnalysisCleanupLease.js";
import {
  normalizeCaptureFailure,
  describeProcessCaptureExecutionFailure,
  ProcessCaptureError,
} from "./ProcessCaptureError.js";
import {
  ProcessCaptureReadFailure,
  withProcessCaptureDirectory,
  withProcessCaptureFile,
  type ProcessCaptureCleanupRetainer,
} from "./ProcessCaptureRead.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";

const hasSameIdentity = (
  before: Stats,
  after: Stats,
  expected: "directory" | "symlink",
): boolean =>
  before.dev === after.dev &&
  before.ino === after.ino &&
  (expected === "directory" ? after.isDirectory() : after.isSymbolicLink());

const filesystemSystemCode = (cause: unknown): string | undefined => {
  if (!(cause instanceof Error) || !("code" in cause)) return undefined;
  const code = cause.code;
  return typeof code === "string" ? code : undefined;
};

const unavailableSystemCodes = new Set([
  "EACCES",
  "EISDIR",
  "ELOOP",
  "ENOTDIR",
  "ENOENT",
  "EPERM",
  "ESTALE",
]);

const fileUnavailableSystemCode = (cause: unknown): string | undefined => {
  const code = filesystemSystemCode(cause);
  return code !== undefined && unavailableSystemCodes.has(code)
    ? code
    : undefined;
};

type EntryOmission =
  | { readonly reason: "entry_unavailable"; readonly system_code: string }
  | { readonly reason: "identity_changed"; readonly system_code: null };

/** A follow-up read cannot turn previously observed metadata into absence. */
const readEntryObservation = async <T>(
  read: () => Promise<T>,
  signal?: AbortSignal,
): Promise<Result<T, EntryOmission>> => {
  signal?.throwIfAborted();
  try {
    const value = await read();
    signal?.throwIfAborted();
    return ok(value);
  } catch (cause: unknown) {
    const code = filesystemSystemCode(cause);
    // readlink reports EINVAL if the observed symlink was replaced by a file.
    if (
      code === undefined ||
      (!unavailableSystemCodes.has(code) && code !== "EINVAL")
    )
      throw cause;
    signal?.throwIfAborted();
    return err({ reason: "entry_unavailable", system_code: code });
  }
};

const observeSymlink = async (
  path: string,
  before: Stats,
  signal?: AbortSignal,
): Promise<
  Result<{ readonly text: string | null; readonly hex: string }, EntryOmission>
> => {
  const target = await readEntryObservation(
    () => readlink(path, { encoding: "buffer" }),
    signal,
  );
  if (!target.ok) return target;
  const after = await readEntryObservation(() => lstat(path), signal);
  if (!after.ok) return after;
  if (!hasSameIdentity(before, after.value, "symlink"))
    return err({ reason: "identity_changed", system_code: null });
  return ok(observedSymlinkTarget(target.value));
};

type PathLookup =
  | { readonly state: "present"; readonly stats: Stats }
  | {
      readonly state: "absent" | "unavailable";
      readonly system_code: string;
      readonly cause: unknown;
    };

/**
 * Look up one path without following its final component. ENOENT and ENOTDIR
 * both prove that no entry exists at the path; other unavailable lookups leave
 * it unobserved rather than absent.
 */
const lookupPath = async (
  path: string,
  signal?: AbortSignal,
): Promise<PathLookup> => {
  signal?.throwIfAborted();
  let stats: Stats;
  try {
    stats = await lstat(path);
  } catch (cause: unknown) {
    const systemCode = fileUnavailableSystemCode(cause);
    if (systemCode === undefined) throw cause;
    signal?.throwIfAborted();
    return {
      state:
        systemCode === "ENOENT" || systemCode === "ENOTDIR"
          ? "absent"
          : "unavailable",
      system_code: systemCode,
      cause,
    };
  }
  signal?.throwIfAborted();
  return { state: "present", stats };
};

/** Reports a complete digest or an explicit per-file reason hashing was omitted. */
export type FileHashOutcome =
  | { readonly state: "hashed"; readonly sha256: string }
  | {
      readonly state: "omitted";
      readonly reason: "file_changed_or_short_read" | "file_unavailable";
      readonly system_code: string | null;
    };

/** Snapshot facts retained alongside close failures from its owned reads. */
export class ProcessCaptureSnapshotFailure extends ProcessCaptureError {
  readonly snapshot: ProcessFilesystemSnapshot | undefined;
  readonly cleanupLeases: readonly AnalysisCleanupLease[];
  readonly readFailures: readonly ProcessCaptureReadFailure<unknown>[];

  constructor(options: {
    readonly cause: unknown;
    readonly snapshot?: ProcessFilesystemSnapshot;
    readonly cleanupLeases?: readonly AnalysisCleanupLease[];
    readonly readFailures?: readonly ProcessCaptureReadFailure<unknown>[];
  }) {
    const cleanupLeases = [...new Set(options.cleanupLeases ?? [])];
    const readFailures = [...new Set(options.readFailures ?? [])];
    const readFailure =
      options.cause instanceof ProcessCaptureReadFailure
        ? options.cause
        : undefined;
    const primary =
      readFailure !== undefined && Object.hasOwn(readFailure, "cause")
        ? readFailure.cause
        : options.cause instanceof ProcessCaptureError &&
            options.cause.userCategory === "cancelled" &&
            Object.hasOwn(options.cause, "cause")
          ? options.cause.cause
          : options.cause;
    const cancellation =
      readFailure?.userCategory === "cancelled" ||
      (options.cause instanceof ProcessCaptureError &&
        options.cause.userCategory === "cancelled");
    const closeDetails = readFailures
      .filter((failure) => failure.cleanupLeases.length > 0)
      .map((failure) => {
        const reason = failure.cleanup?.reason ?? "descriptor close failed";
        return `${failure.path}: ${reason}`;
      });
    const primaryMessage =
      describeProcessCaptureExecutionFailure(options.cause) ??
      "snapshot read rejected without a value";
    const message =
      closeDetails.length === 0
        ? `Process filesystem snapshot failed: ${primaryMessage}`
        : `Process filesystem snapshot failed: ${primaryMessage}; ${closeDetails.join("; ")}`;
    const cleanupReason =
      closeDetails.join("; ") ||
      cleanupLeases
        .map((lease) => lease.cleanupResources ?? [])
        .flat()
        .join(", ") ||
      "snapshot handle cleanup failed";
    super(message, {
      cause: primary,
      ...(options.cause instanceof AnalysisAccessDeniedError
        ? { cleanupPrimary: options.cause }
        : {}),
      ...(cancellation
        ? { userCategory: "cancelled" as const, reason: "cancelled" as const }
        : {}),
      ...(cleanupLeases.length === 0
        ? {}
        : {
            cleanup: {
              reason: cleanupReason,
              resources: [
                ...new Set(
                  cleanupLeases.flatMap(
                    (lease) => lease.cleanupResources ?? [],
                  ),
                ),
              ],
            },
          }),
    });
    this.snapshot = options.snapshot;
    this.cleanupLeases = cleanupLeases;
    this.readFailures = readFailures;
    if (cleanupLeases.length > 0)
      new AnalysisCleanupLeaseGroup(this, cleanupLeases);
  }

  /** The snapshot owns observations; the admitted read owns its failure identity. */
  failureForCaller(): AnalysisError {
    const primary = this.cleanupPrimary;
    if (!(primary instanceof AnalysisAccessDeniedError)) return this;
    return this.cleanupIncomplete
      ? analysisErrorWithCleanupFailure(
          primary,
          this,
          "capture_process",
        ).bindCleanupDependencies([primary, this])
      : primary;
  }
}

/** Hash a file only when its opened descriptor still matches the captured path state. */
export const hashFile = async (
  path: string,
  expected: Stats,
  maxBytes: number,
  signal?: AbortSignal,
  retainer?: ProcessCaptureCleanupRetainer,
): Promise<FileHashOutcome> => {
  signal?.throwIfAborted();
  const noFollowAvailable =
    typeof fsConstants.O_NOFOLLOW === "number" && fsConstants.O_NOFOLLOW !== 0;
  let handle: FileHandle;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY |
        (noFollowAvailable ? fsConstants.O_NOFOLLOW : 0) |
        (fsConstants.O_NONBLOCK ?? 0),
    );
  } catch (cause: unknown) {
    const systemCode = fileUnavailableSystemCode(cause);
    if (systemCode === undefined) throw cause;
    signal?.throwIfAborted();
    return {
      state: "omitted",
      reason: "file_unavailable",
      system_code: systemCode,
    };
  }
  return await withProcessCaptureFile(
    path,
    handle,
    signal,
    retainer,
    async (ownedHandle) => {
      try {
        signal?.throwIfAborted();
        // On hosts without O_NOFOLLOW, compare the leaf's identity with the
        // captured regular file. Ancestor aliases do not change file identity.
        if (!noFollowAvailable) {
          const named = await lstat(path);
          signal?.throwIfAborted();
          if (!expected.isFile() || !sameRegularFileState(expected, named))
            return {
              state: "omitted",
              reason: "file_changed_or_short_read",
              system_code: null,
            };
        }
        const stats = await ownedHandle.stat();
        signal?.throwIfAborted();
        if (
          !expected.isFile() ||
          !sameRegularFileState(expected, stats) ||
          stats.size > maxBytes
        )
          return {
            state: "omitted",
            reason: "file_changed_or_short_read",
            system_code: null,
          };
        const hash = createHash("sha256");
        const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes));
        let position = 0;
        while (position < stats.size) {
          signal?.throwIfAborted();
          const { bytesRead } = await ownedHandle.read(
            buffer,
            0,
            Math.min(buffer.length, stats.size - position),
            position,
          );
          if (bytesRead === 0)
            return {
              state: "omitted",
              reason: "file_changed_or_short_read",
              system_code: null,
            };
          hash.update(buffer.subarray(0, bytesRead));
          position += bytesRead;
        }
        const after = await ownedHandle.stat();
        signal?.throwIfAborted();
        let unchanged = sameRegularFileState(stats, after);
        if (unchanged && !noFollowAvailable) {
          const namedAfter = await lstat(path);
          signal?.throwIfAborted();
          unchanged = sameRegularFileState(after, namedAfter);
        }
        if (!unchanged)
          return {
            state: "omitted",
            reason: "file_changed_or_short_read",
            system_code: null,
          };
        return { state: "hashed", sha256: hash.digest("hex") };
      } catch (cause: unknown) {
        const systemCode = fileUnavailableSystemCode(cause);
        if (systemCode === undefined) throw cause;
        signal?.throwIfAborted();
        return {
          state: "omitted",
          reason: "file_unavailable",
          system_code: systemCode,
        };
      }
    },
  );
};

interface SnapshotResources {
  readonly cleanup?: ProcessCaptureCleanupRetainer;
  readonly observerPaths?: readonly string[];
}

/**
 * Capture bounded, root-aliased filesystem state without following symlinks.
 *
 * Without `admission`, every selected root must be missing or observable, so
 * an obstructed or denied selection fails before launch. A snapshot returned
 * from that call admitted every root for the run: later lookups record a
 * non-directory ancestor as absence and a denied lookup as an omission.
 */
export const snapshotRoots = async (
  scenario: ProcessScenario,
  signal?: AbortSignal,
  admission?: ProcessFilesystemSnapshot,
  resources: SnapshotResources = {},
): Promise<ProcessFilesystemSnapshot> => {
  const retainer = resources.cleanup;
  const observerPaths = resources.observerPaths ?? [];
  const entries: FileState[] = [];
  const completeRoots: string[] = [];
  let remainingBytes = scenario.limits.file_bytes;
  let pendingNames = 0;
  let unrepresentableNames = 0;
  let truncated = false;
  const enumerationReasons = new Set<
    FilesystemCoverage["enumeration_reasons"][number]
  >();
  const enumerationOmissions: FilesystemCoverage["enumeration_omissions"] = [];
  const hashOmissions: FilesystemCoverage["hash_omissions"] = [];
  const closeFailures: ProcessCaptureReadFailure<unknown>[] = [];
  const unobservedSubtrees: NonNullable<
    FilesystemCoverage["unobserved_subtrees"]
  > = [];
  const observerRoots = new Set(
    await Promise.all(observerPaths.map((path) => realpath(path))),
  );
  const observerNames = new Set(
    [...observerRoots].map((path) => basename(path)),
  );
  const omitObserverPath = async (
    root: string,
    alias: string,
    path: string,
  ): Promise<boolean> => {
    if (!observerNames.has(basename(path))) return false;
    const physical = join(await realpath(dirname(path)), basename(path));
    if (!observerRoots.has(physical)) return false;
    unobservedSubtrees.push({
      path: `${alias}:${relative(root, path) || "."}`,
      reason: "observer_owned",
    });
    return true;
  };
  const omitEntry = (path: string, omission: EntryOmission): false => {
    truncated = true;
    enumerationReasons.add(omission.reason);
    enumerationOmissions.push({ path, ...omission });
    return false;
  };
  const recordFile = (
    rootAlias: string,
    relativePath: string,
    stats: Stats,
    outcome:
      | FileHashOutcome
      | {
          readonly state: "omitted";
          readonly reason: "file_bytes_budget";
          readonly system_code: null;
        },
  ): void => {
    let sha256: string | null = null;
    let omission: FilesystemCoverage["hash_omissions"][number] | undefined;
    if (outcome.state === "hashed") {
      sha256 = outcome.sha256;
      remainingBytes -= stats.size;
    } else {
      omission = {
        path: `${rootAlias}:${relativePath}`,
        size_bytes: stats.size,
        remaining_budget_bytes: remainingBytes,
        reason: outcome.reason,
        system_code: outcome.system_code,
      };
    }
    if (omission !== undefined) {
      truncated = true;
      hashOmissions.push(omission);
    }
    entries.push({
      path: `${rootAlias}:${relativePath}`,
      type: "file",
      mode: stats.mode,
      size: stats.size,
      sha256,
      symlink_target: null,
    });
  };
  const visit = async (
    root: string,
    rootAlias: string,
    path: string,
    depth: number,
    admitted?: Stats,
  ): Promise<boolean> => {
    signal?.throwIfAborted();
    if (await omitObserverPath(root, rootAlias, path)) return true;
    if (
      entries.length + unrepresentableNames >= scenario.limits.files ||
      depth > scenario.limits.filesystem_depth
    ) {
      truncated = true;
      if (entries.length + unrepresentableNames >= scenario.limits.files)
        enumerationReasons.add("files_limit");
      if (depth > scenario.limits.filesystem_depth)
        enumerationReasons.add("depth_limit");
      return false;
    }
    const relativePath = relative(root, path) || ".";
    const lookup: PathLookup =
      admitted === undefined
        ? await lookupPath(path, signal)
        : { state: "present", stats: admitted };
    if (lookup.state !== "present")
      return (
        lookup.state === "absent" ||
        omitEntry(`${rootAlias}:${relativePath}`, {
          reason: "entry_unavailable",
          system_code: lookup.system_code,
        })
      );
    const { stats } = lookup;
    if (stats.isSymbolicLink()) {
      // Keep the target as stored: lexical resolution can merge distinct targets.
      const target = await observeSymlink(path, stats, signal);
      if (!target.ok)
        return omitEntry(`${rootAlias}:${relativePath}`, target.error);
      entries.push({
        path: `${rootAlias}:${relativePath}`,
        type: "symlink",
        mode: stats.mode,
        size: stats.size,
        sha256: null,
        symlink_target: target.value.text,
        symlink_target_hex: target.value.hex,
      });
      unobservedSubtrees.push({
        path: `${rootAlias}:${relativePath}`,
        reason: "symlink_not_followed",
      });
      truncated = true;
      enumerationReasons.add("symlink_not_followed");
      enumerationOmissions.push({
        path: `${rootAlias}:${relativePath}`,
        reason: "symlink_not_followed",
        system_code: null,
      });
      // A link leaves its descendants unknown, while a physically enumerated
      // parent still proves absence of unrelated sibling names.
      return depth > 0;
    }
    if (stats.isFile()) {
      if (remainingBytes < stats.size) {
        recordFile(rootAlias, relativePath, stats, {
          state: "omitted",
          reason: "file_bytes_budget",
          system_code: null,
        });
      } else {
        let outcome: FileHashOutcome;
        try {
          outcome = await hashFile(
            path,
            stats,
            remainingBytes,
            signal,
            retainer,
          );
        } catch (cause: unknown) {
          if (
            cause instanceof ProcessCaptureReadFailure &&
            cause.outcome.kind === "completed" &&
            cause.userCategory === "cancelled"
          ) {
            recordFile(rootAlias, relativePath, stats, cause.outcome.value);
            if (depth === 0) completeRoots.push(rootAlias);
            throw cause;
          }
          if (
            cause instanceof ProcessCaptureReadFailure &&
            cause.outcome.kind === "completed" &&
            cause.cleanupLeases.length > 0
          ) {
            closeFailures.push(cause);
            outcome = cause.outcome.value;
          } else {
            throw cause;
          }
        }
        recordFile(rootAlias, relativePath, stats, outcome);
      }
      return true;
    }
    const type = stats.isDirectory() ? "directory" : "other";
    entries.push({
      path: `${rootAlias}:${relativePath}`,
      type,
      mode: stats.mode,
      size: stats.size,
      sha256: null,
      symlink_target: null,
    });
    if (type !== "directory") return true;
    const children: string[] = [];
    let complete = true;
    let remainingEntries =
      scenario.limits.files -
      entries.length -
      pendingNames -
      unrepresentableNames;
    let directory;
    try {
      directory = await opendir(path, {
        encoding: "buffer" as BufferEncoding,
      });
    } catch (cause: unknown) {
      const systemCode = fileUnavailableSystemCode(cause);
      if (systemCode === undefined) throw cause;
      signal?.throwIfAborted();
      truncated = true;
      complete = false;
      enumerationReasons.add("directory_unavailable");
      enumerationOmissions.push({
        path: `${rootAlias}:${relativePath}`,
        reason: "directory_unavailable",
        system_code: systemCode,
      });
      return false;
    }
    try {
      await withProcessCaptureDirectory(
        path,
        directory,
        signal,
        retainer,
        async (ownedDirectory) => {
          while (true) {
            signal?.throwIfAborted();
            const child = await ownedDirectory.read();
            if (child === null) break;
            const decoded = decodeDirectoryEntryName(child.name);
            if (
              decoded.kind === "decoded" &&
              (await omitObserverPath(
                root,
                rootAlias,
                appendCallerPath(path, decoded.name),
              ))
            )
              continue;
            if (
              children.length >= remainingEntries ||
              depth >= scenario.limits.filesystem_depth
            ) {
              truncated = true;
              complete = false;
              if (children.length >= remainingEntries)
                enumerationReasons.add("files_limit");
              if (depth >= scenario.limits.filesystem_depth)
                enumerationReasons.add("depth_limit");
              break;
            }
            if (decoded.kind === "unrepresentable") {
              unrepresentableNames += 1;
              remainingEntries -= 1;
              truncated = true;
              complete = false;
              enumerationReasons.add("unrepresentable_name");
              enumerationOmissions.push({
                path: `${rootAlias}:${relativePath}`,
                reason: "unrepresentable_name",
                system_code: null,
                raw_name_hex: decoded.rawHex,
              });
              continue;
            }
            children.push(decoded.name);
            pendingNames += 1;
          }
        },
      );
    } catch (cause: unknown) {
      if (
        cause instanceof ProcessCaptureReadFailure &&
        cause.outcome.kind === "completed" &&
        cause.cleanupLeases.length > 0
      ) {
        if (cause.userCategory === "cancelled") {
          throw cause;
        }
        closeFailures.push(cause);
      } else {
        throw cause;
      }
    }
    const afterRead = await readEntryObservation(() => lstat(path), signal);
    if (
      !afterRead.ok ||
      !hasSameIdentity(stats, afterRead.value, "directory")
    ) {
      pendingNames -= children.length;
      return omitEntry(
        `${rootAlias}:${relativePath}`,
        afterRead.ok
          ? { reason: "identity_changed", system_code: null }
          : afterRead.error,
      );
    }
    children.sort().reverse();
    while (children.length > 0) {
      const child = children.pop();
      if (child === undefined) break;
      pendingNames -= 1;
      if (
        !(await visit(
          root,
          rootAlias,
          appendCallerPath(path, child),
          depth + 1,
        ))
      )
        complete = false;
    }
    return complete;
  };
  const buildSnapshot = (): ProcessFilesystemSnapshot => ({
    files: entries,
    truncated,
    completeRoots,
    coverage: {
      files_limit: scenario.limits.files,
      depth_limit: scenario.limits.filesystem_depth,
      enumeration_truncated:
        completeRoots.length !== scenario.filesystem_observation_paths.length ||
        enumerationOmissions.length > 0,
      enumeration_reasons: [...enumerationReasons],
      enumeration_omissions: enumerationOmissions,
      unobserved_subtrees: unobservedSubtrees,
      hash_budget_bytes: scenario.limits.file_bytes,
      hashed_bytes: scenario.limits.file_bytes - remainingBytes,
      hash_omissions: hashOmissions,
    },
  });
  try {
    signal?.throwIfAborted();
    for (const [
      index,
      root,
    ] of scenario.filesystem_observation_paths.entries()) {
      const alias = `root_${String(index)}`;
      const lookup = await lookupPath(root, signal);
      if (lookup.state !== "present") {
        if (admission === undefined && lookup.system_code !== "ENOENT") {
          if (
            lookup.system_code === "EACCES" ||
            lookup.system_code === "EPERM"
          ) {
            omitEntry(`${alias}:.`, {
              reason: "entry_unavailable",
              system_code: lookup.system_code,
            });
            throw new AnalysisAccessDeniedError(
              "capture_process_scenario",
              root,
              lookup.system_code,
              { cause: lookup.cause },
            );
          }
          throw lookup.cause;
        }
        if (lookup.state === "absent") completeRoots.push(alias);
        else
          omitEntry(`${alias}:.`, {
            reason: "entry_unavailable",
            system_code: lookup.system_code,
          });
        continue;
      }
      if (await visit(root, alias, root, 0, lookup.stats))
        completeRoots.push(alias);
    }
    const snapshot = buildSnapshot();
    if (closeFailures.length > 0) {
      const causes = closeFailures.map(({ cleanupCause }) => cleanupCause);
      throw new ProcessCaptureSnapshotFailure({
        cause:
          causes.length === 1
            ? (causes[0] as unknown)
            : new AggregateError(causes, "Snapshot handle closes failed"),
        snapshot,
        cleanupLeases: closeFailures.flatMap(
          ({ cleanupLeases }) => cleanupLeases,
        ),
        readFailures: closeFailures,
      });
    }
    return snapshot;
  } catch (cause: unknown) {
    if (cause instanceof ProcessCaptureSnapshotFailure) throw cause;
    truncated ||=
      completeRoots.length !== scenario.filesystem_observation_paths.length;
    const readFailures = [
      ...closeFailures,
      ...(cause instanceof ProcessCaptureReadFailure ? [cause] : []),
    ];
    throw new ProcessCaptureSnapshotFailure({
      cause: normalizeCaptureFailure(cause, signal),
      snapshot: buildSnapshot(),
      cleanupLeases: readFailures.flatMap(({ cleanupLeases }) => cleanupLeases),
      readFailures,
    });
  }
};
