import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";

/** One segment as `esptool elf2image` writes it: load address and data. */
export interface EspFixtureSegment {
  readonly address: number;
  readonly data: Uint8Array;
}

export interface EspImageFixtureOptions {
  readonly segments: readonly EspFixtureSegment[];
  readonly chipId?: number;
  readonly entry?: number;
  readonly hashAppended?: boolean;
  /** Header count; esptool --ram-only-header counts only RAM segments. */
  readonly segmentCount?: number;
  /** Replace the computed checksum before any digest is appended. */
  readonly checksum?: number;
}

const word = (value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0);
  return bytes;
};

const halfWord = (value: number): Buffer => {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
};

/** XOR of every segment data byte, seeded with 0xEF. */
export const espChecksum = (segments: readonly EspFixtureSegment[]): number =>
  segments.reduce(
    (value, { data }) => data.reduce((inner, byte) => inner ^ byte, value),
    0xef,
  );

/** A 24-byte header, the segments, the 16-byte-aligned checksum and digest. */
export const espImage = (options: EspImageFixtureOptions): Buffer => {
  const hashAppended = options.hashAppended ?? true;
  const header = Buffer.concat([
    Buffer.from([
      0xe9,
      options.segmentCount ?? options.segments.length,
      0x02,
      0x20,
    ]),
    word(options.entry ?? 0x4038_0000),
    Buffer.from([0xee, 0, 0, 0]),
    halfWord(options.chipId ?? 0x0005),
    Buffer.from([0]),
    halfWord(0),
    halfWord(199),
    Buffer.from([0, 0, 0, 0, hashAppended ? 1 : 0]),
  ]);
  const parts: Buffer[] = [header];
  for (const { address, data } of options.segments)
    parts.push(word(address), word(data.length), Buffer.from(data));
  const body = Buffer.concat(parts);
  const padding = 15 - (body.length % 16);
  const image = Buffer.concat([
    body,
    Buffer.alloc(padding),
    Buffer.from([options.checksum ?? espChecksum(options.segments)]),
  ]);
  return hashAppended
    ? Buffer.concat([image, createHash("sha256").update(image).digest()])
    : image;
};

const fixed = (text: string, length: number): Buffer => {
  const bytes = Buffer.alloc(length);
  bytes.write(text, "utf8");
  return bytes;
};

export interface AppDescriptorFields {
  readonly version?: string;
  readonly projectName?: string;
  readonly time?: string;
  readonly date?: string;
  readonly idfVer?: string;
  readonly elfSha256?: string;
  readonly mmuPageSizeLog2?: number;
  readonly secureVersion?: number;
}

/** A 256-byte `esp_app_desc_t`. */
export const appDescriptor = (fields: AppDescriptorFields = {}): Buffer =>
  Buffer.concat([
    word(0xabcd_5432),
    word(fields.secureVersion ?? 0),
    Buffer.alloc(8),
    fixed(fields.version ?? "1.2.3", 32),
    fixed(fields.projectName ?? "rea_esp_fixture", 32),
    fixed(fields.time ?? "12:34:56", 16),
    fixed(fields.date ?? "Oct 27 2026", 16),
    fixed(fields.idfVer ?? "v6.1", 32),
    Buffer.from(fields.elfSha256 ?? "ab".repeat(32), "hex"),
    halfWord(0),
    halfWord(199),
    Buffer.from([fields.mmuPageSizeLog2 ?? 16, 2, 0, 0]),
    Buffer.alloc(72),
  ]);

/** An 80-byte `esp_bootloader_desc_t`. */
export const bootloaderDescriptor = (): Buffer =>
  Buffer.concat([
    Buffer.from([0x50, 0, 0, 1]),
    word(1),
    fixed("v6.1", 32),
    fixed("Oct 27 2026 12:34:56", 24),
    Buffer.alloc(16),
  ]);

/** Words of distinct bytes, so XOR folds and offsets are observable. */
export const pattern = (length: number, seed: number): Buffer =>
  Buffer.from(Array.from({ length }, (_, index) => (seed + index * 7) & 0xff));

