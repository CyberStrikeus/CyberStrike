import { AnalysisCapabilityUnavailableError } from "../../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { nativeGraphViewItemsSchema } from "../../domain/analysisView/nativeObservationSchemas.js";
import { expect, it } from "vitest";
import {
  createEvidence,
  rebindEvidenceToTargetPath,
  type Evidence,
} from "../../domain/evidence.js";
import { createAnalysisProfile } from "../../domain/analysisProfile.js";
import { ghidraFunctionIdentity } from "../../domain/ghidraValues.fixture.js";
import {
  nativeCallGraphSchema,
  type NativeCallGraph,
} from "../../domain/native/nativeCallGraph.js";
import {
  analysisViewResultSchema,
  type AnalysisViewRequest,
  type AnalysisViewResult,
} from "../../domain/analysisView/analysisView.js";
import {
  inspectAnalysisView,
  projectRetainedAnalysis,
} from "./AnalysisViewService.js";
import { EvidenceLedger } from "../investigation/EvidenceLedger.js";

const provider = { id: "fixture", name: "Fixture provider", version: "1" };
const parent = (
  operation: string,
  result: unknown,
  limitations = ["Source caveat"],
  profileValue = 1,
) =>
  createEvidence(
    {
      path: "/selected/fixture.elf",
      sha256: "a".repeat(64),
      format: "elf",
      architecture: "x86_64",
    },
    provider,
    {
      operation,
      parameters: { procedure: "selected_symbol" },
      result,
      limitations,
      analysisProfile: createAnalysisProfile(provider, {
        profile: profileValue,
      }),
      ...(operation === "procedure_callees"
        ? {
            relationshipCoverage: {
              status: "partial" as const,
              limitations: ["Indirect calls remain unknown"],
              limited_directions: ["callees"] as ["callees"],
            },
          }
        : {}),
    },
    { immutable: true },
  );
const project = async (source: Evidence, view: AnalysisViewRequest) => {
  const result = await inspectAnalysisView({
    source: { kind: "inline", evidence: source },
    view,
  });
  if (!result.ok) throw result.error;
  return {
    evidence: result.value,
    value: analysisViewResultSchema.parse(result.value.normalized_result),
  };
};
const contextDigest = (value: AnalysisViewResult): string => {
  if (!("source_context" in value))
    throw new Error("Expected native source context");
  return value.source_context.digest;
};
const graph = (): NativeCallGraph =>
  nativeCallGraphSchema.parse({
    graph: {
      "2": [
        {
          address: "ram:0x0010",
          status: "ok",
          calls: ["ram:0x0020"],
          relationship_coverage: {
            status: "complete",
            diagnostics: ["Shared diagnostic 雪🧭"],
          },
        },
      ],
      "10": [
        {
          address: "ram:0x0010",
          status: "ok",
          calls: [],
          limitations: [],
          relationship_coverage: {
            status: "unknown",
            reason: "Shared caveat",
            limited_directions: ["callers"],
            diagnostics: ["Shared diagnostic 雪🧭"],
          },
        },
      ],
      "01": [
        {
          address: "ram:0x0010",
          status: "ok",
          calls: ["ram:0x0020", "ram:0x0020"],
          limitations: ["Shared caveat", "Shared caveat"],
          relationship_coverage: {
            status: "partial",
            limitations: ["Shared caveat", "Shared caveat"],
            limited_directions: ["callees"],
            diagnostics: ["Shared diagnostic 雪🧭"],
          },
        },
      ],
    },
    limitations: ["Graph caveat", "Graph caveat"],
  });

