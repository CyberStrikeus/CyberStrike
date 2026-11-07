import { expect, it, vi } from "vitest";
import { z } from "zod";
import { androidComponentsViewRequestSchema } from "../android/androidPackageQuery.js";
import { createEvidence } from "../evidence.js";
import { immutableJsonSnapshotMember } from "../immutableJson.js";
import {
  androidClassSummaryViewResultSchema,
  androidMethodSummaryViewResultSchema,
  projectAnalysisView,
  type AnalysisViewParent,
} from "./analysisView.js";
import type { AdmittedView } from "./analysisViewShape.js";
import {
  androidClassSummarySchema,
  projectAndroidSymbolSummary as projectAdmittedAndroidSymbolSummary,
} from "./androidSymbolView.js";

const projectAndroidSymbolSummary = (
  parent: Parameters<typeof projectAdmittedAndroidSymbolSummary>[0],
  view: z.input<typeof androidComponentsViewRequestSchema>,
): ReturnType<typeof projectAdmittedAndroidSymbolSummary> =>
  projectAdmittedAndroidSymbolSummary(parent, view satisfies AdmittedView);

type Operation = "inspect_android_class" | "inspect_android_method";
const engine = {
  name: "jadx",
  version: "0.7.1",
  artifact_sha256: "e".repeat(64),
  source_revision: null,
  worker_count: 1,
  heap_limit_mib: null,
};
const method = {
  name: "chooseAlias",
  reported_signature: "chooseAlias(int): int",
  overload_index: 1,
  is_constructor: false,
  dex_descriptor: "(I)I",
};
const mapping = {
  association: "caller-selected",
  file: {
    path: "/caller-selected/原名 mapping.txt",
    sha256: "c".repeat(64),
    bytes: 84,
  },
  reported: {
    compiler: "R8",
    compiler_version: "8.0.40",
    min_api: "21",
    map_version: "2.1",
    pg_map_id: null,
    pg_map_hash: null,
  },
  records: { classes: 1, methods: 1, fields: 0, malformed: 1 },
  malformed: [{ line: 4, reason: "member-line" }],
  symbols: [
    {
      kind: "class",
      name: "defpackage.a",
      raw_name: "a",
      resolution: {
        status: "mapped",
        mapped: { name: "original.原名" },
        verified_by: "class",
      },
    },
    {
      kind: "method",
      class_raw_name: "a",
      name: method.name,
      overload_index: 1,
      raw_name: "b",
      dex_descriptor: method.dex_descriptor,
      resolution: { status: "unknown", reason: "projection-budget" },
    },
  ],
  coverage: { symbols: 2, mapped: 1, ambiguous: 0, unmapped: 0, unknown: 1 },
};
const classReport = () => ({
  engine,
  class_name: "defpackage.a",
  methods: [
    {
      ...method,
      overload_index: 0,
      reported_signature: "chooseAlias(String): int",
      dex_descriptor: "(Ljava/lang/String;)I",
    },
    method,
  ],
  fields: [
    {
      name: "valueAlias",
      reported_type: "int",
      dex_static_value: { type: "int", value: 7 },
    },
  ],
  inner_classes: [],
  mapping: {
    ...mapping,
    symbols: [
      ...mapping.symbols,
      {
        kind: "method",
        class_raw_name: "a",
        name: method.name,
        overload_index: 0,
        raw_name: "c",
        dex_descriptor: "(Ljava/lang/String;)I",
        resolution: { status: "unmapped" },
      },
      {
        kind: "field",
        class_raw_name: "a",
        name: "valueAlias",
        raw_name: "a",
        dex_type: "I",
        resolution: { status: "unmapped" },
      },
    ],
    coverage: { ...mapping.coverage, symbols: 4, unmapped: 2 },
  },
});
const methodReport = () => ({
  engine,
  class_name: "defpackage.a",
  method,
  overload_count: 2,
  representation: "smali",
  body_status: "available",
  fell_back: true,
  markers: ["source_truncated"],
  source: {
    status: "partial",
    text: "return value; // 😀",
    reported_total_bytes: 4096,
  },
  mapping,
});
const fixture = (operation: Operation, report: unknown, rawMetadata = "") => {
  const evidence = createEvidence(
    { path: "/retained/selected.apk", sha256: "a".repeat(64), format: "apk" },
    { id: "jadx", name: "JADX", version: "0.7.1" },
    {
      operation,
      parameters: {
        path: "/caller/selected.apk",
        mapping_path: mapping.file.path,
      },
      result: report,
      rawResult: {
        calls: [
          {
            operation: "get_class_summary",
            response: {
              irrelevant_member_metadata: rawMetadata,
            },
          },
        ],
      },
      limitations: [
        "The caller-selected mapping is not verified against the APK build.",
      ],
    },
    { immutable: true },
  );
  const parent: AnalysisViewParent = {
    evidenceId: evidence.evidence_id,
    operation,
    normalizedResult:
      immutableJsonSnapshotMember(evidence, "normalized_result") ??
      evidence.normalized_result,
    subject: evidence.subject,
    sealedResult: true,
    limitations: evidence.limitations,
  };
  return { parent, evidence };
};

