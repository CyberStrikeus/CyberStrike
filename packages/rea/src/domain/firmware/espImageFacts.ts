import type {
  EspImageMetadata,
  EspImageSegmentMetadata,
  EspImageSignatureBlockMetadata,
} from "../artifactFormatMetadata.js";
import {
  ESP_CHIP_TABLE_SOURCE,
  classifyEspSegment,
  espChipForId,
  espPageSizedMappingAmbiguity,
  espSegmentLengthLimit,
  type EspChip,
} from "./espChips.js";
import {
  ESP_FLASH_SECTOR_BYTES,
  ESP_IMAGE_DIGEST_BYTES,
  ESP_IMAGE_SEGMENT_HEADER_BYTES,
  ESP_SIGNATURE_BLOCK_BYTES,
  decodeEspDescriptor,
  decodeEspSignatureBlock,
  espSignatureSlot,
  firstUnerased,
  hex,
  offsetText,
  u16,
  u32,
  type EspSignedContentDigests,
} from "./espImageStructures.js";

const SIGNATURE_SLOTS = 3;

/** One header-declared segment; `availableLength` is what the file holds. */
export interface EspImageSegment {
  readonly dataOffset: number;
  readonly availableLength: number;
  readonly metadata: EspImageSegmentMetadata;
}

export interface EspImageSignatureBlock {
  readonly offset: number;
  readonly metadata: EspImageSignatureBlockMetadata;
}

export interface EspImage {
  readonly metadata: EspImageMetadata;
  readonly segments: readonly EspImageSegment[];
  readonly signatureBlocks: readonly EspImageSignatureBlock[];
  /** Unknown when truncation or undescribed bytes may hide content. */
  readonly coverage: "complete" | "unknown";
  readonly limitations: readonly string[];
}

export interface ObservedSegmentHeader {
  readonly index: number;
  readonly headerOffset: number;
  readonly loadAddress: number;
  readonly length: number;
}

/**
 * What one in-order pass over an image observed. `observedEnd` is the end of
 * the last chunk read: the file size, or the end of the chunk that holds the
 * first non-erased byte after the signature sector, where reading stops.
 */
export interface EspImageObservations {
  readonly fileSize: number;
  readonly observedEnd: number;
  readonly header: Uint8Array;
  readonly segments: readonly ObservedSegmentHeader[];
  /** Up to the first 256 data bytes of segment 0. */
  readonly descriptorBytes: Uint8Array;
  /** XOR of the observed segment data bytes, seeded with 0xEF. */
  readonly checksum: number;
  readonly checksumOffset: number | undefined;
  readonly storedChecksum: number | undefined;
  /** SHA-256 of every byte through the checksum. */
  readonly imageSha256: string | undefined;
  readonly storedDigest: Uint8Array;
  readonly imageEnd: number | undefined;
  readonly sectorOffset: number | undefined;
  /** First byte between the image and its sector that is not 0xFF. */
  readonly gapFirstUnerased: number | undefined;
  /** The 4 KiB from the sector boundary, as far as the file holds them. */
  readonly sector: Uint8Array;
  /** First byte after that sector that is not 0xFF. */
  readonly restFirstUnerased: number | undefined;
  readonly signedContent: EspSignedContentDigests;
}

type ByteRange = EspImageMetadata["undescribed_trailing"][number];

const hexByte = (value: number): string =>
  `0x${value.toString(16).padStart(2, "0")}`;

/**
 * How each ESP image fact REA could not establish is reported. Decoding,
 * inventory and tests use these, so wording has one owner.
 */
