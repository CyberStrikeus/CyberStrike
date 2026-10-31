import { describe, expect, it } from "vitest";
import { inspectMachoSchema } from "../native/nativeInspection.js";

import {
  analysisViewResultSchema,
  projectAnalysisView,
  type AnalysisViewParent,
} from "./analysisView.js";

it("binds every Mach-O facet to its rows, including empty pages", () => {
  for (const facet of [
    "entrypoints",
    "architectures",
    "build_metadata",
    "load_commands",
    "dependencies",
    "imports",
    "exports",
    "segments",
    "provenance",
  ] as const) {
    for (const offset of [0, 999]) {
      const projected = projectAnalysisView(parent(), {
        kind: "macho",
        facet,
        offset,
        limit: 64,
      });
      if (!projected.ok) throw projected.error;
      expect(analysisViewResultSchema.safeParse(projected.value).success).toBe(
        true,
      );
      if (offset === 0)
        expect(
          analysisViewResultSchema.safeParse({
            ...projected.value,
            view: {
              kind: "macho",
              facet: facet === "entrypoints" ? "exports" : "entrypoints",
              offset,
              limit: 64,
            },
          }).success,
        ).toBe(false);
    }
  }
});

it("keeps historical symbol defaults scoped to their selected Mach-O facet", () => {
  const { runtime_name: _runtimeName, ...historical } = symbol("_malloc");
  const projected = projectAnalysisView(
    parent({
      ...report,
      imports: coverage([historical]),
      exports: coverage([historical]),
    }),
    { kind: "macho", facet: "exports", offset: 0, limit: 64 },
  );
  if (!projected.ok || projected.value.kind !== "macho")
    throw new Error("Expected Mach-O page");
  expect(projected.value.item).toEqual([{ ...historical, runtime_name: null }]);
  expect(projected.value.item[0]).not.toHaveProperty("raw_name");
  expect(
    analysisViewResultSchema.safeParse({
      ...projected.value,
      item: undefined,
    }).success,
  ).toBe(false);
});

const symbol = (name: string) => ({
  name,
  runtime_name: name.slice(1),
  address: null,
  weak: null,
  reexport: null,
  source: "libSystem",
});
const coverage = <T>(items: T[], exhaustive = true) => ({
  items,
  total: exhaustive ? items.length : null,
  exhaustive,
  limitations: exhaustive ? [] : ["nm output may omit stripped symbols."],
});
const report = {
  format: "mach-o",
  selected_architecture: { name: "arm64", container_file_offset: 0 },
  endian: null,
  word_size: 64,
  file_type: "2",
  flags: ["0x00200085"],
  uuid: "4C4C44E9-5555-3144-A1E9-D858E24A1CCE",
  entrypoints: coverage([{ file_offset: 16384 }]),
  architectures: coverage([
    {
      name: "arm64",
      cpu_type: "16777228",
      cpu_subtype: "0",
      file_offset: 0,
      size: 4096,
      alignment: 14,
    },
  ]),
  build_metadata: coverage([
    { platform: "1", minimum_os: "14.0", sdk: "15.0", tools: [] },
  ]),
  load_commands: coverage([{ index: 0, kind: "LC_MAIN", fields: {} }]),
  dependencies: coverage([
    {
      path: "/usr/lib/libSystem.B.dylib",
      kind: "LC_LOAD_DYLIB",
      current_version: "1351.0.0",
      compatibility_version: "1.0.0",
    },
  ]),
  imports: coverage(
    ["_malloc", "_free", "_open"].map((name) => symbol(name)),
    false,
  ),
  exports: coverage([symbol("__mh_execute_header")]),
  segments: coverage([
    {
      name: "__TEXT",
      vm_address: "0x100000000",
      vm_size: 16384,
      file_offset: 0,
      file_size: 16384,
      maximum_permissions: {
        read: true,
        write: false,
        execute: true,
        raw: "5",
      },
      initial_permissions: {
        read: true,
        write: false,
        execute: true,
        raw: "5",
      },
      sections: coverage([]),
    },
  ]),
  encryption: coverage([
    {
      architecture: "arm64",
      cpu_type: 16777228,
      cpu_subtype: 0,
      container_file_offset: 0,
      size: 4096,
      status: "not-encrypted",
      reason: null,
      commands: [
        {
          kind: "LC_ENCRYPTION_INFO_64",
          index: 1,
          cmdsize: 24,
          cryptoff: 16384,
          cryptsize: 0,
          cryptid: 0,
          pad: 0,
        },
      ],
      range: {
        content: "plaintext",
        slice_start: 16384,
        slice_end: 16384,
        container_start: 16384,
        container_end: 16384,
        mapping: { status: "mapped", fragments: [], sections: [] },
      },
    },
  ]),
  provenance: [
    {
      tool: "nm",
      command: ["/usr/bin/nm", "$ARTIFACT"],
      tool_version: null,
      version_reason: "fixture",
      executable_sha256: "a".repeat(64),
      exit: { code: 0, signal: null },
      stdout_bytes: 10,
      stderr_bytes: 0,
    },
  ],
  limitations: ["Imports and exports combine dyld_info and nm."],
};
const parent = (
  normalizedResult: unknown = report,
  subject: AnalysisViewParent["subject"] = {
    name: "tool",
    digest: { sha256: "b".repeat(64) },
    format: "mach-o",
    architecture: "arm64",
    local_path: "/bin/tool",
  },
): AnalysisViewParent => ({
  evidenceId: `ev_${"c".repeat(64)}`,
  operation: "inspect_macho",
  normalizedResult,
  subject,
  limitations: ["Parent limitation."],
});

