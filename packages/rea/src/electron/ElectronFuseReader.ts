import { observeMzWindowsHeader } from "../domain/dosMz.js";
import { readPeCoffHeader } from "../domain/peCoffHeader.js";
import { readElfFixedHeader } from "../domain/elfFixedHeader.js";
import { decodePeMachine } from "../domain/peMachine.js";
import type { ResolvedElectronFuseFile } from "./ElectronFusePath.js";
import { createHash } from "node:crypto";
import { lstat, type FileHandle } from "node:fs/promises";

import { readMachoImage } from "../artifacts/apple/MachoLoadCommandReader.js";
import { readFileHandleRange } from "../filesystem/readFileHandleRange.js";
import {
  hasMachoMagic,
  readFatHeaderPrefix,
} from "../domain/apple/machoContainer.js";
import type { ReadAt } from "../artifacts/apple/MachoLoadCommandReader.js";
import {
  electronFuseName,
  electronFuseState,
  ELECTRON_FUSE_SENTINEL,
  type ElectronFuseSentinel,
  type ElectronFuseSlice,
} from "../domain/electron/electronFuses.js";
import { machoImageSlices } from "../domain/apple/dylibResolution.js";
import {
  RegularFileChangedError,
  sameRegularFileState,
} from "../filesystem/RegularFile.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import {
  assertArtifactReadActive,
  withArtifactRegularFile,
} from "../artifacts/ArtifactFileOperation.js";

/** Admission and search bounds for one Electron executable. */
export const ELECTRON_FUSE_LIMITS = {
  maximumFileBytes: 1024 * 1024 * 1024,
  chunkBytes: 256 * 1024,
  maximumSentinelsPerSlice: 32,
  maximumPeHeaderOffset: 1024 * 1024,
} as const;

const SENTINEL = Buffer.from(ELECTRON_FUSE_SENTINEL, "ascii");

/** Container identity and per-slice fuse wires. Offsets are file-absolute. */
export interface ElectronFuseImage {
  readonly sha256: string;
  readonly bytes: number;
  readonly format: "mach-o" | "mach-o-universal" | "pe" | "elf";
  readonly slices: readonly ElectronFuseSlice[];
}

type ElectronFuseContainerFormat = ElectronFuseImage["format"];

interface SliceRange {
  readonly index: number;
  readonly fileOffset: number;
  readonly size: number;
  readonly architecture: string | null;
  readonly hidden?: boolean;
}

/** The selected container is malformed or outside the supported formats. */
export class ElectronFuseFormatFailure extends Error {
  constructor(
    readonly kind: "malformed" | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "ElectronFuseFormatFailure";
  }
}

/** A measured bound was hit before a complete fuse report could be returned. */
export class ElectronFuseResourceFailure extends Error {
  constructor(
    readonly boundary: "file-size" | "capacity",
    message: string,
  ) {
    super(message);
    this.name = "ElectronFuseResourceFailure";
  }
}

/**
 * Hash one admitted regular file and search each slice for the fuse sentinel.
 * The search keeps only a sentinel-sized overlap between chunks.
 */
