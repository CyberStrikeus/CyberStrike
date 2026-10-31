import { expect, it } from "vitest";
import {
  binaryLayoutSchema,
  safeParseOwnedBinaryLayout,
  type BinaryLayout,
} from "./binaryLayout.js";
import { freezeJsonSnapshot } from "../immutableJson.js";

const report = () => ({
  artifact: { path: "/fixture.elf", sha256: "a".repeat(64), bytes: 128 },
  format: "elf",
  architecture: { machine: "EM_X86_64", bits: 64, byte_order: "little" },
  image_type: "ET_EXEC",
  entry_point: {
    reported_value: "0x20000000000001",
    meaning: "linked-virtual-address",
    execution_status: "unknown",
  },
  runtime_load_base: null,
  sections: [
    {
      index: 0,
      name: {
        display: "opaque",
        bytes_base64: "b3BhcXVl",
        location: { offset: "0x40", bytes: "0x7" },
        unknown_reason: null,
      },
      name_offset: "0x0",
      type: "SHT_NOBITS",
      header_location: { offset: "0x0", bytes: "0x40" },
      address: "0x20000000000001",
      offset: "0xffffffffffffffff",
      size: "0x2000",
      alignment: "0x1",
      flags: "0x3",
      link: 0,
      info: 0,
      entry_size: "0x0",
      file_backing: "none",
    },
  ],
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
  diagnostics: { stdout: "", stderr: "", truncated: false },
  limitations: [],
});

it("reuses an exact validated immutable layout without a second retained copy", () => {
  const value = freezeJsonSnapshot(report());
  const parsed = safeParseOwnedBinaryLayout(value);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw parsed.error;
  expect(parsed.data).toBe(value);
  expect(safeParseOwnedBinaryLayout(value)).toEqual(parsed);
  expect(parsed.data).toEqual(binaryLayoutSchema.parse(value));
  expect(Reflect.set(value.sections[0]!, "index", 5)).toBe(false);
});

it.each(["mutable", "shallow-frozen"])(
  "revalidates a changed %s layout instead of caching its former validity",
  (kind) => {
    const value = report();
    if (kind === "shallow-frozen") Object.freeze(value);
    const first = safeParseOwnedBinaryLayout(value);
    if (!first.success) throw first.error;
    expect(first.data).not.toBe(value);
    value.sections[0]!.header_location.offset = "0x80";
    const invalid = safeParseOwnedBinaryLayout(value);
    expect(invalid.success).toBe(false);
    expect(invalid).toEqual(binaryLayoutSchema.safeParse(value));
  },
);

it("never treats sealing as format validity or caches a refused layout", () => {
  const value = report();
  value.sections[0]!.index = 10;
  freezeJsonSnapshot(value);
  expect(safeParseOwnedBinaryLayout(value).success).toBe(false);
  expect(safeParseOwnedBinaryLayout(value).success).toBe(false);
});

it("does not borrow hidden fields that the format parser removed", () => {
  const value = report();
  Object.defineProperty(value, "not_in_parsed_result", {
    value: { unvalidated: true },
    enumerable: false,
  });
  freezeJsonSnapshot(value);
  for (let repeat = 0; repeat < 2; repeat += 1) {
    const parsed = safeParseOwnedBinaryLayout(value);
    if (!parsed.success) throw parsed.error;
    expect(parsed.data).not.toBe(value);
    expect(Object.hasOwn(parsed.data, "not_in_parsed_result")).toBe(false);
  }
});

it("retains high linked values and NOBITS without inventing file backing", () => {
  const value = binaryLayoutSchema.parse(report());
  expect(value.entry_point.reported_value).toBe("0x20000000000001");
  expect(value.sections[0]?.offset).toBe("0xffffffffffffffff");
  expect(value.runtime_load_base).toBeNull();
});

it.each([
  [{ machine: "EM_386", bits: 32, byte_order: "little" }, true],
  [{ machine: "EM_ARM", bits: 32, byte_order: "little" }, true],
  [{ machine: "EM_MIPS", bits: 32, byte_order: "little" }, true],
  [{ machine: "EM_MIPS", bits: 32, byte_order: "big" }, true],
  [{ machine: "EM_X86_64", bits: 32, byte_order: "little" }, false],
  [{ machine: "EM_ARM", bits: 32, byte_order: "big" }, false],
  [{ machine: "EM_386", bits: 64, byte_order: "little" }, false],
  [{ machine: "EM_MIPS", bits: 64, byte_order: "big" }, false],
])("admits only profiled architecture %j: %s", (architecture, admitted) => {
  expect(
    binaryLayoutSchema.safeParse({ ...report(), architecture }).success,
  ).toBe(admitted);
});