export const ESP_IMAGE_LIMITATIONS = {
  /** What an ESP image inventory reads, and what it leaves unverified. */
  inventoryScope:
    "ESP image inventory reads the header-declared segments, checksum, appended SHA-256, descriptor and Secure Boot v2 signature blocks. Segment classification follows ESP-IDF v6.1 should_map and should_load for a cold boot and does not check RAM ranges; signatures are not cryptographically verified, and code is not disassembled.",
  undescribedTrailing: (
    bytes: number,
    ranges: number,
    firstOffset: number,
  ): string =>
    `${String(bytes)} bytes after the ESP image, in ${String(ranges)} range(s) from offset ${offsetText(firstOffset)}, are not described by its header, erased flash or a signature sector. They may be other flash contents, a Secure Boot v1 signature, or flash segments that esptool --ram-only-header leaves out of the segment count.`,
  unknownChip: (chipId: number): string =>
    `ESP image chip_id 0x${chipId.toString(16).padStart(4, "0")} is not in the ${ESP_CHIP_TABLE_SOURCE} chip table; chip, ISA and segment classification are unknown.`,
  unclassifiedPages: (target: string, low: number, high: number): string =>
    `${target} maps flash through 256 MMU pages of the bootloader's configured size, which the image does not record; segments from ${offsetText(low)} to ${offsetText(high)} are unclassified.`,
  segmentLengthUnaligned: (index: number, length: number): string =>
    `ESP image segment ${String(index)} length ${offsetText(length)} is not a multiple of 4; ESP-IDF rejects such an image.`,
  segmentLengthTooLarge: (
    index: number,
    length: number,
    limit: number,
    target: string,
  ): string =>
    `ESP image segment ${String(index)} length ${offsetText(length)} is ${String(limit / 0x10_0000)} MiB or more; ESP-IDF rejects such an image for ${target}.`,
  truncatedSegment: (
    index: number,
    declared: number,
    offset: number,
    available: number,
  ): string =>
    `ESP image is truncated: segment ${String(index)} declares ${String(declared)} bytes at offset ${offsetText(offset)}, but the file holds ${String(available)}.`,
  truncatedSegmentHeaders: (declared: number, present: number): string =>
    `ESP image is truncated: the header declares ${String(declared)} segments, but the file ends before the header of segment ${String(present)}.`,
  truncatedBeforeChecksum: (offset: number): string =>
    `ESP image is truncated before its checksum at offset ${offsetText(offset)}.`,
  checksumMismatch: (
    stored: number,
    offset: number,
    computed: number,
  ): string =>
    `ESP image checksum ${hexByte(stored)} at offset ${offsetText(offset)} does not match the computed ${hexByte(computed)}.`,
  truncatedBeforeDigest: (offset: number): string =>
    `ESP image is truncated before its appended SHA-256 at offset ${offsetText(offset)}.`,
  digestMismatch: (offset: number): string =>
    `ESP image appended SHA-256 at offset ${offsetText(offset)} does not match the SHA-256 of the bytes before it.`,
  segmentEntryTruncated: (
    index: number,
    declared: number,
    available: number,
  ): string =>
    `ESP image segment ${String(index)} is truncated: its header declares ${String(declared)} bytes; the file holds ${String(available)}.`,
  signatureDigestMismatch: (slot: number, offset: number): string =>
    `Secure Boot v2 signature block in slot ${String(slot)} at offset ${offsetText(offset)} records an image digest that does not match the bytes before its sector.`,
  invalidSignatureSlot: (slot: number, offset: number): string =>
    `Secure Boot v2 slot ${String(slot)} at offset ${offsetText(offset)} has the 0xE7 magic but not a matching CRC32 or a complete block; it is not a valid signature block.`,
  signatureSlotsCut: (fileSize: number, sector: number): string =>
    `The file ends at ${offsetText(fileSize)} in erased flash, before the Secure Boot v2 signature slots at ${offsetText(sector)} are complete; signature blocks may be missing.`,
  signatureSectorTruncated: (
    sector: number,
    fileSize: number,
    sectorEnd: number,
  ): string =>
    `Secure Boot v2 signature sector at offset ${offsetText(sector)} is truncated: the file ends at ${offsetText(fileSize)}, before ${offsetText(sectorEnd)}.`,
} as const;

