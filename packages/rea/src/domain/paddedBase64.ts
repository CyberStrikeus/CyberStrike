import { isPaddedBase64 } from "./stringPatterns.js";

/** Validate padded syntax without imposing canonical zero pad bits. */
export const paddedBase64ByteLength = (value: string): number | undefined => {
  if (!isPaddedBase64(value)) return undefined;
  return Buffer.byteLength(value, "base64");
};

export const decodePaddedBase64 = (value: string): Buffer | undefined =>
  paddedBase64ByteLength(value) === undefined
    ? undefined
    : Buffer.from(value, "base64");
