import type { BinaryLayout } from "../../../src/domain/native/binaryLayout.js";

/** Small source-owned provider observation for validation and transport tests. */
export const binaryLayoutFixture = (
  path = "/artifacts/source-owned.elf",
): BinaryLayout => ({
  artifact: { path, sha256: "a".repeat(64), bytes: 128 },
  format: "elf",
  architecture: { machine: "EM_X86_64", bits: 64, byte_order: "little" },
  image_type: "ET_REL",
  entry_point: {
    reported_value: "0x0",
    meaning: "not-applicable",
    execution_status: "unknown",
  },
  runtime_load_base: null,
  sections: [],
  segments: [],
  symbols: [],
  relocations: [],
  packed_relative_relocations: [],
  relocation_inventory_completeness: "unknown",
  linkage: {
    needed_libraries: [],
    interpreters: [],
    got: [],
    plt: [],
    convenience_maps_completeness: "unknown",
    runtime_library_paths: null,
  },
  mitigations: {
    evidence_kind: "inferred",
    position_independent: false,
    nx_indicator: null,
    executable_stack_indicator: false,
    stack_canary_indicator: false,
    relro: null,
  },
  diagnostics: { stdout: "producer warning", stderr: "", truncated: false },
  limitations: ["Runtime addresses remain unknown."],
});

/** Producer identity belongs to the test seam, not a simulated installed engine claim. */
export const BINARY_LAYOUT_TEST_PROVIDER = {
  id: "fixture-layout",
  name: "Source-owned layout seam",
  version: "1",
} as const;
