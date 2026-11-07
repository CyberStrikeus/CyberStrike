import type { FileHandle } from "node:fs/promises";
import { lstat, mkdtemp, open, rm } from "node:fs/promises";
import type { Stats } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OwnedFileHandle } from "../../filesystem/OwnedFileHandle.js";
import {
  openRegularFile,
  RegularFileAdmissionFailure,
  sameRegularFileState,
  type StableRegularFileDescriptor,
} from "../../filesystem/RegularFile.js";
import { ArtifactReaderFailure } from "../ArtifactReader.js";
import {
  ArtifactResourceScope,
  type ArtifactResourceOwner,
} from "../ArtifactResourceScope.js";
import { abortIfNeeded } from "../ArtifactHash.js";
import { readArtifactFileChunks } from "../readArtifactFileChunks.js";
import {
  pyInstallerMemberStream,
  readPyInstallerMemberPrefix,
} from "./PyInstallerMemberStream.js";
import {
  isCArchivePythonModule,
  type CArchiveEntry,
} from "./CArchiveLayout.js";
import type { PyInstallerMember } from "./CArchiveMembers.js";
import { artifactFileAdmissionFailure } from "../ArtifactFileAdmission.js";
import {
  reconstructedPycHeader,
  isHeaderlessPythonCode,
  type CArchiveBytecodeHeader,
} from "./PythonBytecode.js";

// Each outer-compressed image retains one inode and its identity until close.
// This is a per-reader filesystem capacity budget, independent of byte budgets.
const MAX_PRIVATE_PYZ_IMAGES = 128;

interface StoredImage {
  readonly path: string;
  readonly initial: Stats;
}
export interface PyInstallerMemberSource {
  readonly source: Readable;
  readonly verify?: () => Promise<void>;
  readonly close?: (primary?: unknown) => Promise<void>;
}

/** The reader's operation scope drains work before retiring these private files. */
export class PyInstallerPyzStore {
  #root: string | undefined;
  #serial = 0;
  readonly #owners = new Map<
    FileHandle,
    Extract<ArtifactResourceOwner, { kind: "file-handle" }>
  >();
  readonly #cleanup = new ArtifactResourceScope();
  readonly #images = new Map<FileHandle, StoredImage>();

  reserveImages(count: number): void {
    if (count > MAX_PRIVATE_PYZ_IMAGES)
      throw new ArtifactReaderFailure(
        "limit",
        "PyInstaller compressed PYZ images exceed the 128-file private storage budget",
        { boundary: "capacity" },
      );
  }

  async bytecodeHeader(
    handle: FileHandle,
    archiveStart: number,
    entry: CArchiveEntry,
    magic: Buffer | undefined,
    signal?: AbortSignal,
  ): Promise<CArchiveBytecodeHeader> {
    const unchanged = { header: undefined, limitation: undefined };
    if (magic === undefined) return unchanged;
    if (entry.role === "script")
      return { header: reconstructedPycHeader(magic), limitation: undefined };
    if (!isCArchivePythonModule(entry)) return unchanged;
    const prefix = await readPyInstallerMemberPrefix(
      async (active) =>
        (
          await this.memberSource(
            {
              kind: "carchive",
              archiveStart,
              source: entry,
              header: undefined,
            },
            handle,
            active,
          )
        ).source,
      {
        sourceBytes: entry.compressedSize,
        compressed: entry.compressionFlag === 1,
        expectedBytes: entry.uncompressedSize,
        maxBytes: entry.uncompressedSize,
        signal: signal ?? new AbortController().signal,
      },
      4,
    );
    return isHeaderlessPythonCode(prefix)
      ? { header: reconstructedPycHeader(magic), limitation: undefined }
      : {
          header: undefined,
          limitation:
            "CArchive module is not identified as headerless marshal code; its original bytes are preserved without reconstructing a Python bytecode header.",
        };
  }