/** Derive chip, classification, integrity, descriptor and coverage facts. */
export const deriveEspImage = (observed: EspImageObservations): EspImage => {
  const limitations: string[] = [];
  const chipId = u16(observed.header, 12);
  const chip = espChipForId(chipId);
  const first = observed.segments[0];
  const descriptor =
    first === undefined
      ? null
      : decodeEspDescriptor(
          observed.descriptorBytes,
          first.headerOffset + ESP_IMAGE_SEGMENT_HEADER_BYTES,
          limitations,
        );
  const segments = observed.segments.map((segment) =>
    segmentFacts(observed, segment, chip),
  );
  limitations.push(...segmentLimitations(chipId, chip, segments));
  const truncated = truncation(observed, segments, limitations);
  const checksum = checksumFacts(observed, truncated, limitations);
  const appendedSha256 = digestFacts(observed, limitations);
  const trailing = trailingFacts(observed, limitations);
  const undescribedBytes = trailing.undescribed.reduce(
    (total, { length }) => total + length,
    0,
  );
  const firstUndescribed = trailing.undescribed[0];
  if (firstUndescribed !== undefined)
    limitations.push(
      ESP_IMAGE_LIMITATIONS.undescribedTrailing(
        undescribedBytes,
        trailing.undescribed.length,
        firstUndescribed.offset,
      ),
    );
  return {
    metadata: {
      kind: "esp-image",
      header: headerFacts(observed.header),
      chip:
        chip === undefined
          ? null
          : {
              target: chip.target,
              isa: chip.isa,
              source: ESP_CHIP_TABLE_SOURCE,
            },
      checksum,
      appended_sha256: appendedSha256,
      image_end: observed.imageEnd ?? null,
      signature_sector_offset:
        trailing.blocks.length > 0 ? (observed.sectorOffset ?? null) : null,
      undescribed_trailing: trailing.undescribed,
      descriptor,
      // The image's bytes alone cannot place it in a dump; the reader can.
      flash_dump: null,
    },
    segments,
    signatureBlocks: trailing.blocks,
    // Signature blocks follow the image end, so a file cut before it may
    // hide them even when every declared segment is present.
    coverage:
      truncated ||
      !imageComplete(observed) ||
      trailing.undescribed.length > 0 ||
      trailing.truncated
        ? "unknown"
        : "complete",
    limitations,
  };
};

/** Whether the file holds the checksum and any appended digest. */
const imageComplete = (observed: EspImageObservations): boolean =>
  observed.imageEnd !== undefined;

/** `esp_image_header_t` fields, observed as written. */
const headerFacts = (header: Uint8Array): EspImageMetadata["header"] => ({
  segment_count: header[1] ?? 0,
  spi_mode: header[2] ?? 0,
  spi_speed: (header[3] ?? 0) & 0x0f,
  spi_size: (header[3] ?? 0) >> 4,
  entry_addr: u32(header, 4),
  wp_pin: header[8] ?? 0,
  spi_pin_drv: hex(header.subarray(9, 12)),
  chip_id: u16(header, 12),
  min_chip_rev: header[14] ?? 0,
  min_chip_rev_full: u16(header, 15),
  max_chip_rev_full: u16(header, 17),
  reserved: hex(header.subarray(19, 23)),
  hash_appended: header[23] === 1,
});

const segmentFacts = (
  observed: EspImageObservations,
  segment: ObservedSegmentHeader,
  chip: EspChip | undefined,
): EspImageSegment => {
  const dataOffset = segment.headerOffset + ESP_IMAGE_SEGMENT_HEADER_BYTES;
  return {
    dataOffset,
    availableLength: Math.max(
      0,
      Math.min(segment.length, observed.observedEnd - dataOffset),
    ),
    metadata: {
      kind: "esp-image-segment",
      index: segment.index,
      load_addr: segment.loadAddress,
      data_len: segment.length,
      header_offset: segment.headerOffset,
      classification: classifyEspSegment(chip, segment.loadAddress),
    },
  };
};

