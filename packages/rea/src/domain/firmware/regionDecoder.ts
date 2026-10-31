import type { Result } from "../result.js";

/** A whole-file refusal from a firmware decoder; no partial regions accompany it. */
export interface RegionDecodeFailure {
  readonly kind: "format" | "limit";
  readonly message: string;
  readonly boundary?: "file-size" | "capacity";
}

/** A streaming firmware decoder, fed the admitted file bytes in order. */
export interface RegionDecoder<Image> {
  write(chunk: Uint8Array): Result<void, RegionDecodeFailure>;
  finish(): Result<Image, RegionDecodeFailure>;
}
