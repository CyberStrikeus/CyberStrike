import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";

import type {
  EspImageMetadata,
  EspImageSignatureBlockMetadata,
} from "../artifactFormatMetadata.js";

/*
 * Fixed-layout structures inside an ESP image, from ESP-IDF v6.1
 * (`esp_app_format.h`, `esp_image_format.h`, `esp_app_desc.h`,
 * `esp_bootloader_desc.h`, `esp_bootloader_desc.c`, the ROM `secure_boot.h`
 * headers, `docs/en/security/secure-boot-v2.rst`) and esptool v5.6.0's
 * espsecure.
 */
export const ESP_IMAGE_SEGMENT_HEADER_BYTES = 8;
/** `ESP_IMAGE_HASH_LEN`: the SHA-256 appended after the checksum. */
export const ESP_IMAGE_DIGEST_BYTES = 32;
/** Flash sector; a signature sector begins at the next such boundary. */
export const ESP_FLASH_SECTOR_BYTES = 4096;
export const ESP_APP_DESC_BYTES = 256;
export const ESP_SIGNATURE_BLOCK_BYTES = 1216;
const ERASED = 0xff;
const APP_DESC_MAGIC = 0xabcd_5432;
const BOOTLOADER_DESC_MAGIC = 0x50;
const BOOTLOADER_DESC_BYTES = 80;
const SIGNATURE_MAGIC = 0xe7;
const SIGNATURE_CRC_OFFSET = 1196;

export const u32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) |
    ((bytes[at + 1] ?? 0) << 8) |
    ((bytes[at + 2] ?? 0) << 16) |
    ((bytes[at + 3] ?? 0) << 24)) >>>
  0;

export const u16 = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);

export const hex = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("hex");

export const offsetText = (value: number): string => `0x${value.toString(16)}`;

/** File offset of the first byte of `bytes` that is not erased flash, if any. */
export const firstUnerased = (
  bytes: Uint8Array,
  offset: number,
): number | undefined => {
  const index = bytes.findIndex((byte) => byte !== ERASED);
  return index < 0 ? undefined : offset + index;
};

const allZero = (bytes: Uint8Array): boolean =>
  bytes.every((byte) => byte === 0);

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** The bytes of a NUL-terminated C string in a fixed array. */
export const cStringBytes = (bytes: Uint8Array): Uint8Array => {
  const end = bytes.indexOf(0);
  return end < 0 ? bytes : bytes.subarray(0, end);
};

/** A NUL-terminated C string in a fixed array, or null when not UTF-8. */
export const cString = (bytes: Uint8Array): string | null => {
  try {
    return UTF8.decode(cStringBytes(bytes));
  } catch {
    return null;
  }
};

/** How a descriptor REA could not read is reported; tests compare with these. */
export const ESP_DESCRIPTOR_LIMITATIONS = {
  fieldNotUtf8: (field: string): string =>
    `ESP image descriptor field ${field} is not valid UTF-8; its text is unknown.`,
  reservedBytesNotZero:
    "ESP image segment 0 begins with the bootloader descriptor magic 0x50, but its reserved bytes are not zero; it is not read as an esp_bootloader_desc_t.",
} as const;

/**
 * Decode the descriptor that begins segment 0: `esp_app_desc_t`, which
 * ESP-IDF's bootloader reads there, or `esp_bootloader_desc_t`, which esptool
 * places there. The bootloader descriptor's magic is one byte, so its
 * reserved fields, which ESP-IDF zero-fills, must also be zero.
 */
export const decodeEspDescriptor = (
  bytes: Uint8Array,
  offset: number,
  limitations: string[],
): EspImageMetadata["descriptor"] => {
  const text = (from: number, length: number, field: string): string | null => {
    const value = cString(bytes.subarray(from, from + length));
    if (value === null)
      limitations.push(ESP_DESCRIPTOR_LIMITATIONS.fieldNotUtf8(field));
    return value;
  };
  if (bytes.length >= 4 && u32(bytes, 0) === APP_DESC_MAGIC) {
    // A file can end inside the descriptor. Each field is kept when the file
    // holds all of its bytes; a field it cuts off is null.
    const held = (end: number): boolean => bytes.length >= end;
    return {
      kind: "app",
      offset,
      observed_length: Math.min(bytes.length, ESP_APP_DESC_BYTES),
      secure_version: held(8) ? u32(bytes, 4) : null,
      version: held(48) ? text(16, 32, "version") : null,
      project_name: held(80) ? text(48, 32, "project_name") : null,
      time: held(96) ? text(80, 16, "time") : null,
      date: held(112) ? text(96, 16, "date") : null,
      idf_ver: held(144) ? text(112, 32, "idf_ver") : null,
      app_elf_sha256: held(176) ? hex(bytes.subarray(144, 176)) : null,
      min_efuse_blk_rev_full: held(178) ? u16(bytes, 176) : null,
      max_efuse_blk_rev_full: held(180) ? u16(bytes, 178) : null,
      mmu_page_size: bytes[180] ?? null,
      spi_flash_mode: bytes[181] ?? null,
    };
  }
  if (
    bytes.length < BOOTLOADER_DESC_BYTES ||
    bytes[0] !== BOOTLOADER_DESC_MAGIC
  )
    return null;
  if (!allZero(bytes.subarray(1, 3)) || !allZero(bytes.subarray(64, 80))) {
    limitations.push(ESP_DESCRIPTOR_LIMITATIONS.reservedBytesNotZero);
    return null;
  }
  return {
    kind: "bootloader",
    offset,
    secure_version: bytes[3] ?? 0,
    version: u32(bytes, 4),
    idf_ver: text(8, 32, "idf_ver"),
    date_time: text(40, 24, "date_time"),
  };
};

