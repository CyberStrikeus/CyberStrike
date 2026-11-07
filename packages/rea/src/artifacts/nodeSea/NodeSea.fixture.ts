import { elfNote, elfNoteFixture } from "../../native/elf/ElfNotes.fixture.js";
import { peResourceFixture } from "../../native/pe/PeResources.fixture.js";

import { NODE_SEA_MAGIC } from "./NodeSeaBlob.js";

/** Official Node `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2` hash. */
export const NODE_SEA_FUSE_HASH = "fce680ab2cc467b6e072b8b5df1996b2";

export type NodeSeaFuseFixture = "set" | "unset" | "absent" | "conflicting";

export interface NodeSeaAssetFixture {
  readonly name: string;
  readonly body: Buffer | string;
}

export interface NodeSeaBlobFixtureOptions {
  readonly codePath?: string;
  readonly main?: Buffer | string;
  readonly snapshot?: Buffer | string;
  readonly codeCache?: Buffer | string;
  readonly assets?: readonly NodeSeaAssetFixture[];
  readonly execArgv?: readonly string[];
  readonly execArgvExtension?: 0 | 1 | 2;
  readonly disableExperimentalSeaWarning?: boolean;
  readonly trailing?: Buffer;
}

export interface NodeSeaCarrierOptions extends NodeSeaBlobFixtureOptions {
  /** Raw blob bytes. When set, the structured fields above are ignored. */
  readonly blob?: Buffer;
  readonly fuse?: NodeSeaFuseFixture;
  readonly extraBlobs?: readonly Buffer[];
}

const asBytes = (value: Buffer | string): Buffer =>
  typeof value === "string" ? Buffer.from(value, "utf8") : value;

const u64 = (value: number): Buffer => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
};

const sized = (value: Buffer | string): Buffer => {
  const body = asBytes(value);
  return Buffer.concat([u64(body.length), body]);
};

/** Build a Node 24 SEA blob: magic, flags, extension, then length-prefixed fields. */
export const buildNodeSeaBlob = (
  options: NodeSeaBlobFixtureOptions = {},
): Buffer => {
  const codePath = options.codePath ?? "sea.js";
  const snapshot = options.snapshot;
  const body = snapshot ?? options.main ?? 'console.log("rea-node-sea")\n';
  const assets = options.assets ?? [];
  const execArgv = options.execArgv ?? [];
  let flags = 0;
  if (options.disableExperimentalSeaWarning === true) flags |= 1 << 0;
  if (snapshot !== undefined) flags |= 1 << 1;
  if (options.codeCache !== undefined) flags |= 1 << 2;
  if (assets.length > 0) flags |= 1 << 3;
  if (execArgv.length > 0) flags |= 1 << 4;
  const header = Buffer.alloc(9);
  header.writeUInt32LE(NODE_SEA_MAGIC, 0);
  header.writeUInt32LE(flags, 4);
  header[8] = options.execArgvExtension ?? 1;
  const parts: Buffer[] = [header, sized(codePath), sized(body)];
  if (options.codeCache !== undefined) parts.push(sized(options.codeCache));
  if (assets.length > 0) {
    parts.push(u64(assets.length));
    for (const asset of assets)
      parts.push(sized(asset.name), sized(asset.body));
  }
  if (execArgv.length > 0) {
    parts.push(u64(execArgv.length));
    for (const argument of execArgv) parts.push(sized(argument));
  }
  if (options.trailing !== undefined) parts.push(options.trailing);
  return Buffer.concat(parts);
};

export const nodeSeaFuseBytes = (
  state: NodeSeaFuseFixture = "absent",
): Buffer => {
  if (state === "absent") return Buffer.alloc(0);
  const sentinel = (digit: string, hash = NODE_SEA_FUSE_HASH): Buffer =>
    Buffer.from(`\0NODE_SEA_FUSE_${hash}:${digit}\0`, "latin1");
  if (state === "set") return sentinel("1");
  if (state === "unset") return sentinel("0");
  return Buffer.concat([
    sentinel("0"),
    sentinel("1", "0123456789abcdef0123456789abcdef"),
  ]);
};

export interface NodeSeaMachOOptions extends NodeSeaCarrierOptions {
  readonly segmentName?: string;
  readonly sectionName?: string;
  readonly bits?: 32 | 64;
  readonly littleEndian?: boolean;
}