it("returns useful caller/callee facts with exact source context identity and partial coverage", async () => {
  const source = parent("procedure_callees", [
    "ram:0x0010",
    "ram:0x0010",
    "ram:0x0020",
  ]);
  const before = JSON.stringify(source);
  const summary = await project(source, { kind: "summary" });
  expect(summary.value).toMatchObject({
    kind: "summary",
    parent_evidence_id: source.evidence_id,
    source_provider: source.provider,
    source_parameters: source.parameters,
    source_analysis_profile_digest: source.analysis_profile?.digest,
    source_context: {
      evidence_limitation_count: 1,
      result_limitation_count: null,
    },
    summary: { observations: 3 },
    items: {
      type: "addresses",
      rows: [
        { source_index: 0, address: "ram:0x0010" },
        { source_index: 1, address: "ram:0x0010" },
        { source_index: 2, address: "ram:0x0020" },
      ],
    },
  });
  expect(summary.evidence.relationship_coverage).toEqual(
    source.relationship_coverage,
  );
  const page = await project(source, {
    kind: "native-observation",
    offset: 1,
    limit: 1,
  });
  expect(page.value).toMatchObject({
    items: { rows: [{ source_index: 1, address: "ram:0x0010" }] },
    coverage: { total: 3, next_offset: 2, exhausted: false },
  });
  expect(page.value).toHaveProperty(
    "source_context.digest",
    contextDigest(summary.value),
  );
  expect(JSON.stringify(summary.value)).not.toContain('"analysis_profile":');
  expect(JSON.stringify(source)).toBe(before);
});

it("pages complete context fields and changes its digest when source profile or caveats change", async () => {
  const source = parent("procedure_callers", []);
  const overview = await project(source, {
    kind: "native-context",
    facet: "overview",
    offset: 0,
    limit: 1,
  });
  expect(overview.value).toMatchObject({
    items: {
      type: "overview",
      rows: [
        {
          record: {
            subject: source.subject,
            provider,
            analysis_profile_digest: source.analysis_profile?.digest,
          },
        },
      ],
    },
  });
  const profile = await project(source, {
    kind: "native-context",
    facet: "analysis-profile",
    offset: 0,
    limit: 1,
  });
  expect(profile.value).toMatchObject({
    items: { rows: [{ source_index: 0, record: source.analysis_profile }] },
  });
  const caveat = await project(source, {
    kind: "native-context",
    facet: "limitations",
    offset: 0,
    limit: 1,
  });
  expect(caveat.value).toMatchObject({
    items: { rows: [{ source_index: 0, text: "Source caveat" }] },
  });
  for (const changed of [
    parent("procedure_callers", [], ["Changed caveat"]),
    parent("procedure_callers", [], ["Source caveat"], 2),
  ]) {
    const changedView = await project(changed, { kind: "summary" });
    expect(changedView.value).not.toHaveProperty(
      "source_context.digest",
      contextDigest(overview.value),
    );
  }
});

it("keeps absent profile and inapplicable result caveats distinct from observed empty data", async () => {
  const source = createEvidence(undefined, provider, {
    operation: "procedure_address",
    parameters: {},
    result: "0x0000",
  });
  expect(
    (
      await project(source, {
        kind: "native-context",
        facet: "analysis-profile",
        offset: 0,
        limit: 64,
      })
    ).value,
  ).toMatchObject({ items: { rows: [{ source_index: 0, record: null }] } });
  expect(
    (
      await project(source, {
        kind: "native-context",
        facet: "result-limitations",
        offset: 0,
        limit: 64,
      })
    ).value,
  ).toMatchObject({
    source_context: { result_limitation_count: null },
    items: { rows: null },
    unknowns: expect.arrayContaining([
      expect.stringContaining("not applicable"),
    ]),
  });
  expect(
    (
      await project(parent("procedure_callers", []), {
        kind: "native-observation",
        offset: 0,
        limit: 64,
      })
    ).value,
  ).toMatchObject({
    summary: { observations: 0 },
    items: { rows: [] },
    coverage: { status: "empty", exhausted: true },
  });
});

it.each([true, false])(
  "preserves the complete containing-procedure outcome (found=%s)",
  async (found) => {
    const report = found
      ? {
          query_address: "0x401001",
          found: true,
          procedure: ghidraFunctionIdentity(),
        }
      : {
          query_address: "0x9999",
          found: false,
          procedure: null,
          reason: "not_in_procedure",
        };
    const result = await project(
      parent("resolve_containing_procedure", report),
      { kind: "summary" },
    );
    expect(result.value).toMatchObject({
      summary: { observations: 1 },
      items: { rows: [{ source_index: 0, record: report }] },
    });
  },
);

