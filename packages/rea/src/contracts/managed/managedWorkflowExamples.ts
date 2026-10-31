import { createEvidence } from "../../domain/evidence.js";
import type {
  ManagedMemberInspection,
  ManagedNativeBoundaryInspection,
} from "../../domain/managed/managedArtifact.js";
import type { InspectMacho } from "../../domain/native/nativeInspection.js";

const MANAGED_STATIC_EXAMPLE_PROVIDER = {
  id: "rea-dotnet-static",
  name: "REA managed static analysis provider",
  version: "1",
} as const;

const NATIVE_EXAMPLE_PROVIDER = {
  id: "native-macos",
  name: "REA native macOS provider",
  version: "1",
} as const;

const emptyManagedMembers = (
  sha256: string,
  mvid: string,
): ManagedMemberInspection => ({
  signature_resolution: null,
  assembly: null,
  artifact: {
    path: `/examples/${sha256.slice(0, 8)}.dll`,
    sha256,
    byte_length: 4096,
    format: "pe",
  },
  module: {
    name: "Example.dll",
    generation: 0,
    mvid,
    enc_id: null,
    enc_base_id: null,
    token: "0x00000001",
    row_offset: 0,
  },
  metadata: {
    status: "complete",
    version: "v4.0.30319",
    table_row_counts: {},
  },
  identity_scope: {
    token_identity: "build-local",
    requires_artifact_sha256: sha256,
    requires_mvid: mvid,
  },
  types: [],
  nesting_read: true,
  method_rows: { offset: 0, count: 0, total: 0 },
  exported_types: [],
  fields: [],
  methods: [],
  member_refs: [],
  call_edges: [],
  field_accesses: [],
  user_strings: { state: "complete", literals: [], issues: [] },
  selection: null,
  coverage: { state: "complete", issues: [] },
  limitations: [],
});

const evidence = (result: ManagedMemberInspection) =>
  createEvidence(undefined, MANAGED_STATIC_EXAMPLE_PROVIDER, {
    operation: "inspect_managed_members",
    parameters: {},
    result,
    rawResult: null,
    limitations: result.limitations,
  });

const runtimeMembers = (): ManagedMemberInspection => {
  const result = emptyManagedMembers(
    "2".repeat(64),
    "11112222-3333-4444-9555-666677778888",
  );
  return {
    ...result,
    methods: [
      {
        token: "0x06000001",
        row_offset: 128,
        declaring_type_token: "0x02000001",
        declaring_type: "Example.Program",
        name: "Main",
        rva: 8192,
        impl_flags: 0,
        flags: 22,
        signature: {
          raw_length: 3,
          raw_sha256: "3".repeat(64),
          resolved_sha256: "3".repeat(64),
          kind: "method",
          parse_status: "decoded",
          calling_convention: "default",
          generic_parameter_count: 0,
          parameter_count: 0,
          return_type: "void",
          parameter_types: [],
          field_type: null,
          issue: null,
        },
        body: {
          status: "present",
          header_format: "tiny",
          rva: 8192,
          file_offset: 512,
          max_stack: 8,
          init_locals: false,
          local_var_sig_token: null,
          local_var_signature: null,
          il_size: 1,
          il_sha256: "4".repeat(64),
          normalized_il_sha256: "5".repeat(64),
          instruction_count: 1,
          decoded_instruction_count: 1,
          truncated_instructions: 0,
          opcode_counts: { ret: 1 },
          anchors: [],
          exception_regions: [],
          issue: null,
        },
      },
    ],
  };
};

/** Minimal valid managed member comparison request for public contracts. */
export const MANAGED_MEMBER_COMPARISON_EXAMPLE = {
  left: evidence(
    emptyManagedMembers("0".repeat(64), "00112233-4455-6677-8899-aabbccddeeff"),
  ),
  right: evidence(
    emptyManagedMembers("1".repeat(64), "ffeeddcc-bbaa-4988-9766-554433221100"),
  ),
};

const runtimeExampleEvidence = evidence(runtimeMembers());

/** Minimal valid managed application graph projection request. */
export const MANAGED_APPLICATION_GRAPH_EXAMPLE = {
  managed_members: runtimeExampleEvidence,
};