it.each([
  "file-backed-outside",
  "header-outside",
  "wrong-index",
  "noncanonical-base64",
  "wrong-machine",
  "outside-elf64",
])("rejects a malformed source representation: %s", (problem) => {
  const value = report();
  const section = value.sections[0];
  if (section === undefined) throw new Error("section missing");
  if (problem === "file-backed-outside") section.file_backing = "file";
  if (problem === "header-outside") section.header_location.offset = "0x80";
  if (problem === "wrong-index") section.index = 1;
  if (problem === "wrong-machine") value.architecture.machine = "EM_AARCH64";
  if (problem === "outside-elf64")
    value.entry_point.reported_value = "0x10000000000000000";
  if (problem === "noncanonical-base64") section.name.bytes_base64 = "AR==";
  expect(binaryLayoutSchema.safeParse(value).success).toBe(false);
});

it.each([
  ["PT_NULL", "0xffffffffffffffff", "none", null, true],
  ["PT_LOAD", "0x0", "none", { read: true, write: true, execute: false }, true],
  [
    "PT_LOAD",
    "0x1",
    "file",
    { read: true, write: false, execute: false },
    false,
  ],
  ["PT_NULL", "0x1", "file", null, false],
  [
    "PT_NULL",
    "0x1",
    "none",
    { read: false, write: false, execute: false },
    false,
  ],
  [
    "PT_LOAD",
    "0x1",
    "none",
    { read: true, write: false, execute: false },
    false,
  ],
])(
  "validates actual segment backing/meaning for %s size %s",
  (type, fileSize, backing, permissions, valid) => {
    const value = {
      ...report(),
      segments: [
        {
          index: 0,
          type,
          header_location: { offset: "0x0", bytes: "0x38" },
          offset: "0xffffffffffffffff",
          file_size: fileSize,
          memory_size: fileSize,
          virtual_address: "0x0",
          physical_address: "0x0",
          alignment: "0x0",
          flags: "0x0",
          file_backing: backing,
          permissions,
        },
      ],
    };
    expect(binaryLayoutSchema.safeParse(value).success).toBe(valid);
  },
);

it.each([
  ["ET_EXEC", "0x0", "absent", true],
  ["ET_DYN", "0x0", "linked-virtual-address", false],
  ["ET_REL", "0x0", "not-applicable", true],
  ["ET_EXEC", "0x1", "absent", false],
])(
  "validates actual entry meaning: %s %s %s",
  (imageType, entry, meaning, valid) => {
    expect(
      binaryLayoutSchema.safeParse({
        ...report(),
        image_type: imageType,
        entry_point: {
          reported_value: entry,
          meaning,
          execution_status: "unknown",
        },
      }).success,
    ).toBe(valid);
  },
);

it.each([
  "valid",
  "byte-length",
  "section-identity",
  "decoded-order",
  "noncanonical-bytes",
])(
  "retains original packed bytes and derived offset provenance: %s",
  (problem) => {
    const value = report();
    const section = value.sections[0];
    if (section === undefined) throw new Error("section missing");
    section.type = "SHT_RELR";
    section.file_backing = "file";
    section.offset = "0x60";
    section.size = "0x8";
    const table = {
      section_index: 0,
      location: { offset: "0x60", bytes: "0x8" },
      encoded_bytes_base64: "AAAAAAAAAAA=",
      entries: [{ decoded_index: 0, reported_offset: "0x20000000000001" }],
      offset_meaning: "linked-virtual-address",
      evidence_kind: "derived",
      entry_source_locations: null,
      addends: null,
    };
    if (problem === "byte-length") table.location.bytes = "0x7";
    if (problem === "section-identity") table.section_index = 1;
    if (problem === "decoded-order")
      table.entries[0] = { decoded_index: 1, reported_offset: "0x0" };
    if (problem === "noncanonical-bytes") table.encoded_bytes_base64 = "AB==";
    expect(
      binaryLayoutSchema.safeParse({
        ...value,
        packed_relative_relocations: [table],
      }).success,
    ).toBe(problem === "valid");
  },
);

