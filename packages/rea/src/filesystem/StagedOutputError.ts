const STAGED_OUTPUT_CODES = [
  "handle_already_owned",
  "identity_unverified",
  "identity_changed",
  "file_disappeared",
  "unexpected_entries",
  "directory_unverified",
  "directory_identity_changed",
] as const;

export type StagedOutputCode = (typeof STAGED_OUTPUT_CODES)[number];

/** Owned staged-output admission failure. `code` is the stable identity. */
export class StagedOutputError extends Error {
  readonly _tag = "StagedOutputError";

  constructor(
    readonly code: StagedOutputCode,
    readonly detail?: Readonly<Record<string, string | number>>,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "StagedOutputError";
  }
}