const boundaryEvidence = () => {
  const result: ManagedNativeBoundaryInspection = {
    artifact: {
      path: "/examples/ManagedInterop.exe",
      sha256: "6".repeat(64),
      byte_length: 8192,
      format: "pe",
    },
    module: {
      name: "ManagedInterop.exe",
      generation: 0,
      mvid: "00112233-4455-4677-8899-aabbccddeeff",
      enc_id: null,
      enc_base_id: null,
      token: "0x00000001",
      row_offset: 0,
    },
    metadata: {
      status: "complete",
      version: "v4.0.30319",
      table_row_counts: {},
    },
    identity_scope: {
      token_identity: "build-local",
      requires_artifact_sha256: "6".repeat(64),
      requires_mvid: "00112233-4455-4677-8899-aabbccddeeff",
    },
    cli_native: {
      il_only: true,
      requires_32bit: false,
      strong_name_signed: false,
      native_entry_point: false,
      ready_to_run_signature: false,
      managed_native_header_rva: 0,
      managed_native_header_size: 0,
    },
    module_refs: [
      {
        token: "0x1a000001",
        row_offset: 256,
        name: "nativehelper.dll",
      },
    ],
    pinvoke_imports: [
      {
        token: "0x1c000001",
        row_offset: 288,
        mapping_flags: 0,
        mapping_flags_hex: "0x0000",
        member_token: "0x06000001",
        member_kind: "method",
        member_name: "OpenNative",
        import_name: "open_native",
        import_scope_token: "0x1a000001",
        import_scope_name: "nativehelper.dll",
        no_mangle: true,
        char_set: "not-specified",
        call_convention: "cdecl",
        supports_last_error: false,
        best_fit: "assembly-default",
        throw_on_unmappable_char: "assembly-default",
        verification: "managed-declaration-only",
      },
    ],
    native_implementations: [],
    summary: {
      module_ref_count: 1,
      pinvoke_import_count: 1,
      native_implementation_count: 0,
      ready_to_run: false,
      mixed_mode_or_native_header: false,
    },
    coverage: { state: "complete", issues: [] },
    limitations: [],
  };
  return createEvidence(undefined, MANAGED_STATIC_EXAMPLE_PROVIDER, {
    operation: "inspect_managed_native_boundaries",
    parameters: {},
    result,
    rawResult: null,
    limitations: result.limitations,
  });
};

const nativeExportEvidence = () => {
  const result: InspectMacho = {
    format: "mach-o",
    selected_architecture: { name: "x86_64", container_file_offset: null },
    endian: "little",
    word_size: 64,
    file_type: "dylib",
    flags: [],
    uuid: null,
    entrypoints: coverage([]),
    architectures: coverage([]),
    build_metadata: coverage([]),
    load_commands: coverage([]),
    dependencies: coverage([]),
    imports: coverage([]),
    exports: coverage([
      {
        name: "open_native",
        runtime_name: "open_native",
        address: "0x1000",
        weak: false,
        reexport: false,
        source: "nm",
      },
    ]),
    segments: coverage([]),
    encryption: coverage([]),
    provenance: [],
    limitations: [
      "Selected Mach-O slice container offset is unknown in this synthetic example.",
    ],
  };
  return createEvidence(
    {
      path: "/examples/nativehelper.dll",
      sha256: "7".repeat(64),
      format: "mach-o",
      architecture: "x86_64",
    },
    NATIVE_EXAMPLE_PROVIDER,
    {
      operation: "inspect_macho",
      parameters: {},
      result,
      rawResult: null,
      limitations: result.limitations,
    },
  );
};

const coverage = <Item>(items: readonly Item[]) => ({
  items: [...items],
  total: items.length,
  exhaustive: true,
  limitations: [],
});

/** Minimal valid managed decompiler reconstruction import request. */
export const MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE = {
  static_members: runtimeExampleEvidence,
  decompiler: {
    name: "ilspycmd",
    version: "9.1.0.7988",
    family: "ilspy",
    executable_sha256: null,
    options: ["--disable-updatecheck", "--type", "Example.Program"],
  },
  methods: [
    {
      token: "0x06000001",
      signature_sha256: "3".repeat(64),
      normalized_il_sha256: "5".repeat(64),
      reconstruction: {
        kind: "decompiled-csharp",
        language: "csharp",
        text: "internal static void Main() { }",
        source_path: "/examples/Example.Program.cs",
        start_line: 1,
        end_line: 1,
      },
    },
  ],
  notes: [
    "Synthetic example only; decompiler output is imported as inference.",
  ],
};

/** Minimal valid managed/native verification request. */
export const MANAGED_NATIVE_VERIFICATION_EXAMPLE = {
  managed_boundaries: boundaryEvidence(),
  native_observations: [nativeExportEvidence()],
};