it.each([
  "valid",
  "zero-symbol",
  "zero-without-table",
  "missing-table",
  "wrong-table-kind",
  "missing-symbol",
  "symbol-outside-table",
  "positive-without-table",
  "owner-link-mismatch",
  "wrong-meaning",
  "valid-section-target",
  "missing-target",
  "wrong-target-owner",
  "wrong-target-offset",
  "undefined-target",
  "inactive-target",
  "false-resolved-zero-target",
  "wrong-unknown-target",
  "missing-string-table",
  "wrong-string-table-kind",
  "elf32-symbol-entry",
  "elf32-undersized-symbol-entry",
  "elf64-elf32-sized-symbol-entry",
])("validates relocation symbol reference semantics: %s", (problem) => {
  const value = binaryLayoutSchema.parse(report());
  value.artifact.bytes = 512;
  const base = value.sections[0];
  if (base === undefined) throw new Error("section missing");
  value.sections.push(
    {
      ...base,
      index: 1,
      type: "SHT_SYMTAB",
      link: 3,
      header_location: { offset: "0x40", bytes: "0x40" },
      offset: "0x100",
      size: "0x30",
      entry_size: "0x18",
      file_backing: "file",
    },
    {
      ...base,
      index: 2,
      type: "SHT_RELA",
      header_location: { offset: "0x80", bytes: "0x40" },
      offset: "0x130",
      size: "0x18",
      entry_size: "0x18",
      link: 1,
      file_backing: "file",
    },
    {
      ...base,
      index: 3,
      type: "SHT_STRTAB",
      offset: "0x40",
      size: "0x7",
      file_backing: "file",
    },
  );
  value.symbols.push({
    table_index: 1,
    entry_index: 1,
    name: base.name,
    name_offset: "0x0",
    location: { offset: "0x118", bytes: "0x18" },
    value: "0x0",
    value_meaning: "undefined",
    size: "0x0",
    binding: "STB_GLOBAL",
    type: "STT_NOTYPE",
    visibility: "STV_DEFAULT",
    section_index: "SHN_UNDEF",
  });
  const relocation: BinaryLayout["relocations"][number] = {
    section_index: 2,
    entry_index: 0,
    reported_offset: "0x0",
    target: { kind: "linked-virtual-address", address: "0x0" },
    location: { offset: "0x130", bytes: "0x18" },
    type: 1,
    symbol_table_index: 1,
    symbol_index: 1,
    symbol_reference_meaning: "symbol-table-entry",
    addend: "0",
  };
  const table = value.sections[1];
  const owner = value.sections[2];
  if (table === undefined || owner === undefined)
    throw new Error("table or relocation owner missing");
  if (problem.startsWith("zero")) {
    relocation.symbol_index = 0;
    relocation.symbol_reference_meaning = "zero-symbol-value";
  }
  if (problem === "zero-without-table" || problem === "positive-without-table")
    owner.link = relocation.symbol_table_index = 0;
  if (problem === "missing-table")
    owner.link = relocation.symbol_table_index = 99;
  if (problem === "wrong-table-kind") table.type = "SHT_PROGBITS";
  if (problem === "missing-string-table") table.link = 99;
  if (problem === "wrong-string-table-kind") table.link = 0;
  if (problem === "missing-symbol") value.symbols = [];
  if (problem === "symbol-outside-table") table.size = "0x18";
  if (problem === "owner-link-mismatch") owner.link = 0;
  if (problem === "wrong-meaning")
    relocation.symbol_reference_meaning = "zero-symbol-value";
  // Elf32_Sym is 16 bytes and Elf64_Sym 24; the minimum follows the ELF class.
  if (problem.includes("elf32")) {
    if (problem.startsWith("elf32"))
      value.architecture = {
        machine: "EM_386",
        bits: 32,
        byte_order: "little",
      };
    table.size = "0x20";
    table.entry_size = problem.includes("undersized") ? "0xc" : "0x10";
  }
  if (problem.includes("target")) {
    value.image_type = "ET_REL";
    value.entry_point.meaning = "not-applicable";
    owner.info = 1;
    relocation.target = {
      kind: "section-offset",
      section_index:
        problem === "missing-target"
          ? 99
          : problem === "wrong-target-owner"
            ? 2
            : 1,
      offset: problem === "wrong-target-offset" ? "0x1" : "0x0",
    };
    if (problem === "missing-target") owner.info = 99;
    if (problem === "false-resolved-zero-target") {
      owner.info = 0;
      relocation.target.section_index = 0;
    }
    if (
      ["undefined-target", "inactive-target", "wrong-unknown-target"].includes(
        problem,
      )
    ) {
      if (problem === "inactive-target")
        value.sections.push({ ...base, index: 4, type: "SHT_NULL" });
      owner.info =
        problem === "undefined-target"
          ? 0
          : problem === "inactive-target"
            ? 4
            : 1;
      relocation.target = {
        kind: "unknown-section",
        reported_section_index: owner.info,
        offset: "0x0",
        unknown_reason:
          problem === "undefined-target"
            ? "undefined-section-reference"
            : "inactive-section-header",
      };
    }
  }
  value.relocations.push(relocation);
  expect(binaryLayoutSchema.safeParse(value).success).toBe(
    [
      "valid",
      "zero-symbol",
      "zero-without-table",
      "valid-section-target",
      "undefined-target",
      "inactive-target",
      "elf32-symbol-entry",
    ].includes(problem),
  );
});
