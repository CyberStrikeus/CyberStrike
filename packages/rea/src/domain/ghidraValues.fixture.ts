export const ghidraFunctionClassification = () => ({
  external: false,
  thunk: false,
  thunk_target: null,
  provenance: "ghidra-function-manager" as const,
});

/** Wire-boundary fixture, not evidence that a real Ghidra run was performed. */
export const ghidraFunctionBody = () => ({
  available: true as const,
  provenance: "ghidra-function-body-address-set",
  ranges: [{ start: "0x401000", end: "0x401005" }],
  total_bytes: 6,
  span_bytes: 6,
  non_contiguous: false,
  contains_entry: true,
});

export const ghidraFunctionIdentity = () => ({
  address: "0x401000",
  name: "fixture_main",
  symbol: {
    primary: true,
    dynamic: false,
    external: false,
    type: "function",
    source: "imported" as const,
  },
  classification: ghidraFunctionClassification(),
  body: ghidraFunctionBody(),
});

const ghidraReferenceKind = () => ({
  available: true as const,
  provenance: "ghidra-reference-manager" as const,
  type: "DATA",
  flow: false,
  call: false,
  jump: false,
  data: true,
  read: true,
  write: false,
  indirect: false,
  computed: false,
  conditional: false,
  terminal: false,
  primary: true,
  operand_index: 0,
  external: false,
});

export const ghidraReferenceEdge = () => ({
  source_address: "0x401001",
  target_address: "0x402000",
  source_procedure: ghidraFunctionIdentity(),
  target_procedure: null,
  kind: ghidraReferenceKind(),
});

export const ghidraNativeApiBoundary = () => ({
  available: true as const,
  provenance: "ghidra-high-function",
  signature_source: "analysis",
  calling_convention: "__cdecl",
  return_type: {
    role: "return" as const,
    ordinal: null,
    name: null,
    data_type: "int",
    size_bytes: 4,
    storage: "EAX:4",
    confidence: "medium" as const,
    evidence: [
      {
        kind: "signature-source" as const,
        source: "ghidra-function-manager",
        detail: "Function signature source is analysis.",
      },
      {
        kind: "decompiler-type" as const,
        source: "ghidra-high-function",
        detail: "HighFunction recovered data type int.",
      },
    ],
    decompiler_artifacts: [
      "recovered-signature" as const,
      "register-or-stack-storage" as const,
    ],
  },
  parameters: [],
  jump_tables: [
    {
      dispatch_address: "0x401010",
      data_sources: [
        {
          address: "0x403000",
          provenance: "ghidra-decompiler-load-table" as const,
          entry_size_bytes: 4,
          entry_count: 2,
          confidence: "high" as const,
          evidence: [
            {
              kind: "jump-table" as const,
              source: "ghidra-high-function",
              detail: "Decompiler load table starts at 0x403000.",
            },
          ],
        },
      ],
      mappings: [
        {
          case_value: 0,
          target_address: "0x401020",
          confidence: "medium" as const,
          evidence: [
            {
              kind: "jump-table" as const,
              source: "ghidra-high-function",
              detail: "Recovered target 0x401020 from dispatch 0x401010.",
            },
          ],
        },
      ],
      default_targets: [
        {
          target_address: "0x401030",
          confidence: "high" as const,
          evidence: [
            {
              kind: "jump-table" as const,
              source: "ghidra-clang-case-token",
              detail:
                "Typed default label belongs to the block at 0x401030 with unique indirect dispatch predecessor 0x401010.",
            },
          ],
        },
      ],
      limitations: [],
    },
  ],
  pseudocode: {
    classification: "decompiler-generated-non-source" as const,
    compilable: false as const,
  },
  decompiler_artifacts: [
    "recovered-signature" as const,
    "register-and-stack-variables" as const,
    "compiler-generated-control-flow" as const,
    "pointer-arithmetic" as const,
    "pseudocode" as const,
  ],
  limitations: [
    "Pseudocode is neither original source nor guaranteed to compile.",
  ],
});

export const ghidraFunctionDossier = (): JsonValue => {
  const pseudocode = "int fixture_main(void) { return 42; }";
  return {
    procedure: {
      ...ghidraFunctionIdentity(),
      signature: "int fixture_main(void)",
      locals: [],
    },
    pseudocode,
    assembly: ["0x401000: CALL 0x401020", "0x401005: RET"],
    comments: [],
    facet_availability: {
      pseudocode: { available: true },
      assembly: { available: true },
      comments: { available: true },
      callers: { available: true },
      callees: { available: true },
      references: { available: true },
      strings_names: { available: true },
      cfg: { available: true },
    },
    callers: [],
    callees: [],
    incoming_references: [],
    outgoing_references: [ghidraReferenceEdge()],
    referenced_strings: [
      {
        address: "0x402000",
        value: "inventory fixture",
        source_address: "0x401001",
      },
    ],
    referenced_names: [],
    basic_blocks: [{ start: "0x401000", end: "0x401006", successors: [] }],
    native_api: ghidraNativeApiBoundary(),
    native_value_flow: {
      available: true,
      provenance: "ghidra-high-pcode",
      operations: [
        {
          id: "0x401000#0",
          address: "0x401000",
          sequence: 0,
          opcode: "COPY",
          is_dead: false,
          block_membership: "member",
          inputs: [
            {
              kind: "constant",
              size_bytes: 4,
              location: null,
              constant_hex: "2a",
            },
          ],
          output: {
            kind: "register",
            size_bytes: 4,
            location: "register:0x0",
            constant_hex: null,
          },
        },
      ],
      def_use: [],
      parameters: [],
      parameter_uses: [],
      effects: [],
      truncated: false,
      omitted_operations_lower_bound: 0,
      known_omitted_inputs: 0,
      known_omitted_edges: 0,
      limitations: [
        "High p-code is a decompiler-derived intra-function representation, not original source or runtime behavior.",
      ],
    },
    limitations: [
      "Unresolved computed or indirect flows without target addresses are not represented as reference edges.",
      "Thunk and external classifications are Ghidra FunctionManager observations; they do not resolve targetless calls.",
      "Pseudocode and assembly are Ghidra-specific representations, not original source or Hopper-equivalent text.",
    ],
  };
};
import type { JsonValue } from "./jsonValue.js";
