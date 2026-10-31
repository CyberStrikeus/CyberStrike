import { appendFile, cp } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { createPackage } from "@electron/asar";

import { parseEvidence, type Evidence } from "../../../src/domain/evidence.js";
import { evaluateCodexEvents } from "../../evaluation/model-evals/CodexAgentEval.js";
import {
  createAgentEvaluationFixtures,
  agentFixtureClaims,
} from "../../evaluation/model-evals/AgentEvaluationFixtures.js";
import type { FixtureClaimExpectation } from "../../evaluation/model-evals/KnownAnswerEvaluation.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

describe("packaged application known-answer evaluation", () => {
  it("grades real packaged bytes and rejects false values, extra claims, and unrelated citations", async () => {
    const root = await createTestTempDirectory("rea-known-answer-asar-");
    const targets = await createAgentEvaluationFixtures(root, resolve("."));
    const claims = agentFixtureClaims("asar", targets);
    if (claims === undefined) throw new Error("Missing ASAR rubric");
    const harness = await createApplicationMcpHarness();
    try {
      const result = await harness.client.callTool({
        name: "analyze_javascript_application",
        arguments: { input_path: targets.javascript },
      });
      expect(result.isError).not.toBe(true);
      const evidence = resultEvidence(result);
      const events = [
        toolEvent("analysis", "analyze_javascript_application", result),
      ];
      const manifest = claimManifest(claims, evidence);
      expect(
        grade(events, manifest, "analyze_javascript_application", claims)
          .factualCorrectness,
      ).toBe("passed");

      const wrongValue = {
        claims: manifest.claims.map((claim) =>
          claim.id === "renderer_api"
            ? {
                ...claim,
                value: {
                  key: "adminApi",
                  members: ["delete"],
                  world: "isolated",
                  source: "preload.js",
                },
              }
            : claim,
        ),
      };
      expect(
        grade(events, wrongValue, "analyze_javascript_application", claims)
          .factualCorrectness,
      ).toBe("failed");
      expect(
        grade(
          events,
          {
            claims: [
              ...manifest.claims,
              {
                ...manifest.claims[0],
                id: "unsupported_behavior",
                value: "all requests are authenticated",
              },
            ],
          },
          "analyze_javascript_application",
          claims,
        ).factualCorrectness,
      ).toBe("failed");
      expect(
        grade(
          events,
          {
            claims: manifest.claims.map((claim) => ({
              ...claim,
              evidence_id: `ev_${"f".repeat(64)}`,
            })),
          },
          "analyze_javascript_application",
          claims,
        ).factualCorrectness,
      ).toBe("failed");
    } finally {
      await harness.close();
    }
  });

  it("binds its oracle to the requested packaged artifact path", async () => {
    const root = await createTestTempDirectory("rea-known-answer-identity-");
    const targets = await createAgentEvaluationFixtures(root, resolve("."));
    const claims = agentFixtureClaims("asar", targets);
    if (claims === undefined) throw new Error("Missing ASAR rubric");
    const unrelated = join(root, "unrelated.asar");
    await cp(targets.javascript, unrelated);
    const harness = await createApplicationMcpHarness();
    try {
      const result = await harness.client.callTool({
        name: "analyze_javascript_application",
        arguments: { input_path: unrelated },
      });
      const manifest = claimManifest(claims, resultEvidence(result));
      const events = [
        toolEvent("unrelated", "analyze_javascript_application", result),
      ];
      expect(
        grade(events, manifest, "analyze_javascript_application", claims)
          .factualCorrectness,
      ).toBe("failed");
    } finally {
      await harness.close();
    }
  });
});

