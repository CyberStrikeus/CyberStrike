import { afterEach, expect, it, vi } from "vitest";
import { freezeJsonSnapshot } from "../immutableJson.js";
import { nativeInventoryRowsSchemas } from "../native/nativeInventory.js";
import {
  analysisViewRequestSchema,
  projectAnalysisView,
  type AnalysisViewParent,
} from "./analysisView.js";

afterEach(() => vi.restoreAllMocks());

const rows = () => [
  {
    address: "0x10",
    value: "first",
    procedure: { external: false, thunk: false, thunk_target: null },
  },
  { address: "0x10", value: "alias" },
  { address: "0x20", value: "last" },
];
const parent = (normalizedResult: unknown): AnalysisViewParent => ({
  evidenceId: `ev_${"a".repeat(64)}`,
  operation: "search_procedures",
  normalizedResult,
  sealedResult: true,
  provider: { id: "fixture", name: "Fixture", version: "1" },
  artifact: null,
  subject: null,
  parameters: { pattern: "a", mode: "literal", case_sensitive: false },
  limitations: ["Provider discovery is partial."],
});
const project = (source: AnalysisViewParent, view: unknown) => {
  const result = projectAnalysisView(
    source,
    analysisViewRequestSchema.parse(view),
  );
  if (!result.ok) throw result.error;
  return result.value;
};

it("pages exact source order and same-address alternatives, with selectable fields and stable row identity", () => {
  const original = rows();
  const source = parent(freezeJsonSnapshot(original));
  const selected = project(source, {
    kind: "native-inventory",
    offset: 0,
    limit: 2,
    fields: ["value", "address", "value"],
  });
  if (selected.kind !== "native-inventory")
    throw new Error("Expected row page");
  expect(selected.rows).toEqual([
    { source_index: 0, record: { address: "0x10", value: "first" } },
    { source_index: 1, record: { address: "0x10", value: "alias" } },
  ]);
  expect(selected.coverage).toMatchObject({
    total: 3,
    next_offset: 2,
    exhausted: false,
  });
  expect(selected.view).toMatchObject({
    fields: ["value", "address", "value"],
  });
  const complete = [0, 2].flatMap((offset) => {
    const page = project(source, {
      kind: "native-inventory",
      offset,
      limit: 2,
    });
    if (page.kind !== "native-inventory") throw new Error("Expected row page");
    return page.rows.map((row) => row.record);
  });
  expect(complete).toEqual(original);
  expect(source.normalizedResult).toEqual(original);
});

it("reuses only authenticated immutable validation while rebinding provenance to the current parent", () => {
  const source = parent(freezeJsonSnapshot(rows()));
  const parse = vi.spyOn(nativeInventoryRowsSchemas.names, "safeParse");
  project(source, { kind: "summary" });
  const next = project(
    {
      ...source,
      evidenceId: `ev_${"b".repeat(64)}`,
      provider: { id: "other", name: "Other", version: null },
    },
    { kind: "native-inventory", limit: 1 },
  );
  expect(parse).toHaveBeenCalledOnce();
  expect(next).toMatchObject({
    parent_evidence_id: `ev_${"b".repeat(64)}`,
    source_provider: { id: "other", name: "Other", version: null },
    source_parameters: source.parameters,
    artifact: null,
    limitations: source.limitations,
  });
});

it("retains caller metadata in Evidence while reusing owner-normalized inventory rows", () => {
  const original = [{ ...rows()[0]!, caller_metadata: { label: "keep me" } }];
  const source = parent(freezeJsonSnapshot(original));
  const parse = vi.spyOn(nativeInventoryRowsSchemas.names, "safeParse");
  for (let attempt = 0; attempt < 2; attempt++) {
    const page = project(source, { kind: "native-inventory", limit: 1 });
    expect(page).toMatchObject({
      rows: [{ source_index: 0, record: rows()[0] }],
    });
  }
  expect(parse).toHaveBeenCalledOnce();
  expect(source.normalizedResult).toEqual(original);
  expect(original[0]?.caller_metadata).toEqual({ label: "keep me" });
});

it("revalidates mutable and shallow-frozen arrays despite a forged sealing flag", () => {
  for (const shallowFreeze of [false, true]) {
    const values: unknown[] = rows();
    if (shallowFreeze) Object.freeze(values);
    const source = parent(values);
    project(source, { kind: "native-inventory", limit: 1 });
    Object.assign(values[0] as object, { value: 123 });
    expect(() => project(source, { kind: "summary" })).toThrow();
  }
});

it("does not use names validation as proof of the stricter string observation format", () => {
  const source = parent(
    freezeJsonSnapshot([
      {
        address: "0x10",
        value: "x",
        string: { encoding: "", termination: "missing", byte_length: 1 },
      },
    ]),
  );
  project(source, { kind: "summary" });
  expect(() =>
    project({ ...source, operation: "list_strings" }, { kind: "summary" }),
  ).toThrow();
});

it("preserves string display and decoding facts, while empty results retain unknown discovery coverage", () => {
  const original = [
    {
      address: "0x10",
      value: "native display",
      provider_value: "original display",
      decoding: { available: false as const, reason: "not decoded" },
      string: {
        encoding: "native",
        encoding_status: "inferred" as const,
        termination: "missing" as const,
        byte_length: 8,
      },
    },
  ];
  const page = project(
    { ...parent(freezeJsonSnapshot(original)), operation: "list_strings" },
    { kind: "native-inventory" },
  );
  if (page.kind !== "native-inventory") throw new Error("Expected row page");
  expect(page.rows.map((row) => row.record)).toEqual(original);
  const selected = project(
    { ...parent(freezeJsonSnapshot(original)), operation: "list_strings" },
    { kind: "native-inventory", fields: ["value"] },
  );
  if (selected.kind !== "native-inventory")
    throw new Error("Expected selected row page");
  expect(selected.rows[0]?.record).toEqual({
    address: original[0]!.address,
    value: original[0]!.value,
    string: original[0]!.string,
    decoding: original[0]!.decoding,
  });
  const empty = parent(freezeJsonSnapshot([]));
  const summary = project(empty, { kind: "summary" });
  expect(summary).toMatchObject({
    artifact: null,
    summary: { row_count: 0, discovery_coverage: "unknown" },
  });
  expect(summary.unknowns.length).toBeGreaterThan(0);
  expect(
    project(empty, { kind: "native-inventory", offset: 2, fields: [] })
      .coverage,
  ).toMatchObject({ status: "empty", total: 0, exhausted: true });
});
