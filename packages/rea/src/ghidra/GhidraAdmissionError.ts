const GHIDRA_ADMISSION_CODES = [
  "existing_project_windows",
  "existing_project_program_name",
  "existing_project_psp",
  "existing_project_dos",
  "existing_project_raw_binary",
  "existing_project_language_override",
  "existing_project_mips_soft_float",
  "existing_project_riscv_calling_convention",
  "existing_project_analysis",
  "gamecube_dol_combined",
  "psp_combined",
  "psp_raw_binary",
  "mips_soft_float_scope",
  "riscv_calling_convention_scope",
  "language_override_dos",
  "language_override_raw_binary",
  "raw_binary_dos",
  "invalid_environment_entry",
  "invalid_jvm_argument",
  "unterminated_quote",
  "platform_override",
  "argument_files_exceed_bound",
  "nested_argument_file",
  "argument_file_unreadable",
  "argument_file_path_invalid",
  "argument_files_require_scope",
  "prepared_options_exceed_bound",
  "output_unobserved",
  "handshake_identity",
  "response_shape",
  "response_json",
  "seed_path_differs",
  "seed_changed",
  "canonical_path",
  "nesting_exceeds_limit",
  "entry_kind",
  "component_missing",
  "loader_jar_missing",
  "bytes_exceed_limit",
  "properties_exceed_limit",
  "component_changed",
  "component_truncated",
  "properties_invalid",
  "metadata_mismatch",
  "host_unsupported",
  "inventory_exceeds_limit",
  "not_jar",
  "unregistered",
  "path_differs",
  "digest_differs",
] as const;

export type GhidraAdmissionCode = (typeof GHIDRA_ADMISSION_CODES)[number];

/** Ghidra launch, extension, or profile admission failure. `code` is the stable identity. */
export class GhidraAdmissionError extends Error {
  readonly _tag = "GhidraAdmissionError";

  constructor(
    readonly code: GhidraAdmissionCode,
    readonly detail?: Readonly<Record<string, string | number>>,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "GhidraAdmissionError";
  }
}