describe("known-answer packaged artifact digest binding", () => {
  it("rejects the same known facts when the target bytes change at the same path", async () => {
    const root = await createTestTempDirectory("rea-known-answer-digest-");
    const targets = await createAgentEvaluationFixtures(root, resolve("."));
    const claims = agentFixtureClaims("asar", targets);
    if (claims === undefined) throw new Error("Missing ASAR rubric");
    await appendFile(
      join(root, "desktop-app/renderer/app.js"),
      "\n// changed shipped bytes\n",
    );
    await createPackage(join(root, "desktop-app"), targets.javascript);
    const harness = await createApplicationMcpHarness();
    try {
      const result = await harness.client.callTool({
        name: "analyze_javascript_application",
        arguments: { input_path: targets.javascript },
      });
      const evidence = resultEvidence(result);
      expect(evidence.subject?.digest.sha256).toEqual(expect.any(String));
      expect(evidence.subject?.digest.sha256).not.toBe(
        targets.javascriptSha256,
      );
      const manifest = claimManifest(claims, evidence);
      const events = [
        toolEvent("changed-target", "analyze_javascript_application", result),
      ];
      expect(
        grade(events, manifest, "analyze_javascript_application", claims)
          .factualCorrectness,
      ).toBe("failed");
    } finally {
      await harness.close();
    }
  });
});

describe("source-produced parser comparison known answers", () => {
  it("accepts exact source-produced heading changes and rejects fabricated depth or runtime claims", async () => {
    const root = await createTestTempDirectory("rea-known-answer-parser-");
    const targets = await createAgentEvaluationFixtures(root, resolve("."));
    const claims = agentFixtureClaims("javascript-export-shape", targets);
    if (claims === undefined) throw new Error("Missing parser rubric");
    const harness = await createApplicationMcpHarness();
    try {
      const left = await harness.client.callTool({
        name: "analyze_javascript_application",
        arguments: { input_path: targets.javascriptShapeLeft },
      });
      const right = await harness.client.callTool({
        name: "analyze_javascript_application",
        arguments: { input_path: targets.javascriptShapeRight },
      });
      const comparison = await harness.client.callTool({
        name: "compare_javascript_export_shapes",
        arguments: {
          left: resultEvidence(left),
          right: resultEvidence(right),
          left_module_path: "parser.mjs",
          left_export_name: "default",
          right_module_path: "parser.mjs",
          right_export_name: "default",
        },
      });
      expect(comparison.isError).not.toBe(true);
      const events = [
        toolEvent("left", "analyze_javascript_application", left),
        toolEvent("right", "analyze_javascript_application", right),
        toolEvent("comparison", "compare_javascript_export_shapes", comparison),
      ];
      const manifest = claimManifest(claims, resultEvidence(comparison));
      expect(
        grade(events, manifest, "analyze_javascript_application", claims)
          .factualCorrectness,
      ).toBe("passed");
      const wrongDepth = {
        claims: manifest.claims.map((claim) =>
          claim.id === "heading_change"
            ? {
                ...claim,
                value: {
                  status: "added",
                  path: "/depth",
                  discriminant: { path: "/type", value: "heading" },
                  left: { availability: "absent" },
                  right: { availability: "literal", value: 2 },
                },
              }
            : claim,
        ),
      };
      expect(
        grade(events, wrongDepth, "analyze_javascript_application", claims)
          .factualCorrectness,
      ).toBe("failed");
      const unsupportedRuntime = {
        claims: manifest.claims.map((claim) =>
          claim.id === "runtime_semantics"
            ? {
                ...claim,
                value: "established",
                authority: "controlled-replay",
                confidence: "observed",
              }
            : claim,
        ),
      };
      expect(
        grade(
          events,
          unsupportedRuntime,
          "analyze_javascript_application",
          claims,
        ).factualCorrectness,
      ).toBe("failed");
      expect(
        grade(
          events.filter((event) => event.item.id !== "left"),
          manifest,
          "analyze_javascript_application",
          claims,
        ).factualCorrectness,
      ).toBe("failed");
    } finally {
      await harness.close();
    }
  });
});

