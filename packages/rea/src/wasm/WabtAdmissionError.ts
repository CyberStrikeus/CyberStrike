const WABT_ADMISSION_CODES = [
  "incomplete_string",
  "unsupported_escape",
  "incomplete_comment",
  "malformed_form",
  "name_missing",
  "incomplete_import",
  "incomplete_export",
  "unsupported_section_header",
  "unrecognized_section_row",
  "blank_custom_name",
  "custom_header_mismatch",
  "incomplete_section_row",
  "section_ranges",
  "custom_inventory_mismatch",
  "section_coverage",
  "incomplete_name_metadata",
  "name_subsection_order",
  "incomplete_module_name",
  "unfinished_module_name",
  "unsupported_module_prefix",
  "unexpected_string",
  "unexpected_second_module",
  "unsupported_custom_name",
  "unsupported_name_payload",
  "unbalanced_output",
  "unexpected_text",
  "incomplete_output",
  "directory_not_absolute",
  "incomplete_tool_profile",
] as const;

export type WabtAdmissionCode = (typeof WABT_ADMISSION_CODES)[number];

/** WABT output or tool-profile admission failure. `code` is the stable identity. */
export class WabtAdmissionError extends Error {
  readonly _tag = "WabtAdmissionError";

  constructor(
    readonly code: WabtAdmissionCode,
    readonly detail?: Readonly<Record<string, string | number>>,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "WabtAdmissionError";
  }
}