it("reconstructs every graph field from dictionary pages without changing nulls, duplicate messages or level identities", async () => {
  const report = graph();
  const source = parent("get_call_graph", report);
  const decoded: NativeCallGraph["graph"] = {};
  for (let offset = 0; offset < 3; offset++) {
    const { value } = await project(source, {
      kind: "native-observation",
      offset,
      limit: 1,
    });
    if (
      value.kind !== "native-observation" ||
      value.parent_operation !== "get_call_graph"
    )
      throw new Error("Expected graph page");
    const { rows, messages } = value.items;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.source_index).toBe(0);
    expect(row.level).toBe(["01", "10", "2"][offset]);
    expect(value.coverage).toMatchObject({ total: 3, exhausted: offset === 2 });
    if (row.status !== "ok") throw new Error("Expected recorded node");
    const coverage = row.relationship_coverage;
    const diagnostics =
      coverage.diagnostic_ids === undefined
        ? {}
        : { diagnostics: coverage.diagnostic_ids.map((i) => messages[i]!) };
    const directions =
      "limited_directions" in coverage &&
      coverage.limited_directions !== undefined
        ? { limited_directions: coverage.limited_directions }
        : {};
    const originalCoverage =
      coverage.status === "complete"
        ? { status: "complete" as const, ...diagnostics }
        : coverage.status === "partial"
          ? {
              status: "partial" as const,
              limitations: coverage.limitation_ids.map((i) => messages[i]!),
              ...directions,
              ...diagnostics,
            }
          : {
              status: "unknown" as const,
              reason: messages[coverage.reason_id]!,
              ...directions,
              ...diagnostics,
            };
    decoded[row.level] = [
      {
        address: row.address,
        status: row.status,
        calls: row.calls,
        relationship_coverage: originalCoverage,
        ...(row.limitation_ids === undefined
          ? {}
          : { limitations: row.limitation_ids.map((i) => messages[i]!) }),
      },
    ];
    expect(messages).toHaveLength(coverage.status === "complete" ? 1 : 2);
  }
  expect(decoded).toEqual(report.graph);
  const caveats = await project(source, {
    kind: "native-context",
    facet: "result-limitations",
    offset: 1,
    limit: 1,
  });
  expect(caveats.value).toMatchObject({
    source_context: { result_limitation_count: 2 },
    items: { rows: [{ source_index: 1, text: "Graph caveat" }] },
  });
});

it("rejects malformed unselected source facts and preserves exact source paths", async () => {
  const malformed = {
    ...graph(),
    graph: {
      "0": [
        {
          address: "0x10",
          status: "ok",
          calls: [],
          relationship_coverage: { status: "complete" },
        },
        {
          address: "0x20",
          status: "ok",
          calls: [42],
          relationship_coverage: { status: "complete" },
        },
      ],
    },
  };
  const result = await inspectAnalysisView({
    source: { kind: "inline", evidence: parent("get_call_graph", malformed) },
    view: { kind: "native-observation", offset: 0, limit: 1 },
  });
  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisInputError",
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: ["source", "normalized_result", "graph", "0", 1, "calls", 0],
        }),
      ]),
    },
  });
});

it("retains failed graph nodes and rejects broken message references", async () => {
  const source = graph();
  const failure = {
    address: "ram:0x0010",
    status: "error" as const,
    error: projectAnalysisError(
      new AnalysisCapabilityUnavailableError(
        "fixture",
        "procedure_callees",
        "No call references",
      ),
    ),
  };
  source.graph.failure = [failure];
  const result = await project(parent("get_call_graph", source), {
    kind: "native-observation",
    offset: 3,
    limit: 1,
  });
  expect(result.value).toMatchObject({
    items: {
      type: "graph-nodes",
      messages: [],
      rows: [{ level: "failure", source_index: 0, ...failure }],
    },
    coverage: { total: 4, exhausted: true },
  });
  const normal = await project(parent("get_call_graph", graph()), {
    kind: "native-observation",
    offset: 0,
    limit: 1,
  });
  if (
    normal.value.kind !== "native-observation" ||
    normal.value.parent_operation !== "get_call_graph"
  )
    throw new Error("Expected graph page");
  expect(
    nativeGraphViewItemsSchema.safeParse({
      ...normal.value.items,
      messages: [],
    }).success,
  ).toBe(false);
});