export const readElectronFuseImage = async (
  path: string,
  options?: {
    readonly signal?: AbortSignal;
    readonly chunkBytes?: number;
    readonly selection?: ResolvedElectronFuseFile;
    readonly resources?: ArtifactResourceScope;
  },
): Promise<ElectronFuseImage> => {
  const signal = options?.signal;
  assertArtifactReadActive(signal);
  const selection = options?.selection;
  const recheckPath = async (candidate: string) => {
    assertArtifactReadActive(signal);
    try {
      const metadata = await lstat(candidate, { bigint: true });
      assertArtifactReadActive(signal);
      return metadata;
    } catch (cause: unknown) {
      if (selection !== undefined && isMissingPath(cause))
        throw new RegularFileChangedError(path);
      throw cause;
    }
  };
  const assertPathNodes = async (): Promise<void> => {
    if (selection === undefined) return;
    if (selection.path !== path) throw new RegularFileChangedError(path);
    for (const node of selection.nodes) {
      const current = await recheckPath(node.path);
      if (
        current.dev !== node.metadata.dev ||
        current.ino !== node.metadata.ino ||
        current.isDirectory() !== node.metadata.isDirectory() ||
        current.isSymbolicLink() !== node.metadata.isSymbolicLink()
      )
        throw new RegularFileChangedError(path);
    }
  };
  await assertPathNodes();
  const before = await recheckPath(path);
  if (
    selection !== undefined &&
    !sameRegularFileState(selection.metadata, before)
  )
    throw new RegularFileChangedError(path);
  if (!before.isFile() || before.isSymbolicLink())
    throw new ElectronFuseFormatFailure(
      "unsupported",
      `Expected a regular file without a symlink: ${path}`,
    );
  if (before.size > BigInt(ELECTRON_FUSE_LIMITS.maximumFileBytes))
    throw new ElectronFuseResourceFailure(
      "file-size",
      `Selected artifact exceeds ${ELECTRON_FUSE_LIMITS.maximumFileBytes} bytes: ${path}`,
    );
  const size = Number(before.size);
  const chunkBytes = options?.chunkBytes ?? ELECTRON_FUSE_LIMITS.chunkBytes;
  if (
    !Number.isSafeInteger(chunkBytes) ||
    chunkBytes < 1 ||
    chunkBytes > ELECTRON_FUSE_LIMITS.chunkBytes
  )
    throw new TypeError(
      `chunkBytes must be an integer between 1 and ${ELECTRON_FUSE_LIMITS.chunkBytes}.`,
    );
  return withArtifactRegularFile(
    path,
    options?.resources ?? new ArtifactResourceScope(),
    signal,
    async ({ handle: owned }) => {
      const opened = await owned.stat({ bigint: true });
      if (!sameRegularFileState(before, opened))
        throw new RegularFileChangedError(path);
      await assertPathNodes();
      const readAt = readerFor(owned, size, path, signal);
      const container = await identifyContainer(readAt, size, path);
      const scanned = await scanSlices(
        owned,
        path,
        size,
        container.slices,
        chunkBytes,
        signal,
      );
      const current = await recheckPath(path);
      if (!sameRegularFileState(before, current))
        throw new RegularFileChangedError(path);
      await assertPathNodes();
      return {
        sha256: scanned.sha256,
        bytes: size,
        format: container.format,
        slices: scanned.slices,
      };
    },
  );
};

/** Sentence describing the file and sentinel bounds enforced by this reader. */
export const electronFuseReadLimitation = (): string =>
  `The selected file is admitted as one regular file of at most 1 GiB. Sentinel search uses ${ELECTRON_FUSE_LIMITS.chunkBytes}-byte windows, and each slice keeps at most ${ELECTRON_FUSE_LIMITS.maximumSentinelsPerSlice} sentinels.`;

const readerFor =
  (
    handle: FileHandle,
    size: number,
    path: string,
    signal: AbortSignal | undefined,
  ): ReadAt =>
  async (offset, length) => {
    assertArtifactReadActive(signal);
    if (length <= 0 || offset < 0 || offset >= size) return new Uint8Array();
    const bounded = Math.min(length, size - offset);
    const buffer = await readFileHandleRange(handle, offset, bounded, () =>
      assertArtifactReadActive(signal),
    );
    if (buffer.length !== bounded) throw new RegularFileChangedError(path);
    return buffer;
  };

const identifyContainer = async (
  readAt: ReadAt,
  size: number,
  path: string,
): Promise<{
  readonly format: ElectronFuseContainerFormat;
  readonly slices: readonly SliceRange[];
}> => {
  const head = await readAt(0, Math.min(size, 8));
  if (hasMachoMagic(head)) return identifyMacho(readAt, size, head, path);
  if (isElf(head)) {
    const header = await readAt(0, 64);
    const parsed = readElfFixedHeader(Buffer.from(header), size);
    return {
      format: "elf",
      slices: [
        {
          index: 0,
          fileOffset: 0,
          size,
          architecture: parsed.ok ? parsed.value.architecture : null,
        },
      ],
    };
  }
  const pe = await identifyPe(readAt, size);
  if (pe !== undefined)
    return {
      format: "pe",
      slices: [
        { index: 0, fileOffset: 0, size, architecture: pe.architecture },
      ],
    };
  throw new ElectronFuseFormatFailure(
    "unsupported",
    `Selected artifact ${path} does not contain a Mach-O, ELF, or PE container.`,
  );
};