/** Classification gaps and segment lengths ESP-IDF rejects. */
const segmentLimitations = (
  chipId: number,
  chip: EspChip | undefined,
  segments: readonly EspImageSegment[],
): string[] => {
  const limitations: string[] = [];
  const ambiguity =
    chip === undefined ? undefined : espPageSizedMappingAmbiguity(chip);
  if (chip === undefined)
    limitations.push(ESP_IMAGE_LIMITATIONS.unknownChip(chipId));
  else if (
    ambiguity !== undefined &&
    segments.some(({ metadata }) => metadata.classification === "unknown")
  )
    limitations.push(
      ESP_IMAGE_LIMITATIONS.unclassifiedPages(
        chip.target,
        ambiguity.low,
        ambiguity.high,
      ),
    );
  const lengthLimit =
    chip === undefined ? undefined : espSegmentLengthLimit(chip);
  for (const { metadata } of segments) {
    if (metadata.data_len % 4 !== 0)
      limitations.push(
        ESP_IMAGE_LIMITATIONS.segmentLengthUnaligned(
          metadata.index,
          metadata.data_len,
        ),
      );
    if (
      chip !== undefined &&
      lengthLimit !== undefined &&
      metadata.data_len >= lengthLimit
    )
      limitations.push(
        ESP_IMAGE_LIMITATIONS.segmentLengthTooLarge(
          metadata.index,
          metadata.data_len,
          lengthLimit,
          chip.target,
        ),
      );
  }
  return limitations;
};

/** Report the first missing structure; later structures cannot be located. */
const truncation = (
  observed: EspImageObservations,
  segments: readonly EspImageSegment[],
  limitations: string[],
): boolean => {
  const declared = observed.header[1] ?? 0;
  const short = segments.find(
    ({ availableLength, metadata }) => availableLength < metadata.data_len,
  );
  if (short !== undefined) {
    limitations.push(
      ESP_IMAGE_LIMITATIONS.truncatedSegment(
        short.metadata.index,
        short.metadata.data_len,
        short.dataOffset,
        short.availableLength,
      ),
    );
    return true;
  }
  if (segments.length < declared) {
    limitations.push(
      ESP_IMAGE_LIMITATIONS.truncatedSegmentHeaders(declared, segments.length),
    );
    return true;
  }
  return false;
};

/** XOR of every segment data byte, seeded with 0xEF. */
const checksumFacts = (
  observed: EspImageObservations,
  truncated: boolean,
  limitations: string[],
): EspImageMetadata["checksum"] => {
  const offset = observed.checksumOffset ?? null;
  const computed = truncated ? null : observed.checksum;
  const stored = observed.storedChecksum ?? null;
  if (offset === null || computed === null || stored === null) {
    if (!truncated && offset !== null)
      limitations.push(ESP_IMAGE_LIMITATIONS.truncatedBeforeChecksum(offset));
    return { offset, stored, computed, status: "unavailable" };
  }
  if (stored !== computed)
    limitations.push(
      ESP_IMAGE_LIMITATIONS.checksumMismatch(stored, offset, computed),
    );
  return {
    offset,
    stored,
    computed,
    status: stored === computed ? "valid" : "invalid",
  };
};

/** SHA-256 of every byte through the checksum, appended after it. */
const digestFacts = (
  observed: EspImageObservations,
  limitations: string[],
): EspImageMetadata["appended_sha256"] => {
  if (observed.header[23] !== 1)
    return {
      offset: null,
      stored: null,
      computed: null,
      status: "not-appended",
    };
  const offset =
    observed.checksumOffset === undefined ? null : observed.checksumOffset + 1;
  const computed = observed.imageSha256 ?? null;
  if (
    offset === null ||
    computed === null ||
    observed.observedEnd < offset + ESP_IMAGE_DIGEST_BYTES
  ) {
    if (computed !== null && offset !== null)
      limitations.push(ESP_IMAGE_LIMITATIONS.truncatedBeforeDigest(offset));
    return { offset, stored: null, computed, status: "unavailable" };
  }
  const stored = hex(observed.storedDigest);
  if (stored !== computed)
    limitations.push(ESP_IMAGE_LIMITATIONS.digestMismatch(offset));
  return {
    offset,
    stored,
    computed,
    status: stored === computed ? "valid" : "invalid",
  };
};