/** The bytes of one sector slot: a valid block, erased flash, or neither. */
export type EspSignatureSlot = "block" | "erased" | "other";

/**
 * A slot holds a block when it has the 0xE7 magic and a CRC32 of its first
 * 1196 bytes at offset 1196, the validity rule of ESP-IDF and espsecure.
 */
export const espSignatureSlot = (slot: Uint8Array): EspSignatureSlot => {
  if (
    slot.length === ESP_SIGNATURE_BLOCK_BYTES &&
    slot[0] === SIGNATURE_MAGIC &&
    crc32(slot.subarray(0, SIGNATURE_CRC_OFFSET)) ===
      u32(slot, SIGNATURE_CRC_OFFSET)
  )
    return "block";
  return slot.every((byte) => byte === ERASED) ? "erased" : "other";
};

/** Field offsets inside a signature block, from the ROM `secure_boot.h`. */
interface SignatureLayout {
  readonly digestBytes: 32 | 48;
  readonly keyStart: number;
  readonly keyEnd: number;
  readonly curveAt: number | undefined;
}

const RSA_LAYOUT: SignatureLayout = {
  digestBytes: 32,
  keyStart: 36,
  keyEnd: 812,
  curveAt: undefined,
};
/** ECDSA layouts by `sha_version`: 0 is P-192/P-256, 1 is P-384. */
const ECDSA_LAYOUTS: Readonly<Record<number, SignatureLayout>> = {
  0: { digestBytes: 32, keyStart: 36, keyEnd: 101, curveAt: 36 },
  1: { digestBytes: 48, keyStart: 52, keyEnd: 149, curveAt: 52 },
};

/** Digests of every byte before the signature sector, when present. */
export interface EspSignedContentDigests {
  readonly sha256: string | undefined;
  readonly sha384: string | undefined;
}

/**
 * Decode a valid block's declared facts without verifying the signature.
 * Version 0x02 is RSA-PSS and 0x03 ECDSA; any other version or ECDSA
 * `sha_version` leaves the layout, and so every layout-dependent fact,
 * unknown. The public-key digest covers the bytes espsecure
 * `signature-info-v2` hashes.
 */
export const decodeEspSignatureBlock = (
  block: Uint8Array,
  index: number,
  content: EspSignedContentDigests,
): EspImageSignatureBlockMetadata => {
  const version = block[1] ?? 0;
  const scheme = version === 0x02 ? "rsa" : version === 0x03 ? "ecdsa" : null;
  const shaVersion = scheme === "ecdsa" ? (block[2] ?? 0) : null;
  const layout =
    scheme === "rsa"
      ? RSA_LAYOUT
      : shaVersion === null
        ? undefined
        : ECDSA_LAYOUTS[shaVersion];
  const unknown = {
    curve_id: null,
    digest_algorithm: null,
    image_digest: null,
    image_digest_matches: null,
    public_key_sha256: null,
  };
  if (layout === undefined)
    return {
      kind: "esp-image-signature-block",
      index,
      version,
      scheme,
      sha_version: shaVersion,
      ...unknown,
      signature_status: "unverified",
    };
  const digestAlgorithm = layout.digestBytes === 48 ? "sha384" : "sha256";
  const imageDigest = hex(block.subarray(4, 4 + layout.digestBytes));
  const expected = content[digestAlgorithm];
  return {
    kind: "esp-image-signature-block",
    index,
    version,
    scheme,
    sha_version: shaVersion,
    curve_id:
      layout.curveAt === undefined ? null : (block[layout.curveAt] ?? 0),
    digest_algorithm: digestAlgorithm,
    image_digest: imageDigest,
    image_digest_matches:
      expected === undefined ? null : expected === imageDigest,
    public_key_sha256: createHash("sha256")
      .update(block.subarray(layout.keyStart, layout.keyEnd))
      .digest("hex"),
    signature_status: "unverified",
  };
};