it("retains binary names and exact numbers alongside partial command fields", () => {
  const segment = {
    ...report.segments.items[0]!,
    name: null,
    name_bytes_hex: "ff",
    vm_size: null,
    vm_size_hex: "0x20000000000000",
    file_offset: null,
    file_offset_hex: "0x20000000000001",
    file_size: null,
    file_size_hex: "0x20000000000002",
    sections: coverage([
      {
        segment: null,
        segment_bytes_hex: "ff",
        name: null,
        name_bytes_hex: "fe",
        address: "0x1",
        size: null,
        size_hex: "0x20000000000000",
        file_offset: 0,
        alignment: null,
        alignment_exponent: 53,
        flags: [],
      },
    ]),
  };
  const dependency = {
    path: null,
    path_bytes_hex: "fd",
    kind: "LC_LOAD_DYLIB",
    current_version: null,
    compatibility_version: null,
  };
  const command = {
    index: 0,
    kind: "LC_UNKNOWN_0x7fff",
    fields: {
      command_code: 32767,
      command_offset: 184,
      cmdsize: 8,
      command_sha256: "a".repeat(64),
    },
  };
  const observed = {
    ...report,
    segments: coverage([segment], false),
    dependencies: coverage([dependency], false),
    load_commands: {
      items: [command],
      total: 1,
      exhaustive: true,
      limitations: ["Some binary command fields are not decoded."],
    },
  };
  expect(inspectMachoSchema.safeParse(observed).success).toBe(true);
  for (const [facet, expected] of [
    ["segments", segment],
    ["dependencies", dependency],
    ["load_commands", command],
  ] as const) {
    const projected = projectAnalysisView(parent(observed), {
      kind: "macho",
      facet,
      offset: 0,
      limit: 64,
    });
    if (!projected.ok || projected.value.kind !== "macho")
      throw new Error("Expected Mach-O page");
    expect(projected.value.item).toEqual([expected]);
    expect(projected.value.source_exhaustive).toBe(facet === "load_commands");
    if (facet === "load_commands")
      expect(projected.value.limitations).toContain(
        "Some binary command fields are not decoded.",
      );
    expect(projected.value.unknowns).not.toEqual([]);
    expect(analysisViewResultSchema.safeParse(projected.value).success).toBe(
      true,
    );
  }
  // Historical records do not contain the newly added exact-byte fields.
  expect(inspectMachoSchema.safeParse(report).success).toBe(true);
  expect(report.segments.items[0]).not.toHaveProperty("name_bytes_hex");
});

it("preserves ambiguous import facts without adding import fields to exports", () => {
  const imported = {
    ...symbol("unused"),
    name: null,
    runtime_name: null,
    raw_name: "_value+0x4",
    name_status: "ambiguous",
    addend: null,
  };
  const observed = { ...report, imports: coverage([imported], false) };
  for (const facet of ["imports", "exports"] as const) {
    const projected = projectAnalysisView(parent(observed), {
      kind: "macho",
      facet,
      offset: 0,
      limit: 64,
    });
    if (!projected.ok) throw projected.error;
    expect(projected.value.kind === "macho" && projected.value.item).toEqual(
      observed[facet].items,
    );
  }
});