/** Thin Mach-O whose SEA section file offset is relative to this image. */
export const nodeSeaMachO = (options: NodeSeaMachOOptions = {}): Buffer => {
  const blobs = carrierBlobs(options);
  const little = options.littleEndian ?? true;
  const wide = (options.bits ?? 64) === 64;
  const headerSize = wide ? 32 : 28;
  const segmentHeader = wide ? 72 : 56;
  const sectionSize = wide ? 80 : 68;
  const segmentName = options.segmentName ?? "NODE_SEA";
  const sectionName = options.sectionName ?? "__NODE_SEA_BLOB";
  const cmdsize = segmentHeader + blobs.length * sectionSize;
  const payloadAt = headerSize + cmdsize;
  const payloadOffsets: number[] = [];
  let cursor = payloadAt;
  for (const blob of blobs) {
    payloadOffsets.push(cursor);
    cursor += blob.length;
  }
  const image = Buffer.alloc(cursor);
  write32(image, 0, wide ? 0xfeedfacf : 0xfeedface, little);
  write32(image, 4, wide ? 0x0100000c : 7, little);
  write32(image, 12, 2, little);
  write32(image, 16, 1, little);
  write32(image, 20, cmdsize, little);
  const command = headerSize;
  write32(image, command, wide ? 0x19 : 0x1, little);
  write32(image, command + 4, cmdsize, little);
  writeName(image, command + 8, segmentName);
  const payloadSize = cursor - payloadAt;
  if (wide) {
    write64(image, command + 32, payloadSize, little);
    write64(image, command + 40, payloadAt, little);
    write64(image, command + 48, payloadSize, little);
    write32(image, command + 56, 7, little);
    write32(image, command + 60, 5, little);
    write32(image, command + 64, blobs.length, little);
  } else {
    write32(image, command + 28, payloadSize, little);
    write32(image, command + 32, payloadAt, little);
    write32(image, command + 36, payloadSize, little);
    write32(image, command + 40, 7, little);
    write32(image, command + 44, 5, little);
    write32(image, command + 48, blobs.length, little);
  }
  blobs.forEach((blob, index) => {
    const section = command + segmentHeader + index * sectionSize;
    const fileOffset = payloadOffsets[index] ?? payloadAt;
    writeName(image, section, sectionName);
    writeName(image, section + 16, segmentName);
    if (wide) {
      write64(image, section + 40, blob.length, little);
      write32(image, section + 48, fileOffset, little);
    } else {
      write32(image, section + 36, blob.length, little);
      write32(image, section + 40, fileOffset, little);
    }
    blob.copy(image, fileOffset);
  });
  return Buffer.concat([image, nodeSeaFuseBytes(options.fuse)]);
};

/** One FAT slice wrapping a thin Mach-O SEA image. */
export const nodeSeaUniversal = (options: NodeSeaMachOOptions = {}): Buffer => {
  const slice = nodeSeaMachO(options);
  const offset = 4096;
  const fat = Buffer.alloc(offset + slice.length);
  fat.writeUInt32BE(0xcafebabe, 0);
  fat.writeUInt32BE(1, 4);
  fat.writeUInt32BE(0x0100000c, 8);
  fat.writeUInt32BE(offset, 16);
  fat.writeUInt32BE(slice.length, 20);
  fat.writeUInt32BE(12, 24);
  slice.copy(fat, offset);
  return fat;
};

export const nodeSeaElf = (
  options: NodeSeaCarrierOptions & {
    readonly ownership?: "program" | "section" | "both";
  } = {},
): Buffer => {
  const notes = Buffer.concat(
    carrierBlobs(options).map((blob) => elfNote("NODE_SEA_BLOB", 0, blob)),
  );
  return Buffer.concat([
    elfNoteFixture({
      notes,
      ownership: options.ownership ?? "both",
      type: 2,
    }),
    nodeSeaFuseBytes(options.fuse),
  ]);
};

export const nodeSeaPe = (options: NodeSeaCarrierOptions = {}): Buffer => {
  const resources = carrierBlobs(options).map((blob, index) => ({
    type: 10,
    name: "NODE_SEA_BLOB",
    language: index,
    payload: blob,
  }));
  return Buffer.concat([
    peResourceFixture(true, resources).bytes,
    nodeSeaFuseBytes(options.fuse),
  ]);
};

const carrierBlobs = (options: NodeSeaCarrierOptions): Buffer[] => [
  options.blob ?? buildNodeSeaBlob(options),
  ...(options.extraBlobs ?? []),
];

const writeName = (bytes: Buffer, offset: number, name: string): void => {
  bytes.write(name, offset, Math.min(name.length, 16), "latin1");
};

const write32 = (
  bytes: Buffer,
  offset: number,
  value: number,
  little: boolean,
): void => {
  if (little) bytes.writeUInt32LE(value, offset);
  else bytes.writeUInt32BE(value, offset);
};

const write64 = (
  bytes: Buffer,
  offset: number,
  value: number,
  little: boolean,
): void => {
  if (little) bytes.writeBigUInt64LE(BigInt(value), offset);
  else bytes.writeBigUInt64BE(BigInt(value), offset);
};
