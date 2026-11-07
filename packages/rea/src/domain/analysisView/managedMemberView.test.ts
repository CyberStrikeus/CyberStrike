import { expect, it } from "vitest";
import { MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE } from "../../contracts/managed/managedWorkflowExamples.js";
import { freezeOwnedJsonTreeSnapshot } from "../immutableJson.js";
import { managedMemberInspectionSchema } from "../managed/managedArtifact.js";
import type { AnalysisViewParent } from "./analysisView.js";
import {
  managedMembersViewRequestSchema,
  managedMembersViewPageSchema,
} from "./managedMemberViewSchemas.js";
import { projectManagedMemberView } from "./managedMemberView.js";

const parent = (normalizedResult: unknown): AnalysisViewParent => ({
  evidenceId: `ev_${"a".repeat(64)}`,
  operation: "inspect_managed_members",
  normalizedResult,
  sealedResult: true,
  limitations: [],
});

it("revalidates mutable managed facts despite a sealed flag and shallow freeze", () => {
  const source = managedMemberInspectionSchema.parse(
    MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE.static_members.normalized_result,
  );
  Object.freeze(source);
  const input = parent(source);
  expect(projectManagedMemberView(input, { kind: "summary" }).ok).toBe(true);
  Object.assign(source.coverage, { state: "invalid" });
  expect(projectManagedMemberView(input, { kind: "summary" })).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisInputError" },
  });
});

it("retains historical unknowns while normalizing immutable managed parents", () => {
  const complete = managedMemberInspectionSchema.parse(
    MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE.static_members.normalized_result,
  );
  const {
    signature_resolution: _signature,
    nesting_read: _nesting,
    exported_types: _exported,
    user_strings: _strings,
    selection: _selection,
    method_rows: _rows,
    ...legacy
  } = complete;
  const input = parent(freezeOwnedJsonTreeSnapshot(legacy));
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(projectManagedMemberView(input, { kind: "summary" })).toMatchObject({
      ok: true,
      value: {
        summary: {
          signature_resolution: null,
          nesting_read: null,
          reported_counts: { exported_types: null, user_strings: null },
        },
      },
    });
  }
  expect(Object.hasOwn(legacy, "signature_resolution")).toBe(false);
});

const methodFacts = () => {
  const report = managedMemberInspectionSchema.parse(
    MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE.static_members.normalized_result,
  );
  const template = report.methods[0];
  if (template === undefined) throw new Error("Method fixture is missing");
  report.methods = [
    { ...template, name: "Keep", declaring_type: "Other.Type" },
    {
      ...template,
      token: "0x06000002",
      name: "Keep",
      declaring_type: "Exact.Type",
    },
    {
      ...template,
      token: "0x06000003",
      name: "Skip",
      declaring_type: "Exact.Type",
    },
    {
      ...template,
      token: "0x06000004",
      name: "Keep",
      declaring_type: "Exact.Type",
    },
  ];
  return report;
};

it("intersects exact filters before paging and preserves identity while omitting IL", () => {
  const report = methodFacts();
  const before = JSON.stringify(report);
  const request = managedMembersViewRequestSchema.parse({
    kind: "managed-members",
    collection: "methods",
    names: ["Keep", "Keep"],
    declaring_types: ["Exact.Type"],
    fields: ["name"],
    offset: 1,
    limit: 1,
  });
  const result = projectManagedMemberView(
    parent(freezeOwnedJsonTreeSnapshot(report)),
    request,
  );
  if (!result.ok) throw result.error;
  if (!("page" in result.value)) throw new Error("Wrong view");
  expect(result.value.page).toEqual({
    collection: "methods",
    source_count: 4,
    unresolved_filter_rows: 0,
    rows: [
      {
        token: "0x06000004",
        row_offset: 128,
        declaring_type_token: "0x02000001",
        name: "Keep",
        source_index: 3,
      },
    ],
  });
  expect(managedMembersViewPageSchema.parse(result.value.page)).toEqual(
    result.value.page,
  );
  expect(result.value).toMatchObject({
    module: report.module,
    identity_scope: report.identity_scope,
    source_coverage: report.coverage,
    coverage: { total: 2, examined: 1, next_offset: null },
  });
  expect(JSON.stringify(report)).toBe(before);
});

it("keeps unresolved exact-filter candidates unknown under complete and partial coverage", () => {
  for (const state of ["complete", "partial"] as const) {
    const report = methodFacts();
    report.coverage = { state, issues: [] };
    const method = report.methods[1];
    if (method === undefined) throw new Error("Method fixture is missing");
    report.methods = [
      method,
      {
        ...method,
        token: "0x06000005",
        declaring_type: null,
        declaring_type_token: null,
      },
      { ...method, name: "Mismatch", declaring_type: null },
    ];
    const result = projectManagedMemberView(
      parent(report),
      managedMembersViewRequestSchema.parse({
        kind: "managed-members",
        collection: "methods",
        names: ["Keep"],
        declaring_types: ["Exact.Type"],
        fields: [],
      }),
    );
    if (!result.ok) throw result.error;
    if (!("page" in result.value)) throw new Error("Wrong view");
    expect(result.value).toMatchObject({
      source_coverage: { state },
      coverage: { total: 1 },
      page: {
        source_count: 3,
        unresolved_filter_rows: 1,
        rows: [{ token: "0x06000002", source_index: 0 }],
      },
    });
    expect(result.value.page.rows[0]).not.toHaveProperty("body");
  }
});

