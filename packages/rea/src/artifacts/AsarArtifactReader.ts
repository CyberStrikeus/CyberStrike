import { assertArtifactSelectedSource } from "./ArtifactSelectedSource.js";
import { appendCallerPath } from "../filesystem/callerPath.js";
import type { AsarHeaderAdmission } from "../config/asarHeaderAdmission.js";
import { artifactIntegrityDetails } from "../domain/artifactIntegrity.js";
import { constants, createWriteStream, type Stats } from "node:fs";
import {
  lstat,
  mkdtemp,
  open,
  realpath,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  ArtifactEntryContentUnavailable,
  ArtifactReaderFailure,
  copyArtifactEntry,
  sameArtifactEntry,
  type ArtifactEntry,
  type ArtifactReader,
} from "./ArtifactReader.js";
import { closeAsarHandle, readValidatedAsarEntry } from "./AsarEntryStream.js";
import {
  admitAsarHeader,
  readAsarHeader,
  type AsarHeaderExtents,
} from "./AsarHeader.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import type { FileHandleChunkStream } from "../filesystem/readFileHandleChunks.js";
import { readArtifactFileChunks } from "./readArtifactFileChunks.js";
import {
  assertAsarReadActive,
  asarCancellationFailure,
  asarFailure,
} from "./AsarFailure.js";
import { readAsarListing, type AsarListedEntry } from "./AsarListing.js";

/**
 * Electron ASAR reader with strict header decoding and range-streamed member reads.
 *
 * An entry marked `unpacked` is metadata, not an integrity exemption: Electron
 * stores its bytes beside the archive in `<archive>.unpacked`, and callers must
 * hash those companion bytes against the archive's declared integrity value.
 */
