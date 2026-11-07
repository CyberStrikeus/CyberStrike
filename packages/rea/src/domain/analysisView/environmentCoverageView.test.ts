import { expect, it } from "vitest";
import {
  analysisViewCaptureEvidence,
  environmentStateCaptureFixture,
  timedCaptureEvidence,
} from "../../../tests/fixtures/analysisView.js";
import {
  SCENARIO_EXCHANGES,
  scenarioCaptureEvidence,
  scenarioCaptureFixture,
} from "../../../tests/fixtures/browserScenarioCapture.js";
import type { Evidence } from "../evidence.js";
import {
  analysisViewRequestSchema,
  projectAnalysisView,
  type AnalysisViewParent,
  type AnalysisViewResult,
} from "./analysisView.js";
import {
  WITHHELD_WRITE_HINTS,
  summarizeEnvironmentCoverage,
} from "./environmentCoverageView.js";
import type { StateView } from "./environmentStateRules.js";
import { environmentStateFields } from "./environmentStateView.js";
import type { StateWritePlan } from "./environmentStateWriteRules.js";

const RULES = [
  "after-uid-literal",
  "opaque-token",
  "sibling-variance",
] as const;

const parentOf = (
  evidence: Evidence = analysisViewCaptureEvidence(
    environmentStateCaptureFixture(),
  ),
): AnalysisViewParent => ({
  evidenceId: evidence.evidence_id,
  operation: evidence.operation,
  normalizedResult: evidence.normalized_result,
  subject: evidence.subject,
  limitations: [],
  parameters: evidence.parameters,
});

const project = (
  kind: "environment-state" | "environment-coverage",
  parent: AnalysisViewParent = parentOf(),
): AnalysisViewResult => {
  const projected = projectAnalysisView(
    parent,
    analysisViewRequestSchema.parse({ kind, template_rules: [...RULES] }),
  );
  if (!projected.ok) throw projected.error;
  return projected.value;
};

const plan = (
  tool: string,
  reason: StateWritePlan["reason"],
  extra: Partial<StateWritePlan> = {},
): StateWritePlan =>
  ({
    tool,
    effect: "create",
    target: "/api/folders",
    served: reason === null,
    reason,
    exemplar_ordinal: 4,
    observation: null,
    response: null,
    body: null,
    rules: [],
    collection: null,
    insert: null,
    merge: null,
    checked_record_ordinals: [],
    contradicted_by: null,
    ...extra,
  }) as StateWritePlan;

it("has a hint for every reason the state view reports for a withheld write", () => {
  const reasons = environmentStateFields.writes.element.shape.reason
    .unwrap()
    .options.slice()
    .sort();
  expect(Object.keys(WITHHELD_WRITE_HINTS).sort()).toEqual(reasons);
  for (const hint of Object.values(WITHHELD_WRITE_HINTS))
    expect(hint.length).toBeGreaterThan(0);
});

it("counts read tools by how they answer and lists writes as served or withheld with hints", () => {
  const views: StateView[] = [
    { tool: "get_folders", shape: "document", checked_record_ordinals: [] },
    { tool: "get_users", shape: "recorded", reason: "query-varies" },
    { tool: "get_teams", shape: "recorded", reason: "envelope-varies" },
    { tool: "get_orgs", shape: "recorded", reason: "query-varies" },
  ];
  const writes = [
    plan("post_folders", null),
    plan("put_folders_by_uid", "contradicted", {
      effect: "update",
      contradicted_by: 9,
    }),
    plan("delete_folders_by_uid", "no-state-target", {
      effect: "delete",
      exemplar_ordinal: null,
    }),
  ];
  expect(summarizeEnvironmentCoverage({ views, writes })).toEqual({
    reads: {
      state: 1,
      recorded: 3,
      recorded_reasons: { "envelope-varies": 1, "query-varies": 2 },
    },
    writes: {
      served: [{ tool: "post_folders", effect: "create" }],
      withheld: [
        {
          tool: "put_folders_by_uid",
          effect: "update",
          reason: "contradicted",
          hint: WITHHELD_WRITE_HINTS.contradicted,
          exemplar_ordinal: 4,
          contradicted_by: 9,
        },
        {
          tool: "delete_folders_by_uid",
          effect: "delete",
          reason: "no-state-target",
          hint: WITHHELD_WRITE_HINTS["no-state-target"],
          exemplar_ordinal: null,
          contradicted_by: null,
        },
      ],
    },
  });
});

