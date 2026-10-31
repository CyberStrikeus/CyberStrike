import { setImmediate } from "node:timers/promises";

import { assertArtifactReadActive } from "../ArtifactFileOperation.js";
import { ArtifactReaderFailure } from "../ArtifactReader.js";

/** Node `SeaBlob::kMagic` from `src/node_sea.h` (v24). */
export const NODE_SEA_MAGIC = 0x143da20;

/** In-memory cap for one injected blob. Larger declarations fail closed. */
export const NODE_SEA_MAX_BLOB_BYTES = 256 * 1024 * 1024;

const FLAG_DISABLE_EXPERIMENTAL_SEA_WARNING = 1 << 0;
const FLAG_USE_SNAPSHOT = 1 << 1;
const FLAG_USE_CODE_CACHE = 1 << 2;
const FLAG_INCLUDE_ASSETS = 1 << 3;
const FLAG_INCLUDE_EXEC_ARGV = 1 << 4;
const KNOWN_FLAGS =
  FLAG_DISABLE_EXPERIMENTAL_SEA_WARNING |
  FLAG_USE_SNAPSHOT |
  FLAG_USE_CODE_CACHE |
  FLAG_INCLUDE_ASSETS |
  FLAG_INCLUDE_EXEC_ARGV;

// Resource bounds checked before records are created, not Node format limits.
// Asset names are budgeted separately because empty bodies make each record
// cost far more retained memory than its blob bytes.
const MAX_ASSET_COUNT = 100_000;
const MAX_ASSET_NAME_BYTES = 8 * 1024 * 1024;
const MAX_EXEC_ARGV = 4096;
const MAX_EXEC_ARGV_TEXT_BYTES = 1024 * 1024;
const NO_OVERRIDE = "This release has no runtime override.";

export const NODE_SEA_BAD_MAGIC = "Node SEA blob magic is not 0x143da20";
export const NODE_SEA_TRUNCATED = "Node SEA blob is truncated";
export const NODE_SEA_UNKNOWN_FLAGS =
  "Node SEA blob flags contain unknown bits";
export const NODE_SEA_UNKNOWN_EXTENSION =
  "Node SEA exec argv extension is unknown";
export const NODE_SEA_TRAILING_BYTES = "Node SEA blob has trailing bytes";
export const NODE_SEA_DUPLICATE_BLOB =
  "Node SEA blob is declared more than once";
export const NODE_SEA_ELF_DESCRIPTOR_TRUNCATED =
  "Node SEA ELF note descriptor is truncated";
export const NODE_SEA_ELF_TABLE_TRUNCATED =
  "Node SEA ELF note table is truncated";
export const NODE_SEA_MACHO_COMMANDS_TRUNCATED =
  "Node SEA Mach-O load commands are truncated";
export const NODE_SEA_MACHO_SEGMENT_TRUNCATED =
  "Node SEA Mach-O segment table is truncated";
export const NODE_SEA_FUSE_ABSENT =
  "Node SEA blob is present but no NODE_SEA_FUSE sentinel was observed";
export const NODE_SEA_FUSE_UNSET =
  "Node SEA blob is present but the NODE_SEA_FUSE sentinel is unset";
export const NODE_SEA_FUSE_CONFLICT = "Node SEA fuse sentinels disagree";
export const NODE_SEA_EMPTY_CODE_PATH = "Node SEA code path is empty";
export const NODE_SEA_INVALID_UTF8 = "Node SEA string is not valid UTF-8";
export const NODE_SEA_ASSET_COUNT = `Node SEA asset count exceeds the ${String(MAX_ASSET_COUNT)}-asset bound. ${NO_OVERRIDE}`;
export const NODE_SEA_ASSET_NAME_BYTES = `Node SEA asset names exceed the ${String(MAX_ASSET_NAME_BYTES)}-byte name budget. ${NO_OVERRIDE}`;
export const NODE_SEA_EXEC_ARGV_COUNT = `Node SEA exec argv count exceeds the ${String(MAX_EXEC_ARGV)}-argument bound. ${NO_OVERRIDE}`;
export const NODE_SEA_EXEC_ARGV_TEXT = `Node SEA exec argv text exceeds the ${String(MAX_EXEC_ARGV_TEXT_BYTES)}-byte bound. ${NO_OVERRIDE}`;
export const NODE_SEA_BLOB_TOO_LARGE = `Node SEA blob exceeds the ${String(NODE_SEA_MAX_BLOB_BYTES)}-byte in-memory bound`;

export const nodeSeaAssetCollision = (name: string): string =>
  `Node SEA asset name collides: ${name}`;

const FUSE_PREFIX = "NODE_SEA_FUSE_";

export interface NodeSeaByteRange {
  readonly offset: number;
  readonly length: number;
}

export interface NodeSeaAsset {
  readonly name: string;
  readonly range: NodeSeaByteRange;
}

export type NodeSeaExecArgvExtension = "none" | "env" | "cli";

