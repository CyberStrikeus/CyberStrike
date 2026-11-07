import { constants, type BigIntStats } from "node:fs";
import {
  lstat,
  open,
  opendir,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { Readable } from "node:stream";

import {
  ArtifactReaderFailure,
  sameArtifactSourceIdentity,
  type ArtifactEntry,
  type ArtifactReader,
  type ArtifactReaderFailureOptions,
  type ArtifactTraversalOmission,
  type ArtifactTraversalOptions,
} from "./ArtifactReader.js";
import { hostExecutableMarking } from "./hostExecutableMarking.js";
import { OwnedDirectoryHandle } from "../filesystem/OwnedDirectoryHandle.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import { readArtifactFileChunks } from "./readArtifactFileChunks.js";
import {
  withOwnedFileHandle,
  RegularFileCleanupFailure,
  RegularFileCancelled,
} from "../filesystem/OwnedRegularFile.js";
import { RegularFileOperationCancelled } from "../filesystem/RegularFile.js";
import {
  ArtifactFileCancelled,
  ArtifactFileCleanupFailure,
} from "./ArtifactFileOperation.js";
import { AnalysisCleanupLease } from "./AnalysisCleanupLease.js";
import { decodeDirectoryEntryName } from "../filesystem/decodeDirectoryEntryName.js";
import { resolveArtifactSourcePath } from "./ArtifactSelectedSource.js";

export type DirectoryArtifactEntry = ArtifactEntry & {
  readonly kind: "file" | "directory" | "symlink";
};

interface DirectoryArtifactRoot {
  readonly canonicalPath: string;
  readonly identity: { readonly dev: bigint; readonly ino: bigint };
}

interface DirectoryTraversalOptions extends ArtifactTraversalOptions {
  readonly descendInto?: (path: string) => boolean;
  /** Bound examined children, including omitted special entries. */
  readonly maximumEntries?: number;
}

/** Exhausted an examined-entry budget; unrelated I/O and cleanup failures stay distinct. */
export class DirectoryArtifactTraversalLimit extends ArtifactReaderFailure {
  constructor(
    readonly examinedEntries: number,
    readonly maximumEntries: number,
  ) {
    super("limit", "Directory traversal reached its examined-entry budget", {
      boundary: "capacity",
    });
  }
}

/**
 * The selected root could not be admitted or opened. The consumer that owns
 * the caller's selection classifies it; `cause` retains the host failure.
 */
export class DirectoryArtifactRootFailure extends ArtifactReaderFailure {}

/**
 * A selected child entry could not be opened because the host denied read
 * access. The consumer that owns the caller's selection classifies it;
 * `systemCode` and `entryPath` retain what the host actually reported so the
 * classification never has to be re-derived from message text.
 */
export class DirectoryArtifactEntryAccessDenied extends ArtifactReaderFailure {
  constructor(
    readonly systemCode: "EACCES" | "EPERM",
    readonly entryPath: string,
    message: string,
    options?: ArtifactReaderFailureOptions,
  ) {
    super("io", message, options);
  }
}

/** Non-symlink-following directory reader. */
export class DirectoryArtifactReader implements ArtifactReader {
  readonly format = "directory" as const;
  #rootPromise: Promise<DirectoryArtifactRoot> | undefined;
  readonly #rootPath: string;
  readonly #directories = new Set<OwnedDirectoryHandle>();
  readonly #files = new Map<OwnedFileHandle, string>();
  readonly #fileCleanup = new WeakMap<OwnedFileHandle, AnalysisCleanupLease>();

  constructor(
    root: string,
    private readonly unreadableDirectories: "fail" | "omit" = "fail",
  ) {
    this.#rootPath = root;
  }

  /** Enumerate entries, optionally restricting descent while retaining directories. */
  async *entries(
    signal?: AbortSignal,
    selection?: DirectoryTraversalOptions | ((path: string) => boolean),
  ): AsyncIterable<DirectoryArtifactEntry> {
    const admittedRoot = await this.#resolveRoot();
    const root = admittedRoot.canonicalPath;
    const options =
      typeof selection === "function" ? { descendInto: selection } : selection;
    const maximum = options?.maximumEntries;
    if (
      maximum !== undefined &&
      (!Number.isSafeInteger(maximum) || maximum < 0)
    )
      throw new RangeError(
        "Directory traversal maximumEntries must be a nonnegative safe integer",
      );
    let examined = 0;
    const examine = () => {
      if (maximum !== undefined && examined >= maximum)
        throw new DirectoryArtifactTraversalLimit(examined, maximum);
      examined += 1;
    };
    const pending = [root];
    let unrepresentableNameCount = 0;
    let firstUnrepresentableNameHex: string | undefined;
    while (pending.length > 0) {
      abortIfNeeded(signal);
      const directory = pending.pop();
      if (directory === undefined) break;
      await withDirectoryIoContext("inspect directory", directory, () =>
        assertContainedDirectory(root, directory, admittedRoot.identity),
      );
      try {
        for await (const entry of this.#readDirectory(
          directory,
          pending,
          signal,
          options,
          examine,
          (rawHex) => {
            unrepresentableNameCount += 1;
            firstUnrepresentableNameHex ??= rawHex;
          },
        ))
          yield entry;
      } catch (cause: unknown) {
        if (
          this.unreadableDirectories !== "omit" ||
          !(cause instanceof DirectoryArtifactEntryAccessDenied)
        )
          throw cause;
        abortIfNeeded(signal);
        options?.onOmission?.({
          path: cause.entryPath,
          kind: "directory-descendants",
        });
        options?.onCoverage?.({
          status: "unknown",
          limitations: [cause.message],
        });
        continue;
      }
      await withDirectoryIoContext("inspect directory", directory, () =>
        assertContainedDirectory(root, directory, admittedRoot.identity),
      );
    }
    if (unrepresentableNameCount > 0)
      options?.onCoverage?.({
        status: "unknown",
        examinedEntries: examined,
        limitations: [
          `Directory contains ${String(unrepresentableNameCount)} entry name(s) that are not valid UTF-8; no filesystem operations were performed for them. First raw basename bytes: ${firstUnrepresentableNameHex ?? "unknown"}.`,
        ],
      });
  }

  /** Admission facts, shared with traversal; the selected root may be a symlink. */
  rootObservation(): Promise<DirectoryArtifactRoot> {
    return this.#resolveRoot();
  }

  async #resolveRoot(): Promise<DirectoryArtifactRoot> {
    return (this.#rootPromise ??= (async () => {
      const root = await resolveArtifactSourcePath(this.#rootPath);
      const metadata = await lstat(root, { bigint: true });
      if (metadata.isSymbolicLink())
        throw new ArtifactReaderFailure(
          "path",
          "Artifact root changed during traversal",
        );
      if (!metadata.isDirectory())
        throw new DirectoryArtifactRootFailure(
          "path",
          "Artifact root must be a directory",
        );
      return Object.freeze({
        canonicalPath: root,
        identity: Object.freeze({ dev: metadata.dev, ino: metadata.ino }),
      });
    })().catch((cause: unknown) => {
      if (cause instanceof ArtifactReaderFailure) throw cause;
      throw directoryIoFailure(
        "resolve artifact root",
        this.#rootPath,
        cause,
        DirectoryArtifactRootFailure,
      );
    }));
  }

  async *#readDirectory(
    directory: string,
    pending: string[],
    signal: AbortSignal | undefined,
    options: DirectoryTraversalOptions | undefined,
    examine: () => void,
    noteUnrepresentableName: (rawHex: string) => void,
  ): AsyncIterable<DirectoryArtifactEntry> {
    const admittedRoot = await this.#resolveRoot();
    const root = admittedRoot.canonicalPath;
    const handle = new OwnedDirectoryHandle(
      await opendir(directory, { encoding: "buffer" as BufferEncoding }).catch(
        (cause: unknown) => {
          const code = hostErrorCode(cause);
          if (directory !== root && (code === "EACCES" || code === "EPERM"))
            throw new DirectoryArtifactEntryAccessDenied(
              code,
              relative(root, directory).split(sep).join("/"),
              directoryIoFailure("open directory", directory, cause).message,
              { cause },
            );
          throw directoryIoFailure(
            "open directory",
            directory,
            cause,
            directory === root
              ? DirectoryArtifactRootFailure
              : ArtifactReaderFailure,
          );
        },
      ),
    );
    this.#directories.add(handle);
    const childDirectories: string[] = [];
    let traversal:
      | { readonly kind: "complete" }
      | { readonly kind: "failed"; readonly cause: unknown } = {
      kind: "complete",
    };
    try {
      for (;;) {
        await withDirectoryIoContext("inspect directory", directory, () =>
          assertContainedDirectory(root, directory, admittedRoot.identity),
        );
        const child = await handle.handle.read();
        if (child === null) break;
        examine();
        abortIfNeeded(signal);
        const decoded = decodeDirectoryEntryName(child.name);
        if (decoded.kind === "unrepresentable") {
          noteUnrepresentableName(decoded.rawHex);
          continue;
        }
        const absolute = join(directory, decoded.name);
        const metadata = await lstat(absolute, { bigint: true }).catch(
          (cause: unknown) => {
            throw directoryIoFailure("inspect entry", absolute, cause);
          },
        );
        const path = relative(root, absolute).split(sep).join("/");
        const entry = artifactEntry(path, absolute, metadata);
        if (entry === undefined) {
          options?.onOmission?.({ path, kind: unsupportedEntryKind(metadata) });
          continue;
        }
        yield entry;
        if (entry.kind === "directory") {
          if (options?.descendInto?.(path) ?? true)
            childDirectories.push(absolute);
          else options?.onOmission?.({ path, kind: "directory-descendants" });
        }
      }
    } catch (cause: unknown) {
      traversal = {
        kind: "failed",
        cause:
          cause instanceof ArtifactReaderFailure
            ? cause
            : directoryIoFailure("read directory", directory, cause),
      };
    } finally {
      await this.#finishDirectory(handle, directory, traversal);
    }
    if (traversal.kind === "failed") throw traversal.cause;
    childDirectories.reverse();
    pending.push(...childDirectories);
  }

  async #finishDirectory(
    handle: OwnedDirectoryHandle,
    path: string,
    traversal:
      | { readonly kind: "complete" }
      | { readonly kind: "failed"; readonly cause: unknown },
  ): Promise<void> {
    try {
      await handle.close();
      this.#directories.delete(handle);
    } catch (cause: unknown) {
      const closeFailure = directoryIoFailure("close directory", path, cause);
      if (traversal.kind === "failed")
        throw ArtifactReaderFailure.withCleanup(
          traversal.cause,
          ArtifactReaderFailure.cleanupObservation(closeFailure, path),
        );
      throw closeFailure;
    }
  }

  async #openFile(
    entry: ArtifactEntry,
    signal?: AbortSignal,
  ): Promise<OwnedFileHandle<FileHandle>> {
    abortIfNeeded(signal);
    await this.#validateRoot();
    if (entry.kind !== "file")
      throw new ArtifactReaderFailure(
        "format",
        "Only regular files can be opened",
      );
    const fileHandle = await open(
      entry.adapterKey,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    ).catch((cause: unknown) => {
      throw entryOpenFailure(entry, cause);
    });
    const owner = new OwnedFileHandle(fileHandle);
    this.#files.set(owner, entry.adapterKey);
    try {
      const observed = await owner.handle
        .stat({ bigint: true })
        .catch((cause: unknown) => {
          throw directoryIoFailure(
            "inspect opened entry",
            entry.adapterKey,
            cause,
          );
        });
      if (
        !observed.isFile() ||
        !sameArtifactSourceIdentity(entry.sourceIdentity, observed)
      ) {
        throw new ArtifactReaderFailure(
          "integrity",
          `Directory entry changed before open: ${entry.path}`,
        );
      }
      abortIfNeeded(signal);
      return owner;
    } catch (cause: unknown) {
      try {
        await this.#closeFile(owner);
      } catch (closeCause: unknown) {
        throw ArtifactReaderFailure.withCleanup(
          cause,
          ArtifactReaderFailure.cleanupObservation(
            directoryIoFailure(
              "close opened entry",
              entry.adapterKey,
              closeCause,
            ),
            entry.adapterKey,
          ),
        );
      }
      throw cause;
    }
  }

  async #validateRoot(): Promise<void> {
    const root = await this.#resolveRoot();
    await withDirectoryIoContext(
      "inspect artifact root",
      root.canonicalPath,
      () =>
        assertContainedDirectory(
          root.canonicalPath,
          root.canonicalPath,
          root.identity,
          "integrity",
        ),
    );
  }

  /** Borrow an admitted entry for bounded random reads; retain failed cleanup. */
  async inspectFile<Value>(
    entry: ArtifactEntry,
    inspect: (file: FileHandle) => Promise<Value>,
    signal?: AbortSignal,
  ): Promise<Value> {
    const owner = await this.#openFile(entry, signal);
    try {
      const value = await withOwnedFileHandle(
        entry.adapterKey,
        owner,
        signal === undefined ? {} : { signal },
        async (file) => {
          let outcome:
            | { kind: "completed"; value: Value }
            | { kind: "failed"; cause: unknown };
          try {
            outcome = { kind: "completed", value: await inspect(file) };
          } catch (cause: unknown) {
            outcome = { kind: "failed", cause };
          }
          const [opened, named] = await Promise.all([
            file.stat({ bigint: true }),
            lstat(entry.adapterKey, { bigint: true }),
            this.#validateRoot(),
          ]).catch((validationCause: unknown) => {
            if (outcome.kind !== "failed") throw validationCause;
            throw new ArtifactReaderFailure(
              "io",
              `Directory inspection failed: ${failureMessage(outcome.cause)}; final source identity could not be validated: ${failureMessage(validationCause)}`,
              {
                cause: new AggregateError(
                  [outcome.cause, validationCause],
                  "Directory inspection and final source validation failed",
                ),
              },
            );
          });
          if (
            !opened.isFile() ||
            !named.isFile() ||
            !sameArtifactSourceIdentity(entry.sourceIdentity, opened) ||
            !sameArtifactSourceIdentity(entry.sourceIdentity, named)
          )
            throw new ArtifactReaderFailure(
              "integrity",
              `Directory entry changed during inspection: ${entry.path}${outcome.kind === "failed" ? `; inspection failed: ${failureMessage(outcome.cause)}` : ""}`,
              outcome.kind === "failed" ? { cause: outcome.cause } : {},
            );
          if (outcome.kind === "failed") throw outcome.cause;
          abortIfNeeded(signal);
          return outcome.value;
        },
      );
      this.#files.delete(owner);
      return value;
    } catch (cause: unknown) {
      if (cause instanceof RegularFileCleanupFailure) {
        const lease = new AnalysisCleanupLease(
          () => this.#closeFile(owner),
          [entry.adapterKey],
        );
        this.#fileCleanup.set(owner, lease);
        throw new ArtifactFileCleanupFailure(cause, lease);
      }
      this.#files.delete(owner);
      if (cause instanceof RegularFileCancelled)
        throw new ArtifactFileCancelled(cause);
      if (cause instanceof RegularFileOperationCancelled)
        throw new ArtifactReaderFailure(
          "cancelled",
          "Directory inspection cancelled",
          { cause: cause.reason },
        );
      throw directoryIoFailure("inspect entry", entry.adapterKey, cause);
    }
  }

  async open(entry: ArtifactEntry, signal?: AbortSignal): Promise<Readable> {
    const owner = await this.#openFile(entry, signal);
    const source = Readable.from(
      mapStableFileRead(
        owner.handle,
        entry,
        () => this.#validateRoot(),
        signal,
      ),
      { objectMode: false },
    );
    source.once("close", () => {
      void this.#closeFile(owner).catch(() => undefined);
    });
    return source;
  }

  async close(): Promise<void> {
    const failures: unknown[] = [];
    for (const [owner, path] of this.#files) {
      try {
        const lease = this.#fileCleanup.get(owner);
        if (lease === undefined) await this.#closeFile(owner);
        else await lease.release();
      } catch (cause: unknown) {
        failures.push(directoryIoFailure("close opened entry", path, cause));
      }
    }
    for (const owner of this.#directories) {
      try {
        await owner.close();
        this.#directories.delete(owner);
      } catch (cause: unknown) {
        failures.push(
          directoryIoFailure("close directory", owner.handle.path, cause),
        );
      }
    }
    if (failures.length > 0) {
      const reason = failures.map(failureMessage).join("; ");
      throw new ArtifactReaderFailure(
        "io",
        `Directory artifact cleanup failed: ${reason}`,
        {
          cause: new AggregateError(failures),
          cleanup: {
            reason,
            resources: [
              ...this.#files.values(),
              ...[...this.#directories].map((owner) => owner.handle.path),
            ],
          },
        },
      );
    }
  }

  async #closeFile(owner: OwnedFileHandle<FileHandle>): Promise<void> {
    await owner.close();
    this.#files.delete(owner);
    this.#fileCleanup.delete(owner);
  }

  provenance(): readonly [] {
    return [];
  }
}