it("distinguishes empty selectors from omitted selectors and pages projections without filtering", () => {
  const report = methodFacts();
  for (const names of [[], ["keep"]]) {
    const result = projectManagedMemberView(
      parent(report),
      managedMembersViewRequestSchema.parse({
        kind: "managed-members",
        collection: "methods",
        names,
      }),
    );
    if (!result.ok) throw result.error;
    expect(result.value).toMatchObject({
      coverage: { total: 0 },
      page: { rows: [], unresolved_filter_rows: 0 },
    });
  }
  const result = projectManagedMemberView(
    parent(report),
    managedMembersViewRequestSchema.parse({
      kind: "managed-members",
      collection: "methods",
      fields: [],
      offset: 3,
      limit: 2,
    }),
  );
  if (!result.ok) throw result.error;
  expect(result.value).toMatchObject({
    coverage: { total: 4, examined: 1 },
    page: { source_count: 4, rows: [{ source_index: 3, token: "0x06000004" }] },
  });
  const full = projectManagedMemberView(
    parent(report),
    managedMembersViewRequestSchema.parse({
      kind: "managed-members",
      collection: "methods",
      offset: 1,
      limit: 2,
    }),
  );
  if (!full.ok) throw full.error;
  expect(full.value).toMatchObject({
    page: { collection: "methods", rows: report.methods.slice(1, 3) },
  });
  if (!("page" in full.value)) throw new Error("Wrong view");
  expect(full.value.page.rows).toEqual(report.methods.slice(1, 3));
});

it("rejects unsupported selectors and fields instead of silently ignoring caller choices", () => {
  for (const view of [
    { collection: "methods", fields: ["target_name"] },
    { collection: "user_strings", names: ["text"] },
    { collection: "types", declaring_types: ["Outer"] },
  ])
    expect(
      managedMembersViewRequestSchema.safeParse({
        kind: "managed-members",
        ...view,
      }).success,
    ).toBe(false);
});

it("does not restore omitted defaulted columns and admits historical unknown IL offsets", () => {
  const types = {
    collection: "types",
    rows: [{ token: "0x02000001", row_offset: 32, source_index: 0 }],
  };
  expect(managedMembersViewPageSchema.parse(types)).toEqual(types);
  const calls = managedMembersViewPageSchema.parse({
    collection: "call_edges",
    rows: [
      {
        caller_token: "0x06000001",
        opcode: "call",
        target_token: "0x0a000001",
      },
    ],
  });
  expect(calls.rows[0]).toMatchObject({ il_offset: null });
  expect(calls.rows[0]).not.toHaveProperty("target_identity_sha256");
  expect(calls.rows[0]).not.toHaveProperty("target_declaring_type");
});

it("filters relationship endpoints from recorded facts rather than caller display text", () => {
  const report = methodFacts();
  const method = report.methods[0];
  if (method === undefined) throw new Error("Method fixture is missing");
  report.call_edges = [
    {
      caller_token: "0x06000001",
      il_offset: 0,
      target_identity_sha256: null,
      caller: "Unrelated.Caller",
      opcode: "call",
      target_token: "0x0a000001",
      target_kind: "member-ref",
      target_name: "Target",
      target_declaring_type: "Exact.Type",
    },
    {
      caller_token: "0x06000002",
      il_offset: 0,
      target_identity_sha256: null,
      caller: "Exact.Type.Target",
      opcode: "call",
      target_token: "0x0a000002",
      target_kind: "member-ref",
      target_name: "Other",
      target_declaring_type: "Other.Type",
    },
  ];
  report.field_accesses = [
    {
      method_token: "0x06000001",
      il_offset: 0,
      target_identity_sha256: null,
      method: "Unrelated.Caller",
      opcode: "ldfld",
      field_token: "0x04000001",
      field_name: "Target",
      field_declaring_type: "Exact.Type",
    },
    {
      method_token: "0x06000002",
      il_offset: 0,
      target_identity_sha256: null,
      method: "Exact.Type.Target",
      opcode: "ldfld",
      field_token: "0x04000002",
      field_name: "Other",
      field_declaring_type: "Other.Type",
    },
  ];
  report.member_refs = [
    {
      token: "0x0a000001",
      row_offset: 256,
      parent_token: "0x01000001",
      parent_name: "Exact.Type",
      name: "Target",
      signature: method.signature,
    },
    {
      token: "0x0a000002",
      row_offset: 272,
      parent_token: "0x01000002",
      parent_name: "Other.Type",
      name: "Target",
      signature: method.signature,
    },
  ];
  for (const collection of [
    "call_edges",
    "field_accesses",
    "member_refs",
  ] as const) {
    const result = projectManagedMemberView(
      parent(report),
      managedMembersViewRequestSchema.parse({
        kind: "managed-members",
        collection,
        names: ["Target"],
        declaring_types: ["Exact.Type"],
        fields: [],
      }),
    );
    if (!result.ok) throw result.error;
    expect(result.value).toMatchObject({
      coverage: { total: 1 },
      page: {
        source_count: 2,
        unresolved_filter_rows: 0,
        rows: [{ source_index: 0 }],
      },
    });
  }
});
