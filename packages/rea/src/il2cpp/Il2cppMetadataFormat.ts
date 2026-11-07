/** Stable machine-readable reason for each rejected input. */
export const IL2CPP_METADATA_FAILURE_REASONS = {
  unsupported: ["unrecognized-magic", "unsupported-version"],
  corrupt: [
    "truncated-header",
    "unexpected-header-size",
    "section-out-of-bounds",
    "section-overlap",
    "record-size-mismatch",
    "type-index-width",
    "index-out-of-range",
    "nested-type-conflict",
    "declaring-type-mismatch",
    "image-range-overlap",
    "invalid-string",
  ],
} as const;
export type Il2cppMetadataFailureKind =
  keyof typeof IL2CPP_METADATA_FAILURE_REASONS;
export type Il2cppMetadataFailureReason =
  (typeof IL2CPP_METADATA_FAILURE_REASONS)[Il2cppMetadataFailureKind][number];

/** Distinguish inputs outside decoder coverage from damaged metadata. */
export class Il2cppMetadataFormatFailure extends Error {
  readonly kind: Il2cppMetadataFailureKind;
  constructor(
    readonly reason: Il2cppMetadataFailureReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${reason}: ${message}`, options);
    this.name = "Il2cppMetadataFormatFailure";
    this.kind = (
      IL2CPP_METADATA_FAILURE_REASONS.unsupported as readonly string[]
    ).includes(reason)
      ? "unsupported"
      : "corrupt";
  }
}

/** Validate a section against a known serialized record width once. */
export const checkedSectionCount = (
  section: Il2cppMetadataSection,
  recordBytes: number,
): number => {
  if (section.size % recordBytes !== 0)
    throw new Il2cppMetadataFormatFailure(
      "record-size-mismatch",
      `section ${section.name} size ${section.size} is not a whole multiple of its ${recordBytes}-byte records`,
    );
  const count = section.size / recordBytes;
  if (section.count !== null && count !== section.count)
    throw new Il2cppMetadataFormatFailure(
      "record-size-mismatch",
      `section ${section.name} size ${section.size} does not hold ${section.count} ${recordBytes}-byte records`,
    );
  return count;
};

export const checkRange = (
  label: string,
  start: number,
  length: number,
  total: number,
) => {
  if (length === 0 && start >= -1 && start <= total) return;
  if (start < 0 || start + length > total)
    throw new Il2cppMetadataFormatFailure(
      "index-out-of-range",
      `${label} range [${start}, ${start + length}) is outside the ${total} available entries`,
    );
};

/** Read a serialized index; the all-ones value of narrow widths means -1. */
export const readIndex = (bytes: Buffer, offset: number, width: 1 | 2 | 4) => {
  if (width === 1) {
    const value = bytes.readUInt8(offset);
    return value === 0xff ? -1 : value;
  }
  if (width === 2) {
    const value = bytes.readUInt16LE(offset);
    return value === 0xffff ? -1 : value;
  }
  return bytes.readInt32LE(offset);
};
import type { Il2cppMetadataSection } from "../domain/il2cpp/il2cppMetadata.js";