const unsupportedEntryKind = (
  metadata: BigIntStats,
): ArtifactTraversalOmission["kind"] =>
  metadata.isFIFO()
    ? "fifo"
    : metadata.isSocket()
      ? "socket"
      : metadata.isBlockDevice()
        ? "block-device"
        : metadata.isCharacterDevice()
          ? "character-device"
          : "unsupported";

const artifactEntry = (
  path: string,
  absolute: string,
  metadata: BigIntStats,
): DirectoryArtifactEntry | undefined => {
  const kind = metadata.isSymbolicLink()
    ? "symlink"
    : metadata.isDirectory()
      ? "directory"
      : metadata.isFile()
        ? "file"
        : undefined;
  if (kind === undefined) return undefined;
  return {
    path,
    kind,
    declaredSize: kind === "file" ? safeArtifactSize(metadata.size) : null,
    compressedSize: null,
    executable: hostExecutableMarking(absolute, metadata),
    encrypted: false,
    byteOffset: null,
    declaredIntegrity: null,
    unpacked: false,
    limitations:
      kind === "symlink"
        ? ["Symlink target was not followed or disclosed."]
        : [],
    adapterKey: absolute,
    ...(kind === "file"
      ? {
          sourceIdentity: {
            device: metadata.dev,
            inode: metadata.ino,
            size: metadata.size,
            mode: metadata.mode,
            mtimeNs: metadata.mtimeNs,
            ctimeNs: metadata.ctimeNs,
          },
        }
      : {}),
  };
};