describe("Notes export known-answer evaluation", () => {
  it("grades real analysis and traces while rejecting false values and unsupported citations", async () => {
    const root = await createTestTempDirectory("rea-known-answer-notes-");
    const targets = await createAgentEvaluationFixtures(root, resolve("."));
    const claims = agentFixtureClaims("notes-export", targets);
    if (claims === undefined) throw new Error("Missing Notes rubric");
    expect(claims.map(({ id }) => id)).toEqual([
      "renderer_api",
      "renderer_ipc",
      "main_ipc",
      "preload",
      "feature_modules",
      "semantic_boundary",
    ]);
    const harness = await createApplicationMcpHarness();
    try {
      const workflow = await notesWorkflow(harness, targets.notesElectron);
      assertNotesAnswerFailures(workflow, claims);
      assertNotesUnsupportedClaims(workflow, claims);
      await assertNotesSeedBinding(harness, workflow, claims);
    } finally {
      await harness.close();
    }
  });

  it("binds Notes analysis and derived traces to the requested artifact path and bytes", async () => {
    const root = await createTestTempDirectory(
      "rea-known-answer-notes-identity-",
    );
    const targets = await createAgentEvaluationFixtures(root, resolve("."));
    const claims = agentFixtureClaims("notes-export", targets);
    if (claims === undefined) throw new Error("Missing Notes rubric");
    const foreign = join(root, "other-notes.asar");
    await cp(targets.notesElectron, foreign);
    const harness = await createApplicationMcpHarness();
    try {
      for (const path of [foreign, targets.notesElectron]) {
        if (path === targets.notesElectron) {
          await appendFile(
            join(root, "notes-electron/renderer.js"),
            "\n// changed shipped bytes\n",
          );
          await createPackage(join(root, "notes-electron"), path);
        }
        const workflow = await notesWorkflow(harness, path);
        const digest = notesEvidence(workflow, "analyze_javascript_application")
          .subject?.digest.sha256;
        expect(digest === targets.notesElectronSha256).toBe(path === foreign);
        const assessment = grade(
          workflow.events,
          claimManifestByOperation(claims, workflow.evidence),
          "analyze_javascript_application",
          claims,
        ).factualAssessment;
        expect(assessment.status).toBe("failed");
        assertClaimFailure(
          assessment,
          "renderer_api",
          "source_subject_mismatch",
        );
        for (const id of ["feature_modules", "semantic_boundary"])
          assertClaimFailure(assessment, id, "source_links_mismatch");
      }
    } finally {
      await harness.close();
    }
  });
});

type NotesWorkflow = Awaited<ReturnType<typeof notesWorkflow>>;

const notesEvidence = (
  workflow: NotesWorkflow,
  operation: string,
): Evidence => {
  const evidence = workflow.evidence.get(operation);
  if (evidence === undefined)
    throw new Error(`Missing Notes ${operation} Evidence`);
  return evidence;
};

const assertClaimFailure = (
  assessment: ReturnType<typeof grade>["factualAssessment"],
  id: string,
  failure: string,
) => {
  expect(assessment.claims).toContainEqual(
    expect.objectContaining({
      id,
      failures: expect.arrayContaining([failure]),
    }),
  );
};