describe("Mach-O analysis views", () => {
  it("summarizes slice identity and collection counts without rows", () => {
    const projected = projectAnalysisView(parent(), { kind: "summary" });
    if (!projected.ok) throw projected.error;
    expect(projected.value).toMatchObject({
      kind: "summary",
      parent_operation: "inspect_macho",
      artifact: { path: "/bin/tool", sha256: "b".repeat(64) },
      summary: {
        selected_architecture: { name: "arm64", container_file_offset: 0 },
        uuid: report.uuid,
        collections: {
          imports: { returned: 3, total: null, exhaustive: false },
          exports: { returned: 1, total: 1, exhaustive: true },
          segments: { returned: 1, total: 1, exhaustive: true },
          encryption: { returned: 1, total: 1, exhaustive: true },
        },
        provenance_count: 1,
        limitation_count: 3,
      },
      coverage: { status: "complete-within-view", examined: 11, total: 11 },
      limitations: [
        "Imports and exports combine dyld_info and nm.",
        "Parent limitation.",
        "nm output may omit stripped symbols.",
      ],
      unknowns: [expect.stringContaining("exhaustive imports;")],
    });
    expect(JSON.stringify(projected.value)).not.toContain("_malloc");
  });

  it("pages original rows with the producer's own coverage", () => {
    const first = projectAnalysisView(parent(), {
      kind: "macho",
      facet: "imports",
      offset: 1,
      limit: 1,
    });
    if (!first.ok) throw first.error;
    expect(first.value).toMatchObject({
      kind: "macho",
      item: [symbol("_free")],
      source_total: null,
      source_exhaustive: false,
      coverage: { status: "page", examined: 1, total: 3, next_offset: 2 },
    });
    expect(first.value.limitations).toContain(
      "nm output may omit stripped symbols.",
    );
    // Rows whose keys include an earlier row shape's keys stay whole.
    for (const facet of ["architectures", "segments", "encryption"] as const) {
      const page = projectAnalysisView(parent(), {
        kind: "macho",
        facet,
        offset: 0,
        limit: 64,
      });
      if (!page.ok) throw page.error;
      expect(page.value.kind === "macho" && page.value.item).toEqual(
        report[facet].items,
      );
    }
    const provenance = projectAnalysisView(parent(), {
      kind: "macho",
      facet: "provenance",
      offset: 0,
      limit: 64,
    });
    if (!provenance.ok) throw provenance.error;
    expect(provenance.value).toMatchObject({
      item: report.provenance,
      source_total: 1,
      source_exhaustive: true,
      coverage: { exhausted: true, next_offset: null },
    });
    const past = projectAnalysisView(parent(), {
      kind: "macho",
      facet: "exports",
      offset: 5,
      limit: 64,
    });
    if (!past.ok) throw past.error;
    expect(past.value.coverage).toMatchObject({
      status: "empty",
      exhausted: true,
    });
  });

  it("keeps encryption unknown for Evidence retained before it was reported", () => {
    const { encryption: _omitted, ...legacy } = report;
    const projected = projectAnalysisView(parent(legacy), { kind: "summary" });
    if (!projected.ok) throw projected.error;
    expect(projected.value).toMatchObject({
      summary: {
        collections: {
          encryption: { returned: 0, total: null, exhaustive: false },
        },
      },
      unknowns: [expect.stringContaining("exhaustive imports, encryption;")],
    });
    expect(projected.value.limitations).toContain(
      "This inspect_macho Evidence predates encryption reporting; slice encryption status is unknown.",
    );
  });

  it("keeps a missing subject unknown instead of inventing identity", () => {
    const projected = projectAnalysisView(parent(report, null), {
      kind: "summary",
    });
    if (!projected.ok) throw projected.error;
    expect(projected.value.artifact).toEqual({ path: "", sha256: null });
    expect(projected.value.unknowns).toContain(
      "The parent has no recorded subject, so the inspected artifact path and SHA-256 are unknown.",
    );
  });

  it("rejects other view kinds and malformed retained results", () => {
    const wrongKind = projectAnalysisView(parent(), {
      kind: "wasm",
      facet: "exports",
      offset: 0,
      limit: 64,
    });
    if (wrongKind.ok) throw new Error("expected a view-kind refusal");
    expect(wrongKind.error).toMatchObject({
      _tag: "AnalysisInputError",
      issues: [
        {
          path: ["view"],
          message: "Mach-O inspection supports summary and macho views.",
        },
      ],
    });
    const contradictory = projectAnalysisView(
      parent(report, {
        name: "tool",
        digest: { sha256: "b".repeat(64) },
        format: "elf",
        architecture: null,
        local_path: "/bin/tool",
      }),
      { kind: "summary" },
    );
    if (contradictory.ok) throw new Error("expected a subject refusal");
    expect(contradictory.error).toMatchObject({
      issues: [{ path: ["source", "subject"] }],
    });
    const malformed = projectAnalysisView(
      parent({ ...report, imports: { items: "x" } }),
      { kind: "summary" },
    );
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error._tag).toBe("AnalysisInputError");
  });
});

it("validates a prototype-named command field rather than dropping an invalid value", () => {
  const fields =
    inspectMachoSchema.shape.load_commands.shape.items.element.shape.fields;
  const parsed = fields.safeParse(
    Object.fromEntries([["__proto__", { invalid: true }]]),
  );
  expect(parsed.success).toBe(false);
  if (parsed.success) throw new Error("Expected an invalid command field");
  expect(parsed.error.issues).toContainEqual(
    expect.objectContaining({ path: ["__proto__"] }),
  );
});
