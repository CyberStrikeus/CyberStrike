import type { BinaryTarget } from "../domain/binaryTargetTypes.js";

/**
 * Target formats whose Ghidra load image REA verifies independently against
 * the admitted source bytes, named as callers select them.
 */
const VERIFIED_LOAD_IMAGE_FORMAT_LABELS = {
  "dos-mz": "DOS MZ",
  "dos-com": "explicitly selected DOS COM",
  "raw-binary": "caller-supplied raw-binary",
  "gamecube-dol": "caller-selected GameCube DOL",
} as const satisfies Partial<Record<BinaryTarget["format"], string>>;

export type GhidraVerifiedLoadImageFormat =
  keyof typeof VERIFIED_LOAD_IMAGE_FORMAT_LABELS;

/** Formats that receive independent load-image verification. */
export const GHIDRA_VERIFIED_LOAD_IMAGE_FORMATS = Object.freeze(
  Object.keys(
    VERIFIED_LOAD_IMAGE_FORMAT_LABELS,
  ) as GhidraVerifiedLoadImageFormat[],
);

export const isGhidraVerifiedLoadImageFormat = (
  format: string,
): format is GhidraVerifiedLoadImageFormat =>
  Object.hasOwn(VERIFIED_LOAD_IMAGE_FORMAT_LABELS, format);

const verifiedFormatsText = (): string => {
  const labels = GHIDRA_VERIFIED_LOAD_IMAGE_FORMATS.map(
    (format) => VERIFIED_LOAD_IMAGE_FORMAT_LABELS[format],
  );
  return `${labels.slice(0, -1).join(", ")} and ${labels.slice(-1).join("")}`;
};

/** Reason recorded when a load image's format is not independently verified. */
export const ghidraUnverifiedLoadImageReason = (): string =>
  `Independent load-image verification currently supports ${verifiedFormatsText()} targets only.`;

/** Capability note for inspect_native_load_image. */
export const ghidraLoadImageVerificationNote = (): string =>
  `Independent verification covers ${verifiedFormatsText()} targets; DOS COM checks include the measured entry context. Measured source mappings use inclusive end addresses and complete region digests; no target execution or project mutation occurs.`;