const assertNotesAnswerFailures = (
  workflow: NotesWorkflow,
  claims: readonly FixtureClaimExpectation[],
) => {
  const manifest = claimManifestByOperation(claims, workflow.evidence);
  const assess = (answer: unknown, events = workflow.events) =>
    grade(events, answer, "analyze_javascript_application", claims)
      .factualAssessment;
  const baseline = assess(manifest);
  expect(
    baseline.status,
    JSON.stringify({
      manifestFailures: baseline.manifestFailures,
      failedClaims: baseline.claims
        .filter((claim) => claim.status !== "passed")
        .map(({ id, failures }) => ({ id, failures })),
    }),
  ).toBe("passed");
  const cases = [
    {
      id: "renderer_ipc",
      patch: {
        value: {
          channel: "notes:delete",
          operation: "send",
          source: "preload.js",
        },
      },
      failure: "value_mismatch",
    },
    {
      id: "semantic_boundary",
      patch: {
        value: { status: "found", coverage: "complete", relevant_unknowns: 0 },
      },
      failure: "value_mismatch",
    },
    {
      id: "feature_modules",
      patch: {
        value: {
          paths: ["csv.js", "main.js", "preload.js", "renderer.js"],
          coverage: "complete-within-source",
        },
      },
      failure: "value_mismatch",
    },
    {
      id: "renderer_api",
      patch: {
        evidence_id: notesEvidence(workflow, "trace_application_feature")
          .evidence_id,
      },
      failure: "source_operation_mismatch",
    },
  ];
  for (const { id, patch, failure } of cases) {
    const answer = {
      claims: manifest.claims.map((claim) =>
        claim.id === id ? { ...claim, ...patch } : claim,
      ),
    };
    assertClaimFailure(assess(answer), id, failure);
  }
  const missingParent = assess(
    manifest,
    workflow.events.filter((event) => event.item.id !== "notes-analysis"),
  );
  for (const id of ["feature_modules", "semantic_boundary"])
    assertClaimFailure(missingParent, id, "source_links_mismatch");
};

const assertNotesUnsupportedClaims = (
  workflow: NotesWorkflow,
  claims: readonly FixtureClaimExpectation[],
) => {
  const manifest = claimManifestByOperation(claims, workflow.evidence);
  const evidenceId = notesEvidence(
    workflow,
    "trace_application_feature",
  ).evidence_id;
  const unsupportedRuntime = {
    claims: [
      ...manifest.claims,
      {
        id: "runtime_export",
        value: "A click wrote notes.csv to the actual Downloads directory.",
        evidence_id: evidenceId,
        authority: "controlled-replay",
        confidence: "observed",
      },
    ],
  };
  expect(
    grade(
      workflow.events,
      unsupportedRuntime,
      "analyze_javascript_application",
      claims,
    ).factualAssessment.manifestFailures,
  ).toContain("unknown_claim:runtime_export");
  const prose = evaluateCodexEvents(
    [
      ...workflow.events,
      {
        type: "item.completed",
        item: {
          type: "agent_message",
          text: `Observed Evidence ${evidenceId}: notes:export, preload.js and main.js do not exist. The export certainly executed and wrote notes.csv; runtime behavior is known without further observation.`,
        },
      },
    ],
    "analyze_javascript_application",
    {
      requireEvidence: true,
      requiredAnswerTermGroups: [["notes:export"], ["preload.js"], ["main.js"]],
      fixtureClaims: claims,
    },
  );
  expect(prose).toMatchObject({
    finalCitesEvidence: true,
    answerTermCoverageMet: true,
    factualCorrectness: "failed",
  });
  expect(prose.factualAssessment.manifestFailures).toContain(
    "invalid_final_claim_manifest",
  );
};

const assertNotesSeedBinding = async (
  harness: Awaited<ReturnType<typeof createApplicationMcpHarness>>,
  workflow: NotesWorkflow,
  claims: readonly FixtureClaimExpectation[],
) => {
  const manifest = claimManifestByOperation(claims, workflow.evidence);
  for (const match of ["contains", undefined] as const) {
    const feature = await harness.client.callTool({
      name: "trace_application_feature",
      arguments: {
        application: notesEvidence(workflow, "analyze_javascript_application"),
        seed: {
          kind: "channel",
          value: "notes:export",
          ...(match === undefined ? {} : { match }),
          case_sensitive: false,
        },
        direction: "both",
      },
    });
    expect(feature.isError).not.toBe(true);
    const answer = {
      claims: manifest.claims.map((claim) =>
        claim.id === "feature_modules"
          ? { ...claim, evidence_id: resultEvidence(feature).evidence_id }
          : claim,
      ),
    };
    const assessment = grade(
      [
        ...workflow.events,
        toolEvent(
          `notes-feature-${match ?? "default"}`,
          "trace_application_feature",
          feature,
        ),
      ],
      answer,
      "analyze_javascript_application",
      claims,
    ).factualAssessment;
    expect(assessment.status).toBe(match === undefined ? "passed" : "failed");
    if (match === "contains") {
      assertClaimFailure(
        assessment,
        "feature_modules",
        "source_assertion_mismatch",
      );
      expect(
        assessment.claims.find(({ id }) => id === "feature_modules")?.failures,
      ).not.toContain("source_parameters_mismatch");
    }
  }
};

