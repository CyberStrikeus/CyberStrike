import { crc32 } from "node:zlib";

import { err, ok, type Result } from "./result.js";

/**
 * U-Boot legacy uImage header (U-Boot `include/image.h`, all fields
 * big-endian). Only the 64-byte header is interpreted here; payload bytes
 * are never decompressed, executed, or otherwise transformed.
 */
export const UIMAGE_MAGIC = 0x27051956;
export const UIMAGE_HEADER_SIZE = 64;
export const UIMAGE_NAME_LENGTH = 32;

/** Cap on multi-image sub-images: one inventory entry per sub-image. */
export const UIMAGE_MAX_SUB_IMAGES = 4096;

/** Bytes of payload prefix that can hold a maximal multi-image size table. */
export const UIMAGE_MULTI_TABLE_WINDOW = (UIMAGE_MAX_SUB_IMAGES + 1) * 4;

/**
 * Multi (4) and script (6) payloads begin with the size table: mkimage writes
 * it for both, and U-Boot's `source` skips it because "scripts are just
 * multi-image files with one component".
 */
export const hasUImageSizeTable = (type: number): boolean =>
  type === 4 || type === 6;

export interface UImageSubImage {
  readonly index: number;
  /** Byte offset of the sub-image payload relative to the carrier start. */
  readonly byteOffset: number;
  readonly declaredSize: number;
}

export interface UImageHeaderFields {
  readonly magic: number;
  readonly timestamp: number;
  readonly timestampIso: string;
  readonly payloadSize: number;
  readonly loadAddress: number;
  readonly entryPoint: number;
  readonly headerCrc32: number;
  readonly dataCrc32: number;
  readonly os: number;
  readonly osName: string;
  readonly arch: number;
  readonly archName: string;
  readonly type: number;
  readonly typeName: string;
  readonly compression: number;
  readonly compressionName: string;
  readonly name: string | null;
  readonly nameBytesHex: string;
}

// IDs are append-only in U-Boot include/image.h, pinned ece349ade2973e220f524ce59e59711cc919263f.
const ARCH_NAMES: Readonly<Record<number, string>> = {
  0: "invalid",
  1: "alpha",
  2: "arm",
  3: "x86",
  4: "ia64",
  5: "mips",
  6: "mips64",
  7: "ppc",
  8: "s390",
  9: "sh",
  10: "sparc",
  11: "sparc64",
  12: "m68k",
  13: "nios",
  14: "microblaze",
  15: "nios2",
  16: "blackfin",
  17: "avr32",
  18: "st200",
  19: "sandbox",
  20: "nds32",
  21: "openrisc",
  22: "arm64",
  23: "arc",
  24: "x86_64",
  25: "xtensa",
  26: "riscv",
};

const OS_NAMES: Readonly<Record<number, string>> = {
  0: "invalid",
  1: "openbsd",
  2: "netbsd",
  3: "freebsd",
  4: "4_4bsd",
  5: "linux",
  6: "svr4",
  7: "esix",
  8: "solaris",
  9: "irix",
  10: "sco",
  11: "dell",
  12: "ncr",
  13: "lynxos",
  14: "vxworks",
  15: "psos",
  16: "qnx",
  17: "u-boot",
  18: "rtems",
  19: "artos",
  20: "unity",
  21: "integrity",
  22: "ose",
  23: "plan9",
  24: "openrtos",
  25: "arm-trusted-firmware",
  26: "tee",
  27: "opensbi",
  28: "efi",
  29: "elf",
};

const TYPE_NAMES: Readonly<Record<number, string>> = {
  0: "invalid",
  1: "standalone",
  2: "kernel",
  3: "ramdisk",
  4: "multi",
  5: "firmware",
  6: "script",
  7: "filesystem",
  8: "flat_dt",
  9: "kwbimage",
  10: "imximage",
  11: "ublimage",
  12: "omapimage",
  13: "aisimage",
  14: "kernel_noload",
  15: "pblimage",
  16: "mxsimage",
  17: "gpimage",
  18: "atmelimage",
  19: "socfpgaimage",
  20: "x86_setup",
  21: "lpc32xximage",
  // boot/image.c has no short name for IH_TYPE_LOADABLE.
  22: "loadable",
  23: "rkimage",
  24: "rksd",
  25: "rkspi",
  26: "zynqimage",
  27: "zynqmpimage",
  28: "zynqmpbif",
  29: "fpga",
  30: "vybridimage",
  31: "tee",
  32: "firmware_ivt",
  33: "pmmc",
  34: "stm32image",
  35: "socfpgaimage_v1",
  36: "mtk_image",
  37: "imx8mimage",
  38: "imx8image",
  39: "copro",
  40: "sunxi_egon",
  41: "sunxi_toc0",
  42: "fdt_legacy",
  43: "spkgimage",
  44: "sfspl",
  45: "tfa-bl31",
  46: "stm32imagev2",
  47: "amlimage",
};

const COMPRESSION_NAMES: Readonly<Record<number, string>> = {
  0: "none",
  1: "gzip",
  2: "bzip2",
  3: "lzma",
  4: "lzo",
  5: "lz4",
  6: "zstd",
};

const named = (
  table: Readonly<Record<number, string>>,
  value: number,
): string => table[value] ?? "unknown";

