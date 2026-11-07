import { expect, it } from "vitest";
import { createEvidence } from "../evidence.js";
import { projectAnalysisError } from "../analysisErrorProjection.js";
import type { JsonValue } from "../jsonValue.js";
import {
  analysisViewRequestSchema,
  androidComponentsViewResultSchema,
  androidComponentSummaryViewResultSchema,
  projectAnalysisView,
  type AnalysisViewParent,
} from "./analysisView.js";

const component = (name: string, extra: Record<string, JsonValue> = {}) => ({
  kind: "activity",
  declared_name: name,
  name,
  exported: null,
  exported_default: null,
  permission: null,
  permission_source: "none",
  intent_filter_count: 0,
  actions: [] as string[],
  categories: [],
  foreground_service_type: null,
  authorities: null,
  target_activity: null,
  ...extra,
});
const report = (
  items = [
    component("example.One", {
      declared_name: ".One",
      exported: true,
      actions: ["VIEW"],
      declaration_index: 10,
      declaration_coverage: "complete",
    }),
    component("example.Boot", {
      kind: "receiver",
      exported_default: true,
      actions: ["BOOT"],
      declaration_index: 20,
    }),
    component("example.One", {
      declared_name: ".One",
      exported: false,
      actions: ["VIEW"],
      declaration_index: 30,
      declaration_coverage: "partial",
    }),
  ],
) => ({
  engine: {
    name: "jadx",
    version: null,
    artifact_sha256: "e".repeat(64),
    source_revision: null,
    worker_count: 1,
    heap_limit_mib: null,
  },
  package_name: "example",
  version_name: null,
  version_code: null,
  min_sdk: null,
  target_sdk: "35",
  permissions: [],
  manifest: {
    status: "complete",
    text: "<manifest/>",
    reported_total_bytes: 11,
  },
  components: {
    status: "partial",
    items,
    limitations: ["Producer component limit"],
  },
  class_count: 3,
  resource_count: 0,
  signature_verification: "not_performed",
});
const parent = (value = report()): AnalysisViewParent => {
  const evidence = createEvidence(
    { path: "/retained.apk", sha256: "a".repeat(64), format: "apk" },
    { id: "jadx", name: "JADX", version: "0.7.1" },
    {
      operation: "inspect_android_package",
      parameters: {},
      result: value,
      limitations: ["Parent condition"],
    },
  );
  return {
    evidenceId: evidence.evidence_id,
    operation: evidence.operation,
    normalizedResult: value,
    subject: evidence.subject,
    limitations: evidence.limitations,
  };
};
const project = (source: AnalysisViewParent, view: unknown) => {
  const result = projectAnalysisView(
    source,
    analysisViewRequestSchema.parse(view),
  );
  if (!result.ok) throw result.error;
  return result.value;
};

it("keeps parent ordinals, duplicate declarations and coverage after filtering, paging and field selection", () => {
  const source = parent();
  const before = JSON.stringify(source);
  const page = androidComponentsViewResultSchema.parse(
    project(source, {
      kind: "android",
      facet: "components",
      names: [".One"],
      actions: ["VIEW"],
      kinds: ["activity"],
      offset: 1,
      limit: 1,
      fields: ["name", "declaration_index"],
    }),
  );
  expect(page.items).toEqual([
    {
      source_index: 2,
      name: "example.One",
      declaration_index: 30,
      declaration_coverage: "partial",
    },
  ]);
  expect(page.coverage).toMatchObject({
    total: 2,
    examined: 1,
    exhausted: true,
  });
  expect(page.source_components).toBe(3);
  expect(page.source_status).toBe("partial");
  expect(page.artifact).toEqual({
    path: "/retained.apk",
    sha256: "a".repeat(64),
  });
  expect(page.parent_evidence_id).toBe(source.evidenceId);
  expect(page.limitations).toEqual(
    expect.arrayContaining(["Parent condition", "Producer component limit"]),
  );
  expect(JSON.stringify(source)).toBe(before);
});