const notesWorkflow = async (
  harness: Awaited<ReturnType<typeof createApplicationMcpHarness>>,
  inputPath: string,
) => {
  const analysis = await harness.client.callTool({
    name: "analyze_javascript_application",
    arguments: { input_path: inputPath },
  });
  expect(analysis.isError).not.toBe(true);
  const application = resultEvidence(analysis);
  const feature = await harness.client.callTool({
    name: "trace_application_feature",
    arguments: {
      application,
      seed: {
        kind: "channel",
        value: "notes:export",
        match: "exact",
        case_sensitive: false,
      },
      direction: "both",
    },
  });
  expect(feature.isError).not.toBe(true);
  const semantic = await harness.client.callTool({
    name: "trace_javascript_semantics",
    arguments: {
      application,
      query: {
        seed: { kind: "property", name: "invoke" },
        direction: "forward-influence",
        include_ambiguous_dynamic_edges: false,
        expected: null,
      },
    },
  });
  expect(semantic.isError).not.toBe(true);
  return {
    events: [
      toolEvent("notes-analysis", "analyze_javascript_application", analysis),
      toolEvent("notes-feature", "trace_application_feature", feature),
      toolEvent("notes-semantic", "trace_javascript_semantics", semantic),
    ],
    evidence: new Map<string, Evidence>([
      ["analyze_javascript_application", application],
      ["trace_application_feature", resultEvidence(feature)],
      ["trace_javascript_semantics", resultEvidence(semantic)],
    ]),
  };
};

const claimManifestByOperation = (
  claims: readonly FixtureClaimExpectation[],
  evidenceByOperation: ReadonlyMap<string, Evidence>,
) => ({
  claims: claims.map(({ id, expectedValue, source }) => {
    const evidence = evidenceByOperation.get(source.operation);
    if (evidence === undefined)
      throw new Error(`Missing producer for claim ${id}`);
    return {
      id,
      value: expectedValue,
      evidence_id: evidence.evidence_id,
      authority: evidence.authority,
      confidence: evidence.confidence,
    };
  }),
});

const resultEvidence = (result: {
  readonly structuredContent?: unknown;
}): Evidence => parseEvidence(result.structuredContent);

const toolEvent = (id: string, tool: string, result: unknown) => ({
  type: "item.completed",
  item: {
    id,
    type: "mcp_tool_call",
    server: "rea",
    tool,
    arguments: {},
    result,
  },
});

const claimManifest = (
  claims: readonly FixtureClaimExpectation[],
  evidence: Evidence,
) => ({
  claims: claims.map(({ id, expectedValue }) => ({
    id,
    value: expectedValue,
    evidence_id: evidence.evidence_id,
    authority: evidence.authority,
    confidence: evidence.confidence,
  })),
});

const grade = (
  events: readonly unknown[],
  manifest: unknown,
  firstTool: string,
  fixtureClaims: readonly FixtureClaimExpectation[],
) =>
  evaluateCodexEvents(
    [
      ...events,
      {
        type: "item.completed",
        item: { type: "agent_message", text: JSON.stringify(manifest) },
      },
    ],
    firstTool,
    { fixtureClaims },
  );