it.each(["inspect_android_class", "inspect_android_method"] as const)(
  "preserves exact %s normalized facts while leaving large raw metadata in complete parent Evidence",
  (operation) => {
    const facts =
      operation === "inspect_android_class" ? classReport() : methodReport();
    const { parent, evidence } = fixture(
      operation,
      facts,
      "x".repeat(1024 * 1024 + 128),
    );
    const before = JSON.stringify(evidence);
    const result = projectAnalysisView(parent, { kind: "summary" });
    if (!result.ok) throw result.error;
    const view =
      operation === "inspect_android_class"
        ? androidClassSummaryViewResultSchema.parse(result.value)
        : androidMethodSummaryViewResultSchema.parse(result.value);
    expect(view.summary).toEqual(facts);
    expect(view.artifact).toEqual({
      path: "/retained/selected.apk",
      sha256: "a".repeat(64),
    });
    expect(view.parent_evidence_id).toBe(evidence.evidence_id);
    expect(view.parent_digest).toBe(evidence.evidence_id.slice(3));
    expect(view.coverage).toEqual({
      status: "complete-within-view",
      examined: 1,
      total: 1,
      next_offset: null,
      exhausted: true,
    });
    expect(view.limitations).toEqual(evidence.limitations);
    expect(view.summary.mapping).toEqual(facts.mapping);
    expect(JSON.stringify(view)).not.toContain("irrelevant_member_metadata");
    expect(JSON.stringify(evidence)).toBe(before);
    if (operation === "inspect_android_method")
      expect(view.unknowns.join(" ")).toContain("source is partial");
  },
);

it("preserves native absence and optional historical omission without inventing mapping facts", () => {
  const { mapping: _mapping, ...native } = methodReport();
  const facts = {
    ...native,
    body_status: "not_available",
    markers: ["native_method"],
    source: { status: "complete", text: "", reported_total_bytes: 0 },
  };
  const { parent } = fixture("inspect_android_method", facts);
  const result = projectAnalysisView(parent, { kind: "summary" });
  if (!result.ok) throw result.error;
  const view = androidMethodSummaryViewResultSchema.parse(result.value);
  expect(view.summary).toEqual(facts);
  expect(Object.hasOwn(view.summary, "mapping")).toBe(false);
});

it.each(["inspect_android_class", "inspect_android_method"] as const)(
  "rejects malformed historical %s facts with a typed source error",
  (operation) => {
    const { parent } = fixture(operation, { engine, class_name: "broken" });
    const result = projectAnalysisView(parent, { kind: "summary" });
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisInputError",
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: expect.arrayContaining(["source", "normalized_result"]),
          }),
        ]),
      },
    });
  },
);

it.each(["inspect_android_class", "inspect_android_method"] as const)(
  "requires the recorded APK identity for %s instead of using the engine JAR digest",
  (operation) => {
    const { parent } = fixture(
      operation,
      operation === "inspect_android_class" ? classReport() : methodReport(),
    );
    expect(
      projectAnalysisView({ ...parent, subject: null }, { kind: "summary" }),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisInputError",
        issues: [{ path: ["source", "subject"] }],
      },
    });
  },
);

it("rejects non-summary selection without silently ignoring caller choices", () => {
  const { parent } = fixture("inspect_android_class", classReport());
  expect(
    projectAndroidSymbolSummary(parent, {
      kind: "android",
      facet: "components",
      offset: 0,
      limit: 1,
    }),
  ).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisInputError", issues: [{ path: ["view"] }] },
  });
});

it("refuses an admitted one-MiB source plus summary context without truncation and retains recovery", () => {
  const facts = methodReport();
  facts.source = {
    status: "complete",
    text: "x".repeat(1024 * 1024),
    reported_total_bytes: 1024 * 1024,
  };
  const { parent } = fixture("inspect_android_method", facts);
  const result = projectAnalysisView(parent, { kind: "summary" });
  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisResourceConstraintError",
      reportedLimits: {
        parent_evidence_id: parent.evidenceId,
        limit_bytes: 1024 * 1024,
      },
    },
  });
  expect(parent.normalizedResult).toEqual(facts);
});

it("reuses validation of an authenticated sealed class result across retained summaries", () => {
  const { parent } = fixture("inspect_android_class", classReport());
  const parse = vi.spyOn(androidClassSummarySchema, "safeParse");
  try {
    for (let attempt = 0; attempt < 2; attempt++)
      expect(projectAnalysisView(parent, { kind: "summary" }).ok).toBe(true);
    expect(parse).toHaveBeenCalledTimes(1);
  } finally {
    parse.mockRestore();
  }
});