export class AsarArtifactReader implements ArtifactReader {
  readonly format = "asar" as const;
  #extents: AsarHeaderExtents | undefined;
  #selectedCanonicalSource: string | undefined;
  readonly #entries = new Map<string, AsarEntryState>();
  readonly #ownedHandles = new Map<SharedAsarFileHandle, OwnedAsarHandle>();
  #snapshot: { readonly path: string; readonly sha256: string } | undefined;
  #snapshotRoot: string | undefined;
  #snapshotOperation: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly options: AsarArtifactReaderOptions = {},
  ) {}

  async *entries(signal?: AbortSignal): AsyncIterable<ArtifactEntry> {
    let paths: readonly AsarListedEntry[];
    try {
      await this.prepareContainer(undefined, signal);
      paths = await this.#withSnapshotOperation(async () => {
        const snapshotPath = this.#snapshotPath();
        this.#resetArchiveState();
        this.#entries.clear();
        const admitted = await this.#admitHeader(snapshotPath, signal);
        this.#extents = {
          archiveBytes: admitted.archiveBytes,
          headerBytes: admitted.headerBytes,
          jsonBytes: admitted.jsonBytes,
        };
        assertAsarReadActive(signal);
        return readAsarListing(admitted.header, signal);
      }, signal);
    } catch (cause: unknown) {
      throw asarFailure(this.path, "inventory", cause);
    }
    for (const facts of paths) {
      assertAsarReadActive(signal);
      const { path, kind } = facts;
      const providerPath = path.split("/").join(sep);
      const entry: ArtifactEntry = {
        path,
        kind,
        declaredSize: facts.size,
        compressedSize: null,
        executable: facts.executable,
        encrypted: false,
        byteOffset: null,
        declaredIntegrity: facts.declaredIntegrity,
        unpacked: facts.unpacked,
        limitations: [
          ...facts.limitations,
          ...(kind === "symlink"
            ? ["ASAR symlink target was not followed or disclosed."]
            : []),
        ],
        adapterKey: providerPath,
      };
      if (facts.kind === "file")
        this.#entries.set(providerPath, {
          facts,
          entry: copyArtifactEntry(entry),
        });
      yield entry;
    }
  }

  async #admitHeader(snapshotPath: string, signal?: AbortSignal) {
    const headerHandle = await this.#openOwned(
      snapshotPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let admission:
      | {
          readonly ok: true;
          readonly value: Awaited<ReturnType<typeof admitAsarHeader>> & {
            readonly header: unknown;
          };
        }
      | { readonly ok: false; readonly cause: unknown };
    try {
      const extents = await admitAsarHeader(
        headerHandle,
        signal,
        this.options.headerAdmission,
      );
      admission = {
        ok: true,
        value: {
          ...extents,
          header: await readAsarHeader(headerHandle, extents, signal),
        },
      };
    } catch (cause: unknown) {
      admission = { ok: false, cause };
    }
    try {
      await this.#closeOwnedHandle(headerHandle);
    } catch (cleanupCause: unknown) {
      if (!admission.ok)
        throw ArtifactReaderFailure.withCleanup(
          admission.cause,
          ArtifactReaderFailure.cleanupObservation(cleanupCause, snapshotPath),
        );
      throw cleanupCause;
    }
    if (!admission.ok) throw admission.cause;
    return admission.value;
  }

  async open(entry: ArtifactEntry, signal?: AbortSignal): Promise<Readable> {
    return this.#withSnapshotOperation(
      () => this.#openEntry(entry, signal),
      signal,
    );
  }

  async #openEntry(
    entry: ArtifactEntry,
    signal?: AbortSignal,
  ): Promise<Readable> {
    assertAsarReadActive(signal);
    const state = this.#entries.get(entry.adapterKey);
    if (state === undefined && entry.kind !== "file")
      throw new ArtifactReaderFailure(
        "format",
        "ASAR entry is not a regular file",
      );
    if (state === undefined)
      throw new ArtifactReaderFailure(
        "integrity",
        `ASAR entry was not produced by this reader: ${entry.path}`,
      );
    if (!sameArtifactEntry(entry, state.entry))
      throw new ArtifactReaderFailure(
        "integrity",
        `ASAR entry metadata changed since inventory: ${state.entry.path}`,
      );
    if (state.entry.unpacked)
      return this.#openUnpackedStream(state.entry, signal);
    return this.#openPackedStream(state, signal);
  }

  async #openPackedStream(
    state: AsarEntryState,
    signal?: AbortSignal,
  ): Promise<Readable> {
    const { facts, entry: producedEntry } = state;
    const archiveSize = this.#extents?.archiveBytes;
    const headerSize = this.#extents?.headerBytes;
    const offset = facts.packedOffset;
    const start =
      offset === undefined || headerSize === undefined
        ? undefined
        : 8 + headerSize + offset;
    if (
      archiveSize === undefined ||
      start === undefined ||
      !Number.isSafeInteger(start) ||
      start > archiveSize ||
      facts.size > archiveSize - start
    )
      throw new ArtifactReaderFailure(
        "format",
        `ASAR entry range is outside its container: ${producedEntry.path}`,
      );
    const snapshotPath = this.#snapshotPath();
    let handle: SharedAsarFileHandle | undefined;
    try {
      const openedHandle = await this.#openOwned(
        snapshotPath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      handle = openedHandle;
      const observed = await openedHandle.stat();
      assertAsarReadActive(signal);
      if (!observed.isFile() || observed.size !== archiveSize)
        throw new ArtifactReaderFailure(
          "integrity",
          `ASAR container changed before read: ${producedEntry.path}`,
        );
      if (facts.size === 0) {
        handle = undefined;
        await closeAsarHandle(
          () => this.#closeOwnedHandle(openedHandle),
          signal,
        );
        return Readable.from([]);
      }
      const source = this.#ownedReadStream(openedHandle, {
        start,
        end: start + facts.size - 1,
        signal,
      });
      handle = undefined;
      const output = readValidatedAsarEntry(
        source,
        facts.size,
        producedEntry.path,
        this.path,
        signal,
      );
      this.#setOwnedOutput(openedHandle, output);
      return output;
    } catch (cause: unknown) {
      const failure = asarFailure(
        this.path,
        `read ${producedEntry.path}`,
        cause,
      );
      if (handle !== undefined) {
        try {
          await this.#closeOwnedHandle(handle);
        } catch (cleanupCause: unknown) {
          throw ArtifactReaderFailure.withCleanup(
            failure,
            ArtifactReaderFailure.cleanupObservation(
              cleanupCause,
              snapshotPath,
            ),
          );
        }
      }
      throw failure;
    }
  }

  /** Capture once per reader lifetime; bind all interpretation to these exact bytes. */
  async prepareContainer(
    expectedSha256?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.#withSnapshotOperation(async () => {
      assertAsarReadActive(signal);
      await this.#validateSelectedArchive();
      if (this.#snapshot === undefined && this.#snapshotRoot !== undefined)
        await this.#closeSnapshot();
      if (this.#snapshot === undefined) await this.#captureSnapshot(signal);
      if (
        expectedSha256 !== undefined &&
        this.#snapshot?.sha256 !== expectedSha256
      )
        throw new ArtifactReaderFailure(
          "integrity",
          `ASAR container changed before interpretation: ${this.path}`,
        );
    }, signal);
  }

  /** Read the same captured container that supplies headers and packed members. */
  async openContainer(signal?: AbortSignal): Promise<Readable> {
    await this.prepareContainer(undefined, signal);
    return this.#withSnapshotOperation(async () => {
      assertAsarReadActive(signal);
      const snapshotPath = this.#snapshotPath();
      const handle = await this.#openOwned(
        snapshotPath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      return this.#ownedReadStream(handle, { signal });
    }, signal);
  }

  async close(): Promise<void> {
    await this.#withSnapshotOperation(() => this.#closeSnapshot());
  }

  async #captureSnapshot(signal?: AbortSignal): Promise<void> {
    let inputHandle: SharedAsarFileHandle | undefined;
    try {
      this.#snapshotRoot = await mkdtemp(join(tmpdir(), "rea-asar-snapshot-"));
      const snapshotPath = join(this.#snapshotRoot, "container.asar");
      const hash = createHash("sha256");
      inputHandle = await this.#openOwned(
        this.path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const source = this.#ownedReadStream(inputHandle, {
        signal,
        releaseOnClose: false,
      });
      const digesting = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(
        source,
        digesting,
        createWriteStream(snapshotPath, { flags: "wx", mode: 0o600 }),
      );
      const completedInput = inputHandle;
      inputHandle = undefined;
      await this.#closeOwnedHandle(completedInput);
      assertAsarReadActive(signal);
      this.#snapshot = { path: snapshotPath, sha256: hash.digest("hex") };
    } catch (cause: unknown) {
      let failure = asarFailure(this.path, "snapshot", cause);
      if (inputHandle !== undefined) {
        const failedInput = inputHandle;
        inputHandle = undefined;
        try {
          await this.#closeOwnedHandle(failedInput);
        } catch (cleanupCause: unknown) {
          failure = ArtifactReaderFailure.withCleanup(
            failure,
            ArtifactReaderFailure.cleanupObservation(cleanupCause, this.path),
          );
        }
      }
      try {
        if (this.#ownedHandles.size === 0) await this.#closeSnapshot();
      } catch (cleanupCause: unknown) {
        throw ArtifactReaderFailure.withCleanup(
          failure,
          ArtifactReaderFailure.cleanupObservation(
            cleanupCause,
            this.#snapshotRoot ?? this.path,
          ),
        );
      }
      throw failure;
    }
  }

  async #closeSnapshot(): Promise<void> {
    await this.#closeOwnedHandles();
    const root = this.#snapshotRoot;
    if (root !== undefined) {
      try {
        await (this.options.removeSnapshot ?? defaultRemoveSnapshot)(root);
        if (this.#snapshotRoot === root) this.#snapshotRoot = undefined;
      } catch (cause: unknown) {
        throw ArtifactReaderFailure.withCleanup(cause, {
          reason: `Could not remove ASAR snapshot: ${root}`,
          resources: [root],
        });
      }
    }
    if (root === undefined || this.#snapshotRoot === undefined) {
      this.#snapshot = undefined;
      this.#resetArchiveState();
      this.#entries.clear();
    }
  }

  async #withSnapshotOperation<Value>(
    operation: () => Promise<Value>,
    signal?: AbortSignal,
  ): Promise<Value> {
    const previous = this.#snapshotOperation;
    let release!: () => void;
    this.#snapshotOperation = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await waitForOperation(previous, signal);
    } catch (cause: unknown) {
      void previous.then(release, release);
      throw cause;
    }
    try {
      assertAsarReadActive(signal);
      return await operation();
    } finally {
      release();
    }
  }

  #snapshotPath(): string {
    if (this.#snapshot === undefined)
      throw new ArtifactReaderFailure(
        "integrity",
        "ASAR snapshot is not available",
      );
    return this.#snapshot.path;
  }

  provenance(): readonly [] {
    return [];
  }

  /** A selected companion cannot silently migrate to another packed target. */
  async #validateSelectedArchive(): Promise<void> {
    const selected = this.options.selectedPath;
    if (selected === undefined) return;
    // The packed pathname is fixed for this reader; member checks only need
    // to re-observe the caller's independently selected alias.
    this.#selectedCanonicalSource ??= await realpath(this.path);
    await assertArtifactSelectedSource(this.#selectedCanonicalSource, selected);
  }

  async #openUnpackedStream(
    entry: ArtifactEntry,
    signal?: AbortSignal,
  ): Promise<Readable> {
    const unpackedRoot = `${this.options.selectedPath ?? this.path}.unpacked`;
    let handle: SharedAsarFileHandle | undefined;
    try {
      await this.#validateSelectedArchive();
      const rootMetadata = await lstat(unpackedRoot);
      if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink())
        throw new ArtifactReaderFailure(
          "path",
          "ASAR unpacked companion is not a regular directory",
        );
      const canonicalRoot = await realpath(unpackedRoot);
      const candidate = appendCallerPath(unpackedRoot, entry.adapterKey);
      const canonical = await realpath(candidate);
      const relativePath = relative(canonicalRoot, canonical);
      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${sep}`) ||
        isAbsolute(relativePath)
      )
        throw new ArtifactReaderFailure(
          "path",
          `ASAR unpacked entry escaped its companion directory: ${entry.path}`,
        );
      const pathMetadata = await lstat(candidate);
      if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink())
        throw new ArtifactReaderFailure(
          "path",
          `ASAR unpacked entry is not a regular file: ${entry.path}`,
        );
      handle = await (this.options.openUnpackedFile ?? open)(
        canonical,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const openedHandle = handle;
      this.#adoptHandle(openedHandle, canonical);
      const openedMetadata = await openedHandle.stat();
      if (
        !openedMetadata.isFile() ||
        openedMetadata.dev !== pathMetadata.dev ||
        openedMetadata.ino !== pathMetadata.ino
      ) {
        throw new ArtifactReaderFailure(
          "integrity",
          `ASAR unpacked entry changed before read: ${entry.path}`,
          {},
          artifactIntegrityDetails(
            entry.path,
            entry.declaredIntegrity,
            null,
            true,
          ),
        );
      }
      assertAsarReadActive(signal);
      const source = this.#ownedReadStream(openedHandle, { start: 0, signal });
      handle = undefined;
      const output = readValidatedAsarEntry(
        source,
        undefined,
        entry.path,
        this.path,
        signal,
      );
      this.#setOwnedOutput(openedHandle, output);
      return output;
    } catch (cause: unknown) {
      let failure = asarUnpackedEntryFailure(this.path, entry, cause);
      if (handle !== undefined && this.#ownedHandles.has(handle)) {
        try {
          await this.#closeOwnedHandle(handle);
        } catch (cleanupCause: unknown) {
          failure = ArtifactReaderFailure.withCleanup(
            failure,
            ArtifactReaderFailure.cleanupObservation(
              cleanupCause,
              this.#ownedHandles.get(handle)?.path ?? entry.path,
            ),
          );
        }
      }
      throw failure;
    }
  }

  async #closeOwnedHandle(handle: SharedAsarFileHandle): Promise<void> {
    const owned = this.#ownedHandles.get(handle);
    if (owned === undefined) return;
    owned.output?.destroy();
    owned.source?.destroy();
    try {
      await owned.owner.close();
    } catch (cause: unknown) {
      throw ArtifactReaderFailure.withCleanup(
        cause,
        ArtifactReaderFailure.cleanupObservation(cause, owned.path),
      );
    }
    this.#ownedHandles.delete(handle);
  }

  async #closeOwnedHandles(): Promise<void> {
    let failure: ArtifactReaderFailure | undefined;
    for (const [handle, owned] of this.#ownedHandles) {
      try {
        await this.#closeOwnedHandle(handle);
      } catch (cause: unknown) {
        failure = ArtifactReaderFailure.withCleanup(
          failure ?? cause,
          ArtifactReaderFailure.cleanupObservation(cause, owned.path),
        );
      }
    }
    if (failure !== undefined) throw failure;
  }

  async #openOwned(path: string, flags: number): Promise<SharedAsarFileHandle> {
    const handle = await (this.options.openFile ?? open)(path, flags);
    this.#adoptHandle(handle, path);
    return handle;
  }

  #adoptHandle(handle: SharedAsarFileHandle, path: string): void {
    this.#ownedHandles.set(handle, {
      path,
      owner: new OwnedFileHandle(handle),
    });
  }

  #ownedReadStream(
    handle: SharedAsarFileHandle,
    options: {
      readonly start?: number;
      readonly end?: number;
      readonly signal?: AbortSignal | undefined;
      readonly releaseOnClose?: boolean;
    },
  ): FileHandleChunkStream {
    const { releaseOnClose, ...readOptions } = options;
    const source = readArtifactFileChunks(handle, readOptions);
    const owned = this.#ownedHandles.get(handle);
    if (owned === undefined)
      throw new ArtifactReaderFailure("integrity", "ASAR handle has no owner");
    owned.source = source;
    owned.output = source;
    if (releaseOnClose !== false)
      source.once("close", () => {
        void this.#closeOwnedHandle(handle).catch(() => undefined);
      });
    return source;
  }

  #setOwnedOutput(handle: SharedAsarFileHandle, output: Readable): void {
    const owned = this.#ownedHandles.get(handle);
    if (owned !== undefined) owned.output = output;
  }

  #resetArchiveState(): void {
    this.#extents = undefined;
  }
}

type AsarEntryState = {
  readonly facts: Extract<AsarListedEntry, { readonly kind: "file" }>;
  readonly entry: ArtifactEntry;
};
type SharedAsarFileHandle = Pick<FileHandle, "fd" | "read" | "close"> & {
  stat(): Promise<Stats>;
};
type OpenAsarFile = (
  path: string,
  flags: number,
) => Promise<SharedAsarFileHandle>;
type OwnedAsarHandle = {
  readonly path: string;
  readonly owner: OwnedFileHandle<SharedAsarFileHandle>;
  source?: Readable;
  output?: Readable;
};
export type AsarArtifactReaderOptions = {
  /** Header/index admission resolved by the caller's composition root; default otherwise. */
  readonly headerAdmission?: AsarHeaderAdmission;
  /** Companion selected by the caller archive spelling, independently of packed identity. */
  readonly selectedPath?: string;
  readonly openFile?: OpenAsarFile;
  readonly openUnpackedFile?: OpenAsarFile;
  readonly removeSnapshot?: (path: string) => Promise<void>;
};

const defaultRemoveSnapshot = (path: string): Promise<void> =>
  rm(path, { recursive: true, force: true });

const asarUnpackedEntryFailure = (
  archivePath: string,
  entry: ArtifactEntry,
  cause: unknown,
): ArtifactReaderFailure => {
  if (cause instanceof ArtifactReaderFailure) return cause;
  if (entry.unpacked && isMissingFile(cause))
    return new ArtifactEntryContentUnavailable(
      `ASAR unpacked entry bytes are unavailable: ${entry.path}`,
      "ASAR unpacked companion bytes were unavailable; no content hash or child artifact was produced.",
      { cause },
      artifactIntegrityDetails(entry.path, entry.declaredIntegrity, null, true),
    );
  return asarFailure(archivePath, `read ${entry.path}`, cause);
};

const waitForOperation = async (
  operation: Promise<void>,
  signal?: AbortSignal,
): Promise<void> => {
  if (signal === undefined) return operation;
  assertAsarReadActive(signal);
  await new Promise<void>((resolve, reject) => {
    const removeAbortListener = (): void =>
      signal.removeEventListener("abort", onAbort);
    const onAbort = (): void => {
      removeAbortListener();
      reject(asarCancellationFailure(signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      () => {
        removeAbortListener();
        resolve();
      },
      (cause: unknown) => {
        removeAbortListener();
        reject(cause);
      },
    );
  });
};

const isMissingFile = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  cause.code === "ENOENT";