/** Decoded Node 24 SEA blob. Ranges are relative to the start of the blob. */
export interface DecodedNodeSeaBlob {
  readonly magic: typeof NODE_SEA_MAGIC;
  readonly flags: number;
  readonly disableExperimentalSeaWarning: boolean;
  readonly useSnapshot: boolean;
  readonly useCodeCache: boolean;
  readonly includeAssets: boolean;
  readonly includeExecArgv: boolean;
  readonly execArgvExtension: NodeSeaExecArgvExtension;
  readonly codePath: string;
  readonly mainScript: NodeSeaByteRange | null;
  readonly snapshot: NodeSeaByteRange | null;
  readonly codeCache: NodeSeaByteRange | null;
  readonly assets: readonly NodeSeaAsset[];
  readonly execArgv: readonly string[];
}

export interface NodeSeaFuseObservation {
  readonly fuseState: "set" | "unset" | "absent" | "conflicting";
  readonly fuseSentinel: string | null;
  readonly fuseContradiction: string | null;
}

const limitFailure = (
  message: string,
  boundary: "capacity" | "memory",
): ArtifactReaderFailure =>
  new ArtifactReaderFailure("limit", message, { boundary });

const formatFailure = (
  message: string,
  cause?: unknown,
): ArtifactReaderFailure =>
  new ArtifactReaderFailure(
    "format",
    message,
    cause === undefined ? undefined : { cause },
  );

/**
 * Decode one SEA blob the way Node 24's `SeaDeserializer` reads it.
 * Lengths are 64-bit little-endian `size_t` values. Trailing zero padding is
 * admitted; any other trailing byte fails closed. 32-bit `size_t` producers
 * are outside this reader.
 */
export const decodeNodeSeaBlob = async (
  bytes: Buffer,
  signal?: AbortSignal,
): Promise<DecodedNodeSeaBlob> => {
  assertArtifactReadActive(signal);
  const cursor = new BlobCursor(bytes);
  if (cursor.remaining < 4) throw formatFailure(NODE_SEA_TRUNCATED);
  const magic = cursor.u32();
  if (magic !== NODE_SEA_MAGIC) throw formatFailure(NODE_SEA_BAD_MAGIC);
  if (cursor.remaining < 5) throw formatFailure(NODE_SEA_TRUNCATED);
  const flags = cursor.u32();
  if ((flags & ~KNOWN_FLAGS) !== 0) throw formatFailure(NODE_SEA_UNKNOWN_FLAGS);
  const execArgvExtension = extensionName(cursor.u8());
  const codePath = cursor.text(false, NODE_SEA_EMPTY_CODE_PATH);
  const useSnapshot = (flags & FLAG_USE_SNAPSHOT) !== 0;
  const body = cursor.byteRange();
  const useCodeCache = (flags & FLAG_USE_CODE_CACHE) !== 0;
  const codeCache = useCodeCache ? cursor.byteRange() : null;
  const includeAssets = (flags & FLAG_INCLUDE_ASSETS) !== 0;
  const assets = includeAssets ? await cursor.assets(signal) : [];
  const includeExecArgv = (flags & FLAG_INCLUDE_EXEC_ARGV) !== 0;
  const execArgv = includeExecArgv ? await cursor.execArgv(signal) : [];
  if (await cursor.hasNonZeroTail(signal))
    throw formatFailure(NODE_SEA_TRAILING_BYTES);
  return {
    magic: NODE_SEA_MAGIC,
    flags,
    disableExperimentalSeaWarning:
      (flags & FLAG_DISABLE_EXPERIMENTAL_SEA_WARNING) !== 0,
    useSnapshot,
    useCodeCache,
    includeAssets,
    includeExecArgv,
    execArgvExtension,
    codePath,
    mainScript: useSnapshot ? null : body,
    snapshot: useSnapshot ? body : null,
    codeCache,
    assets,
    execArgv,
  };
};

/** Classify every observed `NODE_SEA_FUSE_<32 lowercase hex>:[01]` sentinel. */
export const observeNodeSeaFuseMatches = (
  matches: readonly string[],
): NodeSeaFuseObservation => {
  const unique = [...new Set(matches)];
  if (unique.length === 0)
    return {
      fuseState: "absent",
      fuseSentinel: null,
      fuseContradiction: NODE_SEA_FUSE_ABSENT,
    };
  const hashes = new Set(
    unique.map((item) =>
      item.slice(FUSE_PREFIX.length, FUSE_PREFIX.length + 32),
    ),
  );
  const digits = new Set(unique.map((item) => item.at(-1)));
  if (hashes.size !== 1 || digits.size !== 1)
    return {
      fuseState: "conflicting",
      fuseSentinel: null,
      fuseContradiction: NODE_SEA_FUSE_CONFLICT,
    };
  const sentinel = unique[0];
  if (sentinel === undefined) throw formatFailure(NODE_SEA_FUSE_CONFLICT);
  if (digits.has("1"))
    return {
      fuseState: "set",
      fuseSentinel: sentinel,
      fuseContradiction: null,
    };
  return {
    fuseState: "unset",
    fuseSentinel: sentinel,
    fuseContradiction: NODE_SEA_FUSE_UNSET,
  };
};