it("keeps graph row identity stable when source object key insertion order changes", async () => {
  const report = graph();
  report.graph.beta = [report.graph["2"]![0]!];
  const first = parent("get_call_graph", report);
  const reversed = parent("get_call_graph", {
    ...report,
    graph: Object.fromEntries(Object.entries(report.graph).reverse()),
  });
  expect(Object.keys(report.graph)).not.toEqual(
    Object.keys(Object.fromEntries(Object.entries(report.graph).reverse())),
  );
  expect(first.evidence_id).toBe(reversed.evidence_id);
  expect(
    await project(first, { kind: "native-observation", offset: 0, limit: 64 }),
  ).toEqual(
    await project(reversed, {
      kind: "native-observation",
      offset: 0,
      limit: 64,
    }),
  );
});

it("keeps context identity across authenticated target path aliases while preserving selected paths", async () => {
  const original = parent("procedure_callers", []);
  const rebound = rebindEvidenceToTargetPath(original, {
    path: "/other/alias.elf",
    sha256: "a".repeat(64),
    format: "elf",
    architecture: "x86_64",
  });
  expect(rebound.evidence_id).toBe(original.evidence_id);
  const view = {
    kind: "native-context" as const,
    facet: "overview" as const,
    offset: 0,
    limit: 1,
  };
  const first = await project(original, view);
  const second = await project(rebound, view);
  expect(contextDigest(second.value)).toBe(contextDigest(first.value));
  expect(second.value).toMatchObject({
    items: {
      rows: [{ record: { subject: { local_path: "/other/alias.elf" } } }],
    },
  });
  expect(second.evidence.subject?.local_path).toBe("/other/alias.elf");
  expect(second.evidence.evidence_id).not.toBe(first.evidence.evidence_id);
  const ledger = new EvidenceLedger();
  expect(ledger.record(original).ok).toBe(true);
  const retained = ledger.forAnalysis(original.evidence_id)!;
  const delivered = projectRetainedAnalysis(
    rebound,
    {
      recordEvidence: (evidence) => ledger.record(evidence),
      evidenceById: (id) => ledger.forAnalysis(id),
    },
    view,
  );
  if (!delivered.ok) throw delivered.error;
  expect(delivered.value.subject?.local_path).toBe("/other/alias.elf");
  expect(delivered.value.normalized_result).toMatchObject({
    artifact: { path: "/other/alias.elf" },
    items: {
      rows: [{ record: { subject: { local_path: "/other/alias.elf" } } }],
    },
  });
  expect(ledger.forAnalysis(original.evidence_id)).toBe(retained);
  expect(retained.subject?.local_path).toBe("/selected/fixture.elf");
  const imported = new EvidenceLedger();
  const exporting = new EvidenceLedger();
  expect(exporting.record(rebound).ok).toBe(true);
  expect(imported.import(exporting.export()).ok).toBe(true);
  const replay = await inspectAnalysisView(
    {
      source: { kind: "retained-evidence", evidence_id: rebound.evidence_id },
      view,
    },
    (id) => imported.forAnalysis(id),
  );
  if (!replay.ok) throw replay.error;
  expect(replay.value.subject?.local_path).toBe("/other/alias.elf");
  expect(replay.value.normalized_result).toMatchObject({
    artifact: { path: "/other/alias.elf" },
    items: {
      rows: [{ record: { subject: { local_path: "/other/alias.elf" } } }],
    },
  });
});

it("pages recorded empty graph levels without inventing nodes or dropping their identity", async () => {
  const report = { graph: { absent: [], empty: [] }, limitations: [] };
  const result = await project(parent("get_call_graph", report), {
    kind: "native-observation",
    offset: 1,
    limit: 1,
  });
  expect(result.value).toMatchObject({
    items: {
      messages: [],
      rows: [{ level: "empty", source_index: null, status: "empty-level" }],
    },
    summary: { observations: 2 },
    coverage: { total: 2, exhausted: true },
  });
});

it.each([
  { status: "partial" as const, limitations: ["Unresolved indirect edges"] },
  { status: "unknown" as const, reason: "Provider did not establish coverage" },
])(
  "keeps $status relationship coverage on every context facet",
  async (coverage) => {
    const source = createEvidence(undefined, provider, {
      operation: "procedure_callees",
      parameters: {},
      result: [],
      relationshipCoverage: coverage,
    });
    for (const facet of [
      "overview",
      "analysis-profile",
      "limitations",
      "result-limitations",
    ] as const) {
      const result = await project(source, {
        kind: "native-context",
        facet,
        offset: 0,
        limit: 64,
      });
      expect(result.evidence.relationship_coverage).toEqual(coverage);
    }
  },
);