const identifyMacho = async (
  readAt: ReadAt,
  size: number,
  head: Uint8Array,
  path: string,
): Promise<{
  readonly format: ElectronFuseContainerFormat;
  readonly slices: readonly SliceRange[];
}> => {
  const facts = await readMachoImage(readAt, size);
  if (facts.status !== "parsed") {
    const reason =
      facts.status === "not-mach-o"
        ? `Selected artifact ${path} does not contain a Mach-O, ELF, or PE container.`
        : facts.reason;
    throw new ElectronFuseFormatFailure(
      facts.status === "malformed" ? "malformed" : "unsupported",
      reason,
    );
  }
  const fat = readFatHeaderPrefix(head);
  const format =
    fat.state === "parsed" || fat.state === "incomplete"
      ? "mach-o-universal"
      : "mach-o";
  const slices = machoImageSlices(facts).map((slice, index) => ({
    index,
    fileOffset: slice.slice_offset,
    size: slice.slice_size,
    architecture: slice.architecture,
    ...(slice.hidden === undefined ? {} : { hidden: slice.hidden }),
  }));
  return {
    format,
    slices,
  };
};

const scanSlices = async (
  handle: FileHandle,
  path: string,
  size: number,
  ranges: readonly SliceRange[],
  chunkBytes: number,
  signal: AbortSignal | undefined,
): Promise<{
  readonly sha256: string;
  readonly slices: readonly ElectronFuseSlice[];
}> => {
  const states = ranges.map((slice) => ({
    slice,
    carry: Buffer.alloc(0),
    hits: [] as number[],
  }));
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(chunkBytes);
  let position = 0;
  while (position < size) {
    assertArtifactReadActive(signal);
    const length = Math.min(chunkBytes, size - position);
    const read = await handle.read(chunk, 0, length, position);
    if (read.bytesRead === 0) throw new RegularFileChangedError(path);
    assertArtifactReadActive(signal);
    const piece = chunk.subarray(0, read.bytesRead);
    hash.update(piece);
    absorbChunk(states, piece, position);
    position += read.bytesRead;
  }
  if (position !== size) throw new RegularFileChangedError(path);
  const slices: ElectronFuseSlice[] = [];
  for (const state of states) {
    const sentinels: ElectronFuseSentinel[] = [];
    for (const offset of state.hits)
      sentinels.push(
        await parseWire(
          handle,
          path,
          offset,
          state.slice.fileOffset + state.slice.size,
          signal,
        ),
      );
    slices.push({
      index: state.slice.index,
      file_offset: state.slice.fileOffset,
      size: state.slice.size,
      architecture: state.slice.architecture,
      ...(state.slice.hidden === undefined
        ? {}
        : { hidden: state.slice.hidden }),
      sentinel_count: sentinels.length,
      sentinels,
    });
  }
  return { sha256: hash.digest("hex"), slices };
};

const absorbChunk = (
  states: readonly {
    readonly slice: SliceRange;
    carry: Buffer;
    readonly hits: number[];
  }[],
  chunk: Buffer,
  position: number,
): void => {
  const chunkEnd = position + chunk.length;
  for (const state of states) {
    const start = Math.max(position, state.slice.fileOffset);
    const end = Math.min(chunkEnd, state.slice.fileOffset + state.slice.size);
    if (start >= end) continue;
    const piece = chunk.subarray(start - position, end - position);
    const carryLength = state.carry.length;
    const window =
      carryLength === 0 ? piece : Buffer.concat([state.carry, piece]);
    const windowFileStart = start - carryLength;
    let from = 0;
    while (from <= window.length - SENTINEL.length) {
      const found = window.indexOf(SENTINEL, from);
      if (found < 0) break;
      const sentinelOffset = windowFileStart + found;
      if (!state.hits.includes(sentinelOffset)) {
        if (state.hits.length >= ELECTRON_FUSE_LIMITS.maximumSentinelsPerSlice)
          throw new ElectronFuseResourceFailure(
            "capacity",
            `Slice ${state.slice.index} contains more than ${ELECTRON_FUSE_LIMITS.maximumSentinelsPerSlice} Electron fuse sentinels.`,
          );
        state.hits.push(sentinelOffset);
      }
      from = found + 1;
    }
    const tail = SENTINEL.length - 1;
    state.carry =
      window.length <= tail
        ? Buffer.from(window)
        : Buffer.from(window.subarray(window.length - tail));
  }
};