const extensionName = (value: number): NodeSeaExecArgvExtension => {
  if (value === 0) return "none";
  if (value === 1) return "env";
  if (value === 2) return "cli";
  throw formatFailure(NODE_SEA_UNKNOWN_EXTENSION);
};

/** Sequential little-endian reader over one owned blob buffer. */
class BlobCursor {
  #offset = 0;

  constructor(private readonly bytes: Buffer) {}

  get remaining(): number {
    return this.bytes.length - this.#offset;
  }

  u32(): number {
    return this.#demand(4).readUInt32LE(0);
  }

  u8(): number {
    return this.#demand(1).readUInt8(0);
  }

  /** `charge` sees the raw byte length before decoding allocates a string. */
  text(
    allowEmpty: boolean,
    emptyMessage: string,
    charge?: (bytes: number) => void,
  ): string {
    const length = this.#size();
    charge?.(length);
    const raw = this.#demand(length);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        raw,
      );
    } catch (cause: unknown) {
      throw formatFailure(NODE_SEA_INVALID_UTF8, cause);
    }
    if (!allowEmpty && text.length === 0) throw formatFailure(emptyMessage);
    return text;
  }

  byteRange(): NodeSeaByteRange {
    const length = this.#size();
    const offset = this.#offset;
    this.#offset += length;
    return { offset, length };
  }

  async assets(signal?: AbortSignal): Promise<NodeSeaAsset[]> {
    const count = this.#count(MAX_ASSET_COUNT, NODE_SEA_ASSET_COUNT);
    if (count * 16 > this.remaining) throw formatFailure(NODE_SEA_TRUNCATED);
    const seen = new Set<string>();
    const assets: NodeSeaAsset[] = [];
    let nameBytes = 0;
    const charge = (bytes: number): void => {
      nameBytes += bytes;
      if (nameBytes > MAX_ASSET_NAME_BYTES)
        throw limitFailure(NODE_SEA_ASSET_NAME_BYTES, "memory");
    };
    for (let index = 0; index < count; index += 1) {
      if (index % 256 === 0) {
        await setImmediate();
        assertArtifactReadActive(signal);
      }
      const name = this.text(true, NODE_SEA_INVALID_UTF8, charge);
      if (seen.has(name)) throw formatFailure(nodeSeaAssetCollision(name));
      seen.add(name);
      assets.push({ name, range: this.byteRange() });
    }
    return assets;
  }

  async execArgv(signal?: AbortSignal): Promise<string[]> {
    const count = this.#count(MAX_EXEC_ARGV, NODE_SEA_EXEC_ARGV_COUNT);
    if (count * 8 > this.remaining) throw formatFailure(NODE_SEA_TRUNCATED);
    const values: string[] = [];
    let textBytes = 0;
    const charge = (bytes: number): void => {
      textBytes += bytes;
      if (textBytes > MAX_EXEC_ARGV_TEXT_BYTES)
        throw limitFailure(NODE_SEA_EXEC_ARGV_TEXT, "memory");
    };
    for (let index = 0; index < count; index += 1) {
      if (index % 256 === 0) {
        await setImmediate();
        assertArtifactReadActive(signal);
      }
      values.push(this.text(true, NODE_SEA_INVALID_UTF8, charge));
    }
    return values;
  }

  async hasNonZeroTail(signal?: AbortSignal): Promise<boolean> {
    for (
      let start = this.#offset;
      start < this.bytes.length;
      start += 64 * 1024
    ) {
      await setImmediate();
      assertArtifactReadActive(signal);
      const end = Math.min(start + 64 * 1024, this.bytes.length);
      for (let index = start; index < end; index += 1)
        if (this.bytes[index] !== 0) return true;
    }
    assertArtifactReadActive(signal);
    return false;
  }

  #size(): number {
    if (this.remaining < 8) throw formatFailure(NODE_SEA_TRUNCATED);
    const value = this.#demand(8).readBigUInt64LE(0);
    if (
      value > BigInt(Number.MAX_SAFE_INTEGER) ||
      value > BigInt(this.remaining)
    )
      throw formatFailure(NODE_SEA_TRUNCATED);
    return Number(value);
  }

  #count(limit: number, message: string): number {
    if (this.remaining < 8) throw formatFailure(NODE_SEA_TRUNCATED);
    const value = this.#demand(8).readBigUInt64LE(0);
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw formatFailure(NODE_SEA_TRUNCATED);
    const count = Number(value);
    if (count > limit) throw limitFailure(message, "capacity");
    return count;
  }

  #demand(length: number): Buffer {
    if (length > this.remaining) throw formatFailure(NODE_SEA_TRUNCATED);
    const start = this.#offset;
    this.#offset += length;
    return this.bytes.subarray(start, this.#offset);
  }
}
