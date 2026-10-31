const KUNA_DOCUMENT_CODES = [
  "invalid_address",
  "address_exceeds_u64",
  "buffered_capacity",
  "row_field",
  "not_kuna_number",
  "not_json_object",
  "member_not_container",
  "row_not_object",
  "row_not_array",
  "row_must_be_null",
  "field_must_be_empty",
  "repeated_field",
  "value_without_member",
  "rows_not_array",
  "not_object",
  "not_scalar",
  "unexpected_token",
  "encoding_contradicts_text",
  "length_contradicts_text",
  "address_hex_disagrees",
  "repeated_identity",
  "repeated_function",
  "repeated_edge",
  "repeated_callee_order",
  "xref_identity",
  "xref_count",
  "xref_alias_hex",
  "xref_endpoints",
  "xref_function_hex",
  "xref_target",
  "span_short",
  "command_not_file",
  "stop_unproven",
] as const;

export type KunaDocumentCode = (typeof KUNA_DOCUMENT_CODES)[number];

/** Kuna document or command admission failure. `code` is the stable identity. */
export class KunaDocumentError extends Error {
  readonly _tag = "KunaDocumentError";

  constructor(
    readonly code: KunaDocumentCode,
    readonly detail?: Readonly<Record<string, string | number>>,
  ) {
    super(code);
    this.name = "KunaDocumentError";
  }
}