it("summarizes the state the environment-state view derives with the same rules", () => {
  const state = project("environment-state");
  const coverage = project("environment-coverage");
  if (
    state.kind !== "environment-state" ||
    coverage.kind !== "environment-coverage"
  )
    throw new Error("Expected state and coverage views");
  const summary = summarizeEnvironmentCoverage(state);
  expect(coverage.reads).toEqual(summary.reads);
  expect(coverage.writes).toEqual(summary.writes);
  expect(coverage.reads.state + coverage.reads.recorded).toBe(
    state.views.length,
  );
  expect(coverage.writes.served.length + coverage.writes.withheld.length).toBe(
    state.writes.length,
  );
  expect(coverage).toMatchObject({
    view: { kind: "environment-coverage", template_rules: [...RULES] },
    parent_evidence_id: state.parent_evidence_id,
    origin: state.origin,
    name: state.name,
    unknowns: state.unknowns,
    coverage: state.coverage,
  });
  expect(coverage.limitations).toEqual(
    expect.arrayContaining([
      ...state.limitations,
      expect.stringContaining("does not run the environment"),
    ]),
  );
});

it("does not claim reads are missing when a literal delete has no modelled target", () => {
  const evidence = timedCaptureEvidence([
    ["GET", "/api/folders", [{ uid: "f1", title: "General" }]],
    ["GET", "/api/folders/f1", { uid: "f1", title: "General" }],
    ["DELETE", "/api/folders/f1", null, 204],
    ["GET", "/api/folders/f1", { message: "not found" }, 404],
    ["GET", "/api/folders", []],
  ]);
  const parent = parentOf(evidence);
  const state = project("environment-state", parent);
  const coverage = project("environment-coverage", parent);
  if (
    state.kind !== "environment-state" ||
    coverage.kind !== "environment-coverage"
  )
    throw new Error("Expected state and coverage views");
  expect(state.views).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ tool: "get_folders", shape: "list" }),
      expect.objectContaining({ tool: "get_folders_f1", shape: "document" }),
    ]),
  );
  expect(coverage.writes.withheld).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        reason: "no-state-target",
        hint: expect.stringContaining(
          "could not be linked to a modelled state target",
        ),
      }),
    ]),
  );
});

it("says an untimed capture learns no clock, and only for an untimed capture", () => {
  const untimed = /learns no clock/u;
  const scenarioParent = parentOf(
    scenarioCaptureEvidence(
      scenarioCaptureFixture(SCENARIO_EXCHANGES, {
        request_body: true,
        response_body: true,
        header_values: true,
      }),
    ),
  );
  for (const [parent, timeline] of [
    [parentOf(), "recorded-start-time"],
    [scenarioParent, "record-order"],
  ] as const) {
    const state = project("environment-state", parent);
    const coverage = project("environment-coverage", parent);
    if (
      state.kind !== "environment-state" ||
      coverage.kind !== "environment-coverage"
    )
      throw new Error("Expected state and coverage views");
    expect(state.timeline).toBe(timeline);
    expect(coverage.limitations.some((line) => untimed.test(line))).toBe(
      timeline === "record-order",
    );
  }
});

it("refuses a browser scenario without response bodies as the state view does", () => {
  const evidence = scenarioCaptureEvidence(
    scenarioCaptureFixture(SCENARIO_EXCHANGES, {
      request_body: true,
      response_body: false,
      header_values: true,
    }),
  );
  const view = (kind: "environment-state" | "environment-coverage") =>
    projectAnalysisView(
      parentOf(evidence),
      analysisViewRequestSchema.parse({ kind, template_rules: [] }),
    );
  const state = view("environment-state");
  const coverage = view("environment-coverage");
  if (state.ok || coverage.ok) throw new Error("Expected both refusals");
  expect(coverage.error).toMatchObject({
    _tag: "AnalysisUnsupportedTargetError",
    message: state.error.message,
  });
});