/** An ESP32-C3 app: DROM with the descriptor, DRAM, IRAM and IROM. */
export const ESP32C3_APP_SEGMENTS: readonly EspFixtureSegment[] = [
  {
    address: 0x3c00_0020,
    data: Buffer.concat([appDescriptor(), pattern(32, 1)]),
  },
  { address: 0x3fc8_8000, data: pattern(16, 2) },
  { address: 0x4038_0000, data: pattern(32, 3) },
  { address: 0x4200_0020, data: pattern(64, 4) },
];

/** An ESP32-C3 bootloader: DRAM with the descriptor, then IRAM. */
export const ESP32C3_BOOTLOADER_SEGMENTS: readonly EspFixtureSegment[] = [
  {
    address: 0x3fcd_5820,
    data: Buffer.concat([bootloaderDescriptor(), pattern(16, 5)]),
  },
  { address: 0x403c_c710, data: pattern(48, 6) },
];

export type SignatureBlockKind = "rsa" | "ecdsa-p256" | "ecdsa-p384";

/**
 * A 1216-byte Secure Boot v2 block with a key pattern and the CRC32 that
 * espsecure writes. The image digest covers `content` unless supplied.
 */
export const signatureBlock = (
  kind: SignatureBlockKind,
  content: Uint8Array,
  options: {
    readonly imageDigest?: Buffer;
    readonly crc?: number;
    readonly version?: number;
    readonly shaVersion?: number;
  } = {},
): Buffer => {
  const block = Buffer.alloc(1216);
  block[0] = 0xe7;
  block[1] = options.version ?? (kind === "rsa" ? 0x02 : 0x03);
  block[2] = options.shaVersion ?? (kind === "ecdsa-p384" ? 1 : 0);
  const digest =
    options.imageDigest ??
    createHash(kind === "ecdsa-p384" ? "sha384" : "sha256")
      .update(content)
      .digest();
  digest.copy(block, 4);
  const keyStart = kind === "ecdsa-p384" ? 52 : 36;
  const keyEnd = kind === "rsa" ? 812 : kind === "ecdsa-p256" ? 101 : 149;
  pattern(keyEnd - keyStart, 9).copy(block, keyStart);
  if (kind !== "rsa") block[keyStart] = kind === "ecdsa-p384" ? 3 : 2;
  block.writeUInt32LE(options.crc ?? crc32(block.subarray(0, 1196)), 1196);
  return block;
};

/** Pad with erased flash to 4 KiB, as espsecure does before its sector. */
export const erasedTo4KiB = (image: Buffer): Buffer =>
  Buffer.concat([
    image,
    Buffer.alloc((4096 - (image.length % 4096)) % 4096, 0xff),
  ]);

/**
 * Append a signature sector; each kind fills the slot of its index and
 * `null` leaves that slot erased.
 */
export const signedEspImage = (
  image: Buffer,
  kinds: readonly (SignatureBlockKind | null)[],
): Buffer => {
  const padded = erasedTo4KiB(image);
  const sector = Buffer.alloc(4096, 0xff);
  kinds.forEach((kind, index) => {
    if (kind !== null) signatureBlock(kind, padded).copy(sector, index * 1216);
  });
  return Buffer.concat([padded, sector]);
};

/**
 * An ESP8266 image: an 8-byte header without an extended header. A v1 image
 * starts in IRAM, Arduino's eboot at 0x4010F000, a v3 image in IROM.
 */
export const esp8266Image = (firstAddress = 0x4010_0000): Buffer => {
  const segments = [
    { address: firstAddress, data: pattern(32, 7) },
    { address: 0x3ffe_8000, data: pattern(16, 8) },
  ];
  const parts: Buffer[] = [
    Buffer.from([0xe9, segments.length, 0x00, 0x20]),
    word(0x4010_0004),
  ];
  for (const { address, data } of segments)
    parts.push(word(address), word(data.length), data);
  const body = Buffer.concat(parts);
  return Buffer.concat([
    body,
    Buffer.alloc(15 - (body.length % 16)),
    Buffer.from([espChecksum(segments)]),
  ]);
};