const parseWire = async (
  handle: FileHandle,
  path: string,
  sentinelOffset: number,
  sliceEnd: number,
  signal: AbortSignal | undefined,
): Promise<ElectronFuseSentinel> => {
  const wireStart = sentinelOffset + SENTINEL.length;
  const available = sliceEnd - wireStart;
  if (available < 1)
    return {
      sentinel_offset: sentinelOffset,
      wire_version: null,
      declared_length: null,
      fuses: [],
      complete: false,
    };
  const header = await readExact(
    handle,
    path,
    wireStart,
    Math.min(available, 2),
    signal,
  );
  const wireVersion = header[0];
  if (wireVersion === undefined || header.length < 2)
    return {
      sentinel_offset: sentinelOffset,
      wire_version: wireVersion ?? null,
      declared_length: null,
      fuses: [],
      complete: false,
    };
  const declared = header[1] ?? 0;
  const fuseLength = Math.min(declared, available - 2);
  const fuseBytes =
    fuseLength === 0
      ? Buffer.alloc(0)
      : await readExact(handle, path, wireStart + 2, fuseLength, signal);
  return {
    sentinel_offset: sentinelOffset,
    wire_version: wireVersion,
    declared_length: declared,
    fuses: [...fuseBytes].map((raw, index) => ({
      index,
      name: electronFuseName(wireVersion, index),
      state: electronFuseState(raw),
      raw_byte: raw,
    })),
    complete: fuseBytes.length === declared,
  };
};

const readExact = async (
  handle: FileHandle,
  path: string,
  offset: number,
  length: number,
  signal: AbortSignal | undefined,
): Promise<Buffer> => {
  assertArtifactReadActive(signal);
  const buffer = await readFileHandleRange(handle, offset, length, () =>
    assertArtifactReadActive(signal),
  );
  if (buffer.length !== length) throw new RegularFileChangedError(path);
  return buffer;
};

const isElf = (head: Uint8Array): boolean =>
  head.length >= 4 &&
  head[0] === 0x7f &&
  head[1] === 0x45 &&
  head[2] === 0x4c &&
  head[3] === 0x46;

const identifyPe = async (
  readAt: ReadAt,
  size: number,
): Promise<{ readonly architecture: string | null } | undefined> => {
  if (size < 64) return undefined;
  const header = await readAt(0, 64);
  if (header.length < 64 || header[0] !== 0x4d || header[1] !== 0x5a)
    return undefined;
  const prefix = Buffer.from(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  );
  const observed = observeMzWindowsHeader(prefix, size);
  if (observed.state !== "signature-needed" && observed.state !== "declared")
    return undefined;
  const offset = observed.offset;
  if (
    offset < 64 ||
    offset > ELECTRON_FUSE_LIMITS.maximumPeHeaderOffset ||
    offset > size - 4
  )
    return undefined;
  const bytes = Buffer.from(await readAt(offset, 24));
  const confirmed = observeMzWindowsHeader(prefix, size, { offset, bytes });
  if (confirmed.state !== "declared" || confirmed.signature !== "PE")
    return undefined;
  // A signature establishes the existing scan boundary; only a complete COFF
  // header establishes its machine. Managed OS overrides need separate proof.
  const coff = readPeCoffHeader(bytes.subarray(4));
  const machine =
    bytes.length === 24 && coff.ok
      ? decodePeMachine(coff.value.machine)
      : undefined;
  return {
    architecture:
      machine?.nativeOsOverride === false ? machine.architecture : null,
  };
};

const isMissingPath = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  ["ENOENT", "ENOTDIR"].includes(String(cause.code));
