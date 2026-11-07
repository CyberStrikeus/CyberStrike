import { constants, inflateSync, zstdDecompressSync } from "node:zlib";

const SHF_COMPRESSED = 0x800n;
const ELFCOMPRESS_ZLIB = 1;
const ELFCOMPRESS_ZSTD = 2;

export type ElfSectionNameTableResult =
  | {
      readonly state: "available";
      readonly bytes: Buffer;
      readonly compressed: boolean;
    }
  | { readonly state: "unsupported"; readonly compressionType: number }
  | { readonly state: "malformed"; readonly message: string }
  | {
      readonly state: "limit";
      readonly requiredBytes: bigint;
      readonly maximumBytes: number;
    };

/** Decode the ELF section-name table once for consumers that need its names. */
export const decodeElfSectionNameTable = (
  bytes: Buffer,
  flags: bigint,
  bits: 32 | 64,
  little: boolean,
  maximumDecodedBytes: number,
): ElfSectionNameTableResult => {
  if ((flags & SHF_COMPRESSED) === 0n)
    return { state: "available", bytes, compressed: false };

  const headerBytes = bits === 64 ? 24 : 12;
  if (bytes.length < headerBytes)
    return {
      state: "malformed",
      message: "ELF compressed section-name table header is truncated",
    };
  const compressionType = little
    ? bytes.readUInt32LE(0)
    : bytes.readUInt32BE(0);
  if (
    compressionType !== ELFCOMPRESS_ZLIB &&
    compressionType !== ELFCOMPRESS_ZSTD
  )
    return { state: "unsupported", compressionType };

  const declaredSize =
    bits === 64
      ? little
        ? bytes.readBigUInt64LE(8)
        : bytes.readBigUInt64BE(8)
      : BigInt(little ? bytes.readUInt32LE(4) : bytes.readUInt32BE(4));
  if (declaredSize > BigInt(maximumDecodedBytes))
    return {
      state: "limit",
      requiredBytes: declaredSize,
      maximumBytes: maximumDecodedBytes,
    };
  const expected = Number(declaredSize);
  let decoded: Buffer;
  try {
    const payload = bytes.subarray(headerBytes);
    const maxOutputLength = Math.max(1, expected);
    decoded =
      compressionType === ELFCOMPRESS_ZSTD
        ? zstdDecompressSync(payload, {
            maxOutputLength,
            // Retain Zstandard's default maximum decoder window of 128 MiB.
            params: { [constants.ZSTD_d_windowLogMax]: 27 },
          })
        : inflateSync(payload, { maxOutputLength });
  } catch (cause: unknown) {
    return {
      state: "malformed",
      message: `ELF compressed section-name table could not be decompressed: ${cause instanceof Error ? cause.message : "invalid compressed data"}`,
    };
  }
  if (decoded.length !== expected)
    return {
      state: "malformed",
      message: "ELF compressed section-name table size is inconsistent",
    };
  return { state: "available", bytes: decoded, compressed: true };
};