const safeArtifactSize = (size: bigint): number | null => {
  if (size < 0n || size > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(size);
};

const directoryIoFailure = (
  operation: string,
  path: string,
  cause: unknown,
  Failure: typeof ArtifactReaderFailure = ArtifactReaderFailure,
): ArtifactReaderFailure => {
  if (cause instanceof ArtifactReaderFailure) return cause;
  const code = hostErrorCode(cause);
  const suffix = code === undefined ? "" : ` (${code})`;
  const detail = failureMessage(cause);
  return new Failure(
    "io",
    `Could not ${operation} at ${path}${suffix}: ${detail}`,
    {
      cause,
    },
  );
};

/** The host errno a lower-level failure reported, when it reported one. */
const hostErrorCode = (cause: unknown): string | undefined =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  typeof cause.code === "string"
    ? cause.code
    : undefined;

/**
 * Report a refused entry open as the host's read-access denial so the consumer
 * that owns the caller's selection can classify it without re-reading text.
 */
const entryOpenFailure = (
  entry: ArtifactEntry,
  cause: unknown,
): ArtifactReaderFailure => {
  const failure = directoryIoFailure("open entry", entry.adapterKey, cause);
  const code = hostErrorCode(cause);
  return code === "EACCES" || code === "EPERM"
    ? new DirectoryArtifactEntryAccessDenied(
        code,
        entry.path,
        failure.message,
        { cause },
      )
    : failure;
};

const failureMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const mapStableFileRead = async function* (
  handle: FileHandle,
  entry: ArtifactEntry,
  validateRoot: () => Promise<void>,
  signal?: AbortSignal,
): AsyncGenerator<Buffer> {
  let bytes = 0n;
  try {
    const expectedBytes = entry.sourceIdentity?.size;
    if (expectedBytes === undefined)
      throw new ArtifactReaderFailure(
        "integrity",
        `Directory entry has no captured file state: ${entry.path}`,
      );
    for await (const chunk of readArtifactFileChunks(handle, {
      // Include one extra byte so a growing file cannot make this read unbounded.
      end: expectedBytes,
      signal,
    })) {
      abortIfNeeded(signal);
      bytes += BigInt(chunk.length);
      yield chunk;
    }
    abortIfNeeded(signal);
    const [opened, current] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(entry.adapterKey, { bigint: true }),
      validateRoot(),
    ]);
    abortIfNeeded(signal);
    if (
      !opened.isFile() ||
      !current.isFile() ||
      !sameArtifactSourceIdentity(entry.sourceIdentity, opened) ||
      !sameArtifactSourceIdentity(entry.sourceIdentity, current) ||
      bytes !== expectedBytes
    )
      throw new ArtifactReaderFailure(
        "integrity",
        `Directory entry changed during read: ${entry.path}`,
      );
  } catch (cause: unknown) {
    if (
      cause instanceof Error &&
      "code" in cause &&
      ["ENOENT", "ENOTDIR", "ELOOP"].includes(String(cause.code))
    )
      throw new ArtifactReaderFailure(
        "integrity",
        `Directory entry changed during read: ${entry.path}`,
        { cause },
      );
    if (!(cause instanceof ArtifactReaderFailure))
      throw directoryIoFailure("validate read entry", entry.adapterKey, cause);
    throw cause;
  }
};

const withDirectoryIoContext = async <T>(
  operation: string,
  path: string,
  action: () => Promise<T>,
): Promise<T> => {
  try {
    return await action();
  } catch (cause: unknown) {
    throw directoryIoFailure(operation, path, cause);
  }
};

const abortIfNeeded = (signal?: AbortSignal): void => {
  if (signal?.aborted === true)
    throw new ArtifactReaderFailure(
      "cancelled",
      "Artifact traversal cancelled",
      { cause: signal.reason },
    );
};

const assertContainedDirectory = async (
  root: string,
  directory: string,
  rootIdentity: { readonly dev: bigint; readonly ino: bigint } | undefined,
  failureReason: "path" | "integrity" = "path",
): Promise<void> => {
  const canonical = await realpath(directory);
  const fromRoot = relative(root, canonical);
  const metadata = await lstat(directory);
  const currentRoot = await lstat(root, { bigint: true });
  if (
    rootIdentity === undefined ||
    currentRoot.dev !== rootIdentity.dev ||
    currentRoot.ino !== rootIdentity.ino ||
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  )
    throw new ArtifactReaderFailure(
      failureReason,
      "Directory traversal escaped or changed its artifact root",
    );
};
