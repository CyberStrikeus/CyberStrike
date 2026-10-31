export interface GhidraFileOffsetVerification {
  readonly cli_mcp_parity: true;
  readonly explicit_and_numeric_offsets: true;
  readonly invalid_and_unmapped_offsets: true;
  readonly mapped_offset_without_procedure: true;
  readonly ambiguous_mappings: "verified" | "unavailable-single-section";
  readonly source_unchanged: true;
  readonly cleanup: "complete";
}

/** Exercise file coordinates through public CLI/MCP using a source-owned PE fixture. */
export function verifyGhidraFileOffsets(
  targetPath: string,
  entrypoint: string,
  procedure: string,
): Promise<GhidraFileOffsetVerification>;