export type UImageParseError =
  | { readonly _tag: "UImageFormatFailure"; readonly message: string }
  | { readonly _tag: "UImageCapacityFailure"; readonly message: string };
const malformed = (message: string): UImageParseError => ({
  _tag: "UImageFormatFailure",
  message,
});
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** True when the first four bytes are the U-Boot legacy magic. */
export const hasUImageMagic = (prefix: Buffer): boolean =>
  prefix.length >= 4 && prefix.readUInt32BE(0) === UIMAGE_MAGIC;

/**
 * Parse the 64-byte header and verify its CRC32 (computed over the header
 * with the ih_hcrc field zeroed, per `image_check_hcrc`). Fail-closed with
 * a named reason; the payload is not touched here.
 */
export const parseUImageHeaderFields = (
  header: Buffer,
): Result<UImageHeaderFields, UImageParseError> => {
  if (header.length < UIMAGE_HEADER_SIZE)
    return err(
      malformed(
        `uImage header is truncated: ${header.length} bytes, expected ${UIMAGE_HEADER_SIZE}`,
      ),
    );
  if (header.readUInt32BE(0) !== UIMAGE_MAGIC)
    return err(
      malformed(
        `uImage magic mismatch: expected 0x${UIMAGE_MAGIC.toString(16)}, found 0x${header.readUInt32BE(0).toString(16)}`,
      ),
    );
  const declaredHeaderCrc = header.readUInt32BE(4);
  const zeroed = Buffer.from(header.subarray(0, UIMAGE_HEADER_SIZE));
  zeroed.writeUInt32BE(0, 4);
  const computedHeaderCrc = crc32(zeroed);
  if (computedHeaderCrc !== declaredHeaderCrc)
    return err(
      malformed(
        `uImage header CRC32 mismatch: declared 0x${declaredHeaderCrc.toString(16)}, computed 0x${computedHeaderCrc.toString(16)}`,
      ),
    );
  const timestamp = header.readUInt32BE(8);
  const nameBytes = header.subarray(32, 32 + UIMAGE_NAME_LENGTH);
  const nul = nameBytes.indexOf(0);
  let name: string | null;
  try {
    name = UTF8.decode(
      nameBytes.subarray(0, nul === -1 ? UIMAGE_NAME_LENGTH : nul),
    );
  } catch {
    name = null;
  }
  const os = header[28] ?? 0;
  const arch = header[29] ?? 0;
  const type = header[30] ?? 0;
  const compression = header[31] ?? 0;
  return ok({
    magic: UIMAGE_MAGIC,
    timestamp,
    timestampIso: new Date(timestamp * 1000).toISOString(),
    payloadSize: header.readUInt32BE(12),
    loadAddress: header.readUInt32BE(16),
    entryPoint: header.readUInt32BE(20),
    headerCrc32: declaredHeaderCrc,
    dataCrc32: header.readUInt32BE(24),
    os,
    osName: named(OS_NAMES, os),
    arch,
    archName: named(ARCH_NAMES, arch),
    type,
    typeName: named(TYPE_NAMES, type),
    compression,
    compressionName: named(COMPRESSION_NAMES, compression),
    name,
    nameBytesHex: nameBytes.toString("hex"),
  });
};

/**
 * Multi-file payload layout (U-Boot `image_multi_getimg`): the payload
 * begins with a table of big-endian sub-image sizes terminated by a zero
 * entry; the sub-image bytes follow the table in order, with nonfinal components
 * padded to a four-byte boundary. `prefix` must hold
 * the table's opening bytes (up to UIMAGE_MULTI_TABLE_WINDOW); the table
 * must terminate inside the payload and the sub-images must fit within
 * `payloadSize`. Trailing slack after the last sub-image is tolerated
 * because it stays inside the stored payload entry.
 */
export const parseMultiImageTable = (
  prefix: Buffer,
  payloadSize: number,
): Result<readonly UImageSubImage[], UImageParseError> => {
  if (!Number.isSafeInteger(payloadSize) || payloadSize < 0)
    return err(
      malformed("uImage payload size is not an exact nonnegative extent"),
    );
  const sizes: number[] = [];
  let cursor = 0;
  for (;;) {
    if (cursor + 4 > prefix.length || cursor + 4 > payloadSize)
      return err(
        malformed(
          "uImage multi-image size table has no zero terminator inside the payload",
        ),
      );
    const size = prefix.readUInt32BE(cursor);
    cursor += 4;
    if (size === 0) break;
    sizes.push(size);
    if (sizes.length > UIMAGE_MAX_SUB_IMAGES)
      return err({
        _tag: "UImageCapacityFailure",
        message: `uImage multi-image table declares more than ${UIMAGE_MAX_SUB_IMAGES} sub-images`,
      });
  }
  const subImages: UImageSubImage[] = [];
  let offset = UIMAGE_HEADER_SIZE + cursor;
  for (const [index, size] of sizes.entries()) {
    if (offset + size > UIMAGE_HEADER_SIZE + payloadSize)
      return err(
        malformed(
          `uImage multi-image sub-image ${index} of ${size} bytes overruns the ${payloadSize}-byte payload`,
        ),
      );
    subImages.push({ index, byteOffset: offset, declaredSize: size });
    offset += index + 1 < sizes.length ? Math.ceil(size / 4) * 4 : size;
  }
  return ok(subImages);
};