it("keeps omitted historical facts unknown even with empty or expanded field selections", () => {
  const source = parent(report([component("legacy.Class")]));
  for (const fields of [[], ["enabled", "intent_filters", "location"]]) {
    const page = androidComponentsViewResultSchema.parse(
      project(source, { kind: "android", facet: "components", fields }),
    );
    expect(page.items).toEqual([
      { source_index: 0, declaration_coverage: "unknown" },
    ]);
  }
});

it("counts explicit exported declarations separately from defaults and unknown historical coverage", () => {
  const source = parent();
  const summary = androidComponentSummaryViewResultSchema.parse(
    project(source, { kind: "android", facet: "component-summary" }),
  );
  expect(summary.summary).toEqual({
    matching_components: 3,
    by_kind: {
      activity: 2,
      "activity-alias": 0,
      service: 0,
      receiver: 1,
      provider: 0,
    },
    exported_declarations: { true: 1, false: 1, unknown: 1 },
    exported_defaults: { true: 1, false: 0, unknown: 2 },
    declaration_coverage: { complete: 1, partial: 1, unknown: 1 },
  });
  const explicit = androidComponentsViewResultSchema.parse(
    project(source, {
      kind: "android",
      facet: "components",
      exported: true,
      fields: [],
    }),
  );
  expect(explicit.items.map((row) => row.source_index)).toEqual([0]);
  const unknown = androidComponentSummaryViewResultSchema.parse(
    project(source, {
      kind: "android",
      facet: "component-summary",
      exported: null,
    }),
  );
  expect(unknown.summary.matching_components).toBe(1);
  expect(unknown.summary.exported_defaults.true).toBe(1);
});

it("preserves partial source coverage on empty filtered pages and never turns empty filters into all rows", () => {
  for (const selection of [
    { actions: [] },
    { names: [] },
    { kinds: [] },
    { actions: ["absent"] },
  ]) {
    const page = androidComponentsViewResultSchema.parse(
      project(parent(), { kind: "android", facet: "components", ...selection }),
    );
    expect(page.items).toEqual([]);
    expect(page.coverage.total).toBe(0);
    expect(page.source_status).toBe("partial");
    expect(page.unknowns.join(" ")).toContain("does not establish absence");
  }
});

it("bounds selected row serialization and lets field selection recover without changing the source", () => {
  const source = parent(
    report([
      component("large.Class", { process: "x".repeat(2 * 1024 * 1024) }),
    ]),
  );
  const wide = projectAnalysisView(
    source,
    analysisViewRequestSchema.parse({ kind: "android", facet: "components" }),
  );
  expect(wide).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisResourceConstraintError" },
  });
  if (wide.ok) throw new Error("Expected an oversized-row refusal");
  expect(projectAnalysisError(wide.error).remediation.action).toContain(
    "select fewer fields",
  );
  const small = androidComponentsViewResultSchema.parse(
    project(source, { kind: "android", facet: "components", fields: ["name"] }),
  );
  expect(small.items).toEqual([
    { source_index: 0, name: "large.Class", declaration_coverage: "unknown" },
  ]);
});

it("returns a resumable byte-limited page instead of silently omitting later rows", () => {
  const source = parent(
    report(
      Array.from({ length: 3 }, (_, index) =>
        component(`large.${index}`, { process: "x".repeat(400_000) }),
      ),
    ),
  );
  const first = androidComponentsViewResultSchema.parse(
    project(source, {
      kind: "android",
      facet: "components",
      limit: 3,
      fields: ["process"],
    }),
  );
  expect(first.byte_limited).toBe(true);
  expect(first.items.map((row) => row.source_index)).toEqual([0, 1]);
  expect(first.coverage).toMatchObject({
    total: 3,
    next_offset: 2,
    exhausted: false,
  });
  const last = androidComponentsViewResultSchema.parse(
    project(source, {
      kind: "android",
      facet: "components",
      offset: 2,
      limit: 3,
      fields: ["process"],
    }),
  );
  expect(last.items.map((row) => row.source_index)).toEqual([2]);
  expect(last.coverage.exhausted).toBe(true);
});
