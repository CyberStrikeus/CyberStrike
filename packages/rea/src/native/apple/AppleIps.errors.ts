/** Distinguish corrupt recognized IPS files from unsupported bug types. */
export class AppleIpsFormatFailure extends Error {
  constructor(
    readonly kind: "malformed" | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "AppleIpsFormatFailure";
  }
}

/** Caller-selected budgets that bound IPS row expansion. */
export type AppleIpsSelectedBoundary =
  | "threads"
  | "frames"
  | "images"
  | "registers"
  | "integer_text";

/** Fixed format ceilings that no caller argument raises. */
export type AppleIpsFixedBoundary =
  | "termination_reasons"
  | "unlisted_keys"
  | "nesting";

/** Resource boundary exceeded while walking an IPS crash report. */
export class AppleIpsResourceFailure extends Error {
  constructor(
    readonly boundary: AppleIpsSelectedBoundary | AppleIpsFixedBoundary,
    readonly maximum: number,
    message: string,
  ) {
    super(message);
    this.name = "AppleIpsResourceFailure";
  }
}
