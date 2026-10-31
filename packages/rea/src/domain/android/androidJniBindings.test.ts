import { expect, it } from "vitest";
import {
  androidJniReportSchema,
  expectedJniNames,
  projectAndroidJniBindings,
  type AndroidJniLibraryObservation,
  type AndroidJniSelection,
} from "./androidJniBindings.js";
import type {
  AndroidNativeDeclaration,
  AndroidNativeDeclarations,
} from "./androidNativeDeclarations.js";
import type { AndroidJniLibraryFacts } from "./androidJniLibraryFacts.js";

const declaration = (
  changes: Partial<AndroidNativeDeclaration> = {},
): AndroidNativeDeclaration => ({
  source_index: 0,
  class_name: "fixture.Native",
  method_name: "readNative",
  descriptor: "(I)I",
  dex_entry: "classes.dex",
  dex_entry_index: 0,
  class_index: 0,
  method_index: 1,
  ...changes,
});

const inventory = (methods = [declaration()]): AndroidNativeDeclarations => ({
  scope: "apk-root-dex-declarations",
  methods,
  coverage: {
    status: "complete",
    dex_entries: 1,
    examined_dex_entries: 1,
    examined_classes: methods.length,
    examined_methods: methods.length,
  },
  unknowns: [],
});

const exportRow = (
  source_index: number,
  name = "Java_fixture_Native_readNative",
  address = "0x1000",
) => ({
  source_index,
  name,
  address,
  file_offset: 512,
});
const table = (): AndroidJniLibraryFacts["tables"][number] => ({
  section_index: 12,
  section_name: ".data",
  table_address: "0x2000",
  entries: [
    {
      entry_index: 0,
      name: "readNative",
      descriptor: "(I)I",
      function_address: "0x1000",
      code_address: "0x1000",
      function_file_offset: 512,
      slots: [
        {
          role: "name",
          address: "0x2000",
          file_offset: 1536,
          value: "0x3000",
          relocation: { encoding: "rela", record_file_offset: 256, kind: 1027 },
        },
        {
          role: "signature",
          address: "0x2008",
          file_offset: 1544,
          value: "0x3010",
          relocation: { encoding: "rela", record_file_offset: 280, kind: 1027 },
        },
        {
          role: "function",
          address: "0x2010",
          file_offset: 1552,
          value: "0x1000",
          relocation: { encoding: "rela", record_file_offset: 304, kind: 1027 },
        },
      ],
    },
  ],
});
const facts = (
  changes: Partial<AndroidJniLibraryFacts> = {},
): AndroidJniLibraryFacts => ({
  architecture: "arm64",
  bits: 64,
  byte_order: "little",
  exports: [],
  jni_on_load: false,
  tables: [],
  coverage: {
    status: "complete",
    exports_status: "complete",
    tables_status: "complete",
    relocations_status: "complete",
    examined_sections: 1,
    examined_pointer_slots: 3,
  },
  unknowns: [],
  ...changes,
});
const library = (
  source_index: number,
  abi = "arm64-v8a",
  observed = facts(),
): AndroidJniLibraryObservation => ({
  library_id: `library-${source_index}`,
  source_index,
  source_key: `zip-entry-${source_index}`,
  path: `lib/${abi}/lib${source_index}.so`,
  source_path: `lib/${abi}/lib${source_index}.so`,
  abi,
  sha256: "b".repeat(64),
  size: 8192,
  declared_size: 8192,
  compressed_size: 4096,
  facts: observed,
  failure: null,
});
const project = (
  observed = [library(0)],
  declarations = inventory(),
  selection: AndroidJniSelection = {},
) => {
  const result = projectAndroidJniBindings({
    apk: { path: "/selected/app.apk", sha256: "a".repeat(64) },
    selection,
    inventory: declarations,
    libraries: observed,
    libraryInventory: {
      status: "complete",
      examined_entries: observed.length,
      selected_libraries: observed.length,
      unknowns: [],
    },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  expect(androidJniReportSchema.safeParse(result.value).success).toBe(true);
  return result.value;
};

it.each([
  [
    "p.q.Native",
    "read",
    "(I)V",
    "Java_p_q_Native_read",
    "Java_p_q_Native_read__I",
  ],
  [
    "p.Native",
    "read_buffer",
    "([Ljava/lang/String;[I)J",
    "Java_p_Native_read_1buffer",
    "Java_p_Native_read_1buffer___3Ljava_lang_String_2_3I",
  ],
  [
    "fixture.Native_原",
    "read_原",
    "([B)J",
    "Java_fixture_Native_1_0539f_read_1_0539f",
    "Java_fixture_Native_1_0539f_read_1_0539f___3B",
  ],
  [
    "p.𐐀$Inner",
    "method",
    "()V",
    "Java_p__0d801_0dc00_00024Inner_method",
    "Java_p__0d801_0dc00_00024Inner_method__",
  ],
  [
    "p.Native",
    "f_é",
    "(Lp/原;)V",
    "Java_p_Native_f_1_000e9",
    "Java_p_Native_f_1_000e9__Lp__0539f_2",
  ],
])(
  "projects exact UTF-16 JNI names for %s.%s",
  (className, method, descriptor, short, long) => {
    expect(expectedJniNames(className, method, descriptor)).toEqual({
      ok: true,
      value: { short, long },
    });
  },
);

it.each(["0", "1", "2", "3"])(
  "reports source-digit %s escape failure at every JNI precursor boundary",
  (digit) => {
    for (const [className, method, descriptor] of [
      [`${digit}Native`, "read", "()V"],
      [`p.${digit}Native`, "read", "()V"],
      ["p.Native", `${digit}read`, "()V"],
      ["p.Native", "read", `(Lp/${digit}Argument;)V`],
    ])
      expect(expectedJniNames(className!, method!, descriptor!)).toEqual({
        ok: false,
        error: { kind: "escape-failure" },
      });
  },
);

it("does not confuse literal underscores with package separators or digits 4–9", () => {
  expect(expectedJniNames("p.Native_1", "_3read", "()V")).toMatchObject({
    ok: true,
    value: { short: "Java_p_Native_11__13read" },
  });
  expect(expectedJniNames("p.4Native", "4read", "()V")).toMatchObject({
    ok: true,
  });
});

it("uses the global native pair inventory before narrowing to a class", () => {
  const global = inventory([
    declaration(),
    declaration({
      source_index: 1,
      class_name: "fixture.Other",
      class_index: 1,
      method_index: 2,
    }),
  ]);
  const report = project(
    [library(0, "arm64-v8a", facts({ tables: [table()] }))],
    global,
    { class_name: "fixture.Native" },
  );
  expect(report.declarations).toHaveLength(2);
  expect(report.bindings).toHaveLength(1);
  expect(report.bindings[0]?.status).toBe("ambiguous");
  expect(report.candidates[0]).toMatchObject({
    class_attribution: "ambiguous-native-pair",
    declaration_ids: report.declarations.map((row) => row.declaration_id),
  });
});

it("keeps duplicate encoded method occurrences independently identifiable", () => {
  const duplicate = inventory([
    declaration(),
    declaration({ source_index: 1 }),
  ]);
  const report = project(
    [library(0, "arm64-v8a", facts({ tables: [table()] }))],
    duplicate,
  );
  expect(
    new Set(report.declarations.map((method) => method.declaration_id)).size,
  ).toBe(2);
  expect(report.candidates[0]?.declaration_ids).toEqual(
    report.declarations.map((method) => method.declaration_id),
  );
  expect(report.bindings.map((binding) => binding.status)).toEqual([
    "ambiguous",
    "ambiguous",
  ]);
});

it("keeps libraries within their ABI and preserves same-ABI alternatives", () => {
  const report = project([
    library(0, "arm64-v8a", facts({ exports: [exportRow(0)] })),
    library(1, "arm64-v8a", facts({ exports: [exportRow(0)] })),
    library(
      2,
      "x86_64",
      facts({ architecture: "amd64", exports: [exportRow(0)] }),
    ),
    library(3, "x86", facts({ architecture: "386", bits: 32 })),
  ]);
  expect(report.bindings.map(({ abi, status }) => ({ abi, status }))).toEqual([
    { abi: "arm64-v8a", status: "ambiguous" },
    { abi: "x86_64", status: "matched" },
    { abi: "x86", status: "unmatched" },
  ]);
  expect(report.bindings[0]?.candidate_ids).toHaveLength(2);
});

it("preserves physical export rows without inventing ambiguity at one target address", () => {
  const report = project([
    library(0, "arm64-v8a", facts({ exports: [exportRow(1), exportRow(2)] })),
  ]);
  expect(report.candidates).toHaveLength(2);
  expect(
    new Set(report.candidates.map((candidate) => candidate.candidate_id)).size,
  ).toBe(2);
  expect(report.bindings[0]).toMatchObject({
    status: "matched",
    candidate_ids: report.candidates.map((candidate) => candidate.candidate_id),
  });
});

it("retains the long export while respecting the VM's short-name-first lookup", () => {
  const report = project([
    library(
      0,
      "arm64-v8a",
      facts({
        exports: [
          exportRow(0),
          exportRow(1, "Java_fixture_Native_readNative__I", "0x1100"),
        ],
      }),
    ),
  ]);
  expect(report.candidates).toHaveLength(2);
  expect(report.candidates[1]?.declaration_ids).toEqual([]);
  expect(report.bindings[0]).toMatchObject({
    status: "matched",
    candidate_ids: [report.candidates[0]?.candidate_id],
  });
});

it("looks up the long name when no short export exists", () => {
  const report = project([
    library(
      0,
      "arm64-v8a",
      facts({ exports: [exportRow(0, "Java_fixture_Native_readNative__I")] }),
    ),
  ]);
  expect(report.bindings[0]?.status).toBe("matched");
});

it.each([{ method_names: [] }, { descriptors: [] }, { abis: [] }])(
  "honors an explicitly empty selection %j",
  (selection) => {
    const report = project(
      [library(0, "arm64-v8a", facts({ tables: [table()] }))],
      inventory(),
      selection,
    );
    expect(report.bindings).toEqual([]);
    expect(report.declarations).toHaveLength(1);
  },
);

it("keeps an explicit empty library selection without introducing ABI candidates", () => {
  const report = project([], inventory(), {
    library_paths: [],
    abis: ["arm64-v8a"],
  });
  expect(report.libraries).toEqual([]);
  expect(report.candidates).toEqual([]);
  expect(report.bindings[0]).toMatchObject({
    abi: "arm64-v8a",
    status: "unmatched",
    candidate_ids: [],
  });
});

it("preserves selected native declarations when no library establishes an ABI", () => {
  const report = project([], inventory());
  expect(report.bindings).toEqual([]);
  expect(report.libraries).toEqual([]);
  expect(report.declarations).toHaveLength(1);
  expect(report.selected_declaration_ids).toEqual([
    report.declarations[0]?.declaration_id,
  ]);
  expect(report.native_inventory.coverage.status).toBe("complete");
});

it("applies exact library-path selection at the shared join boundary", () => {
  const first = library(0, "arm64-v8a", facts({ exports: [exportRow(0)] }));
  const selected = library(1, "arm64-v8a", facts({ exports: [exportRow(0)] }));
  const report = project([first, selected], inventory(), {
    library_paths: [selected.path],
  });
  expect(report.libraries.map((observation) => observation.library_id)).toEqual(
    [selected.library_id],
  );
  expect(report.library_inventory.selected_libraries).toBe(1);
  expect(report.bindings[0]?.status).toBe("matched");
  expect(report.candidates.map((candidate) => candidate.library_id)).toEqual([
    selected.library_id,
  ]);
});

it("keeps table attribution unknown for an incomplete global native inventory", () => {
  const partial = inventory();
  partial.coverage.status = "partial";
  partial.coverage.dex_entries = 2;
  partial.unknowns.push("classes2.dex is unreadable");
  const report = project(
    [library(0, "arm64-v8a", facts({ tables: [table()] }))],
    partial,
  );
  expect(report.candidates[0]?.class_attribution).toBe(
    "unknown-native-inventory",
  );
  expect(report.bindings[0]?.status).toBe("unknown");
  expect(report.native_inventory.unknowns).toEqual(partial.unknowns);
});

it("preserves every table slot and raw Thumb pointer separately from its code lookup", () => {
  const observed = table();
  observed.entries[0]!.function_address = "0x1001";
  observed.entries[0]!.slots[2]!.value = "0x1001";
  const report = project([
    library(
      0,
      "armeabi-v7a",
      facts({ architecture: "arm", bits: 32, tables: [observed] }),
    ),
  ]);
  expect(report.candidates[0]).toMatchObject({
    address: "0x1001",
    file_offset: 512,
    table: {
      section_index: 12,
      section_name: ".data",
      table_address: "0x2000",
      entry: observed.entries[0],
    },
  });
  expect(report.candidates[0]?.table?.entry.code_address).toBe("0x1000");
});

it("does not turn a library failure into an unmatched result", () => {
  const failed = library(0);
  const report = project([
    {
      ...failed,
      facts: null,
      failure: { kind: "malformed", message: "selected ELF is truncated" },
    },
  ]);
  expect(report.bindings[0]?.status).toBe("unknown");
  expect(report.libraries[0]?.failure).toEqual({
    kind: "malformed",
    message: "selected ELF is truncated",
  });
});

it("preserves a candidate in a mismatched ABI directory with an unknown binding", () => {
  const report = project([
    library(
      0,
      "x86_64",
      facts({ architecture: "arm64", exports: [exportRow(0)] }),
    ),
  ]);
  expect(report.candidates).toHaveLength(1);
  expect(report.libraries[0]).toMatchObject({
    abi: "x86_64",
    architecture: "arm64",
    abi_compatibility: "mismatch",
  });
  expect(report.bindings[0]).toMatchObject({
    status: "unknown",
    candidate_ids: [],
  });
});

it("preserves an observed export with explicit incomplete uniqueness coverage", () => {
  const observed = facts({ exports: [exportRow(0)] });
  observed.coverage.status = "partial";
  observed.coverage.relocations_status = "unknown";
  observed.coverage.tables_status = "unknown";
  observed.unknowns.push(
    "Android packed APS2 relocation encoding is unsupported",
  );
  const report = project([library(0, "arm64-v8a", observed)]);
  expect(report.candidates[0]?.basis).toBe("jni-export");
  expect(report.bindings[0]).toMatchObject({
    status: "matched",
    coverage: "partial",
    candidate_ids: [report.candidates[0]?.candidate_id],
  });
  expect(report.libraries[0]?.unknowns).toEqual(observed.unknowns);
});