  async spool(
    handle: FileHandle,
    archiveStart: number,
    entry: CArchiveEntry,
    signal?: AbortSignal,
  ): Promise<{ handle: FileHandle; start: number }> {
    abortIfNeeded(signal);
    if (entry.compressedSize === 0)
      throw new ArtifactReaderFailure(
        "format",
        "Compressed PYZ image has no zlib bytes",
      );
    this.#root ??= await mkdtemp(join(tmpdir(), "rea-pyz-"));
    const path = join(this.#root, String(this.#serial++));
    const writer = await open(path, "wx", 0o600);
    this.#retain(path, new OwnedFileHandle(writer));
    abortIfNeeded(signal);
    const source = readArtifactFileChunks(handle, {
      start: archiveStart + entry.offset,
      end: archiveStart + entry.offset + entry.compressedSize - 1,
      signal,
    });
    const stream = pyInstallerMemberStream(source, {
      sourceBytes: entry.compressedSize,
      compressed: true,
      header: undefined,
      expectedBytes: entry.uncompressedSize,
      maxBytes: entry.uncompressedSize,
      signal: signal ?? new AbortController().signal,
    });
    const copied = this.#writeImage(writer, stream.output, signal);
    const outcomes = await Promise.allSettled([stream.completion, copied]);
    // A failed native write can retire the upstream stream. Preserve that I/O
    // failure instead of replacing it with a secondary premature-close error.
    const copy = outcomes[1];
    if (copy?.status === "rejected") throw copy.reason;
    const decoded = outcomes[0];
    if (decoded?.status === "rejected") throw decoded.reason;
    await this.release(writer);
    abortIfNeeded(signal);
    const { handle: opened, initial } = await this.#admit(path, signal);
    this.#images.set(opened, { path, initial });
    return { handle: opened, start: 0 };
  }

  async release(handle: FileHandle): Promise<void> {
    const owner = this.#owners.get(handle);
    if (owner === undefined) return;
    const outcome = await this.#cleanup.release(owner);
    if (outcome.kind === "failed") throw outcome.cause;
    this.#owners.delete(handle);
  }

  async memberSource(
    read: NonNullable<PyInstallerMember["read"]>,
    root: FileHandle | undefined,
    signal: AbortSignal,
  ): Promise<PyInstallerMemberSource> {
    let handle = read.kind === "carchive" ? root : read.handle;
    if (handle === undefined)
      throw new ArtifactReaderFailure(
        "unavailable",
        "PyInstaller archive is closed",
      );
    const image = read.kind === "pyz" ? this.#images.get(handle) : undefined;
    let verify: (() => Promise<void>) | undefined;
    let close: ((primary?: unknown) => Promise<void>) | undefined;
    if (image !== undefined) {
      ({ handle } = await this.#admit(image.path, signal));
      const opened = handle;
      verify = () => this.#verifyImage(opened, image);
      close = async (primary) => {
        try {
          await this.release(opened);
        } catch (cause: unknown) {
          throw ArtifactReaderFailure.withCleanup(
            primary ?? cause,
            ArtifactReaderFailure.cleanupObservation(cause, image.path),
          );
        }
      };
      await verify();
    }
    abortIfNeeded(signal);
    const start =
      read.kind === "carchive"
        ? read.archiveStart + read.source.offset
        : read.offset;
    const length =
      read.kind === "carchive" ? read.source.compressedSize : read.length;
    const source =
      length === 0
        ? Readable.from([])
        : readArtifactFileChunks(handle, {
            start,
            end: start + length - 1,
            signal,
          });
    source.on("error", () => undefined);
    return {
      source,
      ...(verify === undefined ? {} : { verify }),
      ...(close === undefined ? {} : { close }),
    };
  }

  async close(): Promise<void> {
    await this.#cleanup.close();
    this.#owners.clear();
    if (this.#root !== undefined) {
      try {
        await rm(this.#root, { recursive: true, force: true });
      } catch (cause: unknown) {
        throw ArtifactReaderFailure.withCleanup(
          cause,
          ArtifactReaderFailure.cleanupObservation(cause, this.#root),
        );
      }
      this.#root = undefined;
    }
    this.#images.clear();
  }

  async #admit(
    path: string,
    signal?: AbortSignal,
  ): Promise<StableRegularFileDescriptor> {
    try {
      const source = await openRegularFile(path, {
        symlinks: "reject",
        signal,
      });
      this.#retain(path, new OwnedFileHandle(source.handle));
      return source;
    } catch (cause: unknown) {
      if (cause instanceof RegularFileAdmissionFailure)
        this.#retain(path, cause.owner);
      throw artifactFileAdmissionFailure(path, "PyInstaller", cause);
    }
  }

  #retain(path: string, handle: OwnedFileHandle): void {
    const owner = { kind: "file-handle" as const, resource: path, handle };
    this.#owners.set(handle.handle, owner);
    this.#cleanup.retain(owner);
  }

  async #writeImage(
    handle: FileHandle,
    source: Readable,
    signal?: AbortSignal,
  ): Promise<void> {
    let position = 0;
    for await (const chunk of source as AsyncIterable<Buffer>) {
      // Stop writing after cancellation; drain only already-produced bytes so
      // the descriptor source can report its in-flight I/O outcome truthfully.
      if (signal?.aborted) continue;
      let offset = 0;
      try {
        while (offset < chunk.length) {
          const { bytesWritten } = await handle.write(
            chunk,
            offset,
            chunk.length - offset,
            position,
          );
          if (bytesWritten === 0)
            throw new ArtifactReaderFailure(
              "io",
              "Private PYZ write made no progress",
            );
          offset += bytesWritten;
          position += bytesWritten;
          if (signal?.aborted) break;
        }
      } catch (cause: unknown) {
        const failure =
          cause instanceof ArtifactReaderFailure
            ? cause
            : new ArtifactReaderFailure(
                "io",
                "Private PYZ image could not be written",
                { cause },
              );
        source.destroy(failure);
        throw failure;
      }
    }
    abortIfNeeded(signal);
  }

  async #verifyImage(handle: FileHandle, image: StoredImage): Promise<void> {
    const states = await Promise.all([handle.stat(), lstat(image.path)]);
    if (states.some((state) => !sameRegularFileState(image.initial, state)))
      throw new ArtifactReaderFailure(
        "integrity",
        "Private PYZ image changed after parsing",
      );
  }
}
