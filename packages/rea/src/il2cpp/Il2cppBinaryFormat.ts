export const IL2CPP_BINARY_FAILURE_REASONS = {
  unsupported: [
    "unsupported-container",
    "slice-selection-required",
    "slice-not-found",
    "ambiguous-slice-selection",
    "unsupported-pointer-encoding",
    "unsupported-type-kind",
    "generic-methods-unsupported",
  ],
  capacity: [
    "native-index-capacity",
    "type-nesting-capacity",
    "native-type-text-capacity",
  ],
  malformed: [
    "malformed-container",
    "code-gen-modules-not-found",
    "ambiguous-code-gen-module",
    "code-registration-not-found",
    "invalid-method-pointer",
    "invalid-method-token",
    "metadata-registration-not-found",
    "invalid-type",
    "generic-method-registration-not-found",
    "ambiguous-generic-method-registration",
  ],
} as const;

export type Il2cppBinaryFailureReason =
  (typeof IL2CPP_BINARY_FAILURE_REASONS)[keyof typeof IL2CPP_BINARY_FAILURE_REASONS][number];

/** A native image REA cannot link, either outside coverage or inconsistent with the metadata. */
export class Il2cppBinaryFormatFailure extends Error {
  readonly kind: "unsupported" | "malformed" | "capacity";
  constructor(
    readonly reason: Il2cppBinaryFailureReason,
    message: string,
  ) {
    super(`${reason}: ${message}`);
    this.name = "Il2cppBinaryFormatFailure";
    this.kind = (
      IL2CPP_BINARY_FAILURE_REASONS.unsupported as readonly string[]
    ).includes(reason)
      ? "unsupported"
      : (IL2CPP_BINARY_FAILURE_REASONS.capacity as readonly string[]).includes(
            reason,
          )
        ? "capacity"
        : "malformed";
  }
}
