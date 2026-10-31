const EVM_ADMISSION_CODES = [
  "prlimit_not_absolute",
  "prlimit_not_file",
  "cleanup_incomplete",
  "cleanup_unconfirmed",
  "marker_mismatch",
  "request_path_missing",
  "tag_or_float",
  "text_bytes_unavailable",
  "collection_exceeds_bound",
  "nesting_exceeds_profile",
  "value_outside_profile",
  "repeated_map_key",
  "root_not_map",
] as const;

export type EvmAdmissionCode = (typeof EVM_ADMISSION_CODES)[number];

/** EVM limiter, worker, or metadata admission failure. `code` is the stable identity. */
export class EvmAdmissionError extends Error {
  readonly _tag = "EvmAdmissionError";

  constructor(
    readonly code: EvmAdmissionCode,
    readonly detail?: Readonly<Record<string, string | number>>,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "EvmAdmissionError";
  }
}