/**
 * Describe every byte after the image: erased flash (0xFF) and, at the next
 * 4 KiB boundary, a signature sector holding at least one valid block. Each
 * of the three slots is examined independently, as ESP-IDF's bootloader
 * does. In unstructured regions (the padding, the sector without a block or
 * its slack, the bytes after it) the first non-erased byte starts a range to
 * the region's end; a slot that is neither a block nor erased is reported
 * whole. Ranges are merged when adjacent.
 */
const trailingFacts = (
  observed: EspImageObservations,
  limitations: string[],
): {
  readonly blocks: EspImageSignatureBlock[];
  readonly undescribed: ByteRange[];
  readonly truncated: boolean;
} => {
  const { imageEnd: end, sectorOffset: sector, fileSize } = observed;
  const blocks: EspImageSignatureBlock[] = [];
  const undescribed: ByteRange[] = [];
  if (end === undefined || sector === undefined || fileSize <= end)
    return { blocks, undescribed, truncated: false };
  const add = (from: number | undefined, to: number): void => {
    if (from === undefined || to <= from) return;
    const last = undescribed.at(-1);
    if (last !== undefined && last.offset + last.length === from)
      undescribed[undescribed.length - 1] = {
        offset: last.offset,
        length: to - last.offset,
      };
    else undescribed.push({ offset: from, length: to - from });
  };
  add(observed.gapFirstUnerased, Math.min(sector, fileSize));
  const held = observed.sector.subarray(
    0,
    Math.max(0, Math.min(ESP_FLASH_SECTOR_BYTES, fileSize - sector)),
  );
  const slots = Array.from({ length: SIGNATURE_SLOTS }, (_, index) => {
    const from = index * ESP_SIGNATURE_BLOCK_BYTES;
    const bytes = held.subarray(from, from + ESP_SIGNATURE_BLOCK_BYTES);
    return {
      index,
      offset: sector + from,
      bytes,
      kind: bytes.length === 0 ? undefined : espSignatureSlot(bytes),
    };
  });
  for (const { index, offset, bytes, kind } of slots) {
    if (kind === "block") {
      const metadata = decodeEspSignatureBlock(
        bytes,
        index,
        observed.signedContent,
      );
      blocks.push({ offset, metadata });
      // A definite contradiction, like a checksum mismatch; the signature
      // itself stays unverified.
      if (metadata.image_digest_matches === false)
        limitations.push(
          ESP_IMAGE_LIMITATIONS.signatureDigestMismatch(index, offset),
        );
    } else if (kind === "other" && bytes[0] === 0xe7)
      limitations.push(
        ESP_IMAGE_LIMITATIONS.invalidSignatureSlot(index, offset),
      );
  }
  const sectorEnd = sector + ESP_FLASH_SECTOR_BYTES;
  const slotsEnd = sector + SIGNATURE_SLOTS * ESP_SIGNATURE_BLOCK_BYTES;
  if (blocks.length === 0) {
    // Without a block, the sector is ordinary trailing bytes.
    add(firstUnerased(held, sector), sector + held.length);
    add(observed.restFirstUnerased, fileSize);
    if (undescribed.length > 0 || fileSize >= slotsEnd)
      return { blocks, undescribed, truncated: false };
    // Erased padding cut short may be a signed image that lost its sector.
    limitations.push(ESP_IMAGE_LIMITATIONS.signatureSlotsCut(fileSize, sector));
    return { blocks, undescribed, truncated: true };
  }
  for (const { offset, bytes, kind } of slots)
    if (kind === "other") add(offset, offset + bytes.length);
  const slack = held.subarray(SIGNATURE_SLOTS * ESP_SIGNATURE_BLOCK_BYTES);
  add(firstUnerased(slack, slotsEnd), sector + held.length);
  add(observed.restFirstUnerased, fileSize);
  if (fileSize < sectorEnd) {
    limitations.push(
      ESP_IMAGE_LIMITATIONS.signatureSectorTruncated(
        sector,
        fileSize,
        sectorEnd,
      ),
    );
    return { blocks, undescribed, truncated: true };
  }
  return { blocks, undescribed, truncated: false };
};
