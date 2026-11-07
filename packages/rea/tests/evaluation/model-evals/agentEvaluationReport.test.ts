import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  agentEvaluationPassed,
  summarizeFactualCorrectness,
} from "./AgentEvaluationReport.js";

const routingSuccess = {
  exitCode: 0,
  naturalUse: true,
  correctFirstTool: true,
  repeatedCallCount: 0,
  inputValidationFailureCount: 0,
  requiredToolSubsequenceMet: true,
  inputTokens: 100,
  answerHeuristicsMet: true,
  epistemicCuePresent: true,
};

describe("agent evaluation release gate", () => {
  it("exits unsuccessfully for a rejected report after accepting a passing report", () => {
    const passing = {
      id: "passing-fixture",
      ...routingSuccess,
      factualCorrectness: "passed",
    };
    const accepted = runReportGate([passing]);
    expect(accepted.status).toBe(0);
    const rejected = runReportGate([
      passing,
      { ...passing, id: "incorrect-fixture", factualCorrectness: "failed" },
    ]);
    // Negative control: a runner that lets the failed report pass exits zero.
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain(
      "Agent routing/workflow/answer checks failed: incorrect-fixture",
    );
  });
});

function runReportGate(results: readonly object[]) {
  const gateUrl = new URL(
    "../../../scripts/lib/agent-evaluation-report-gate.mjs",
    import.meta.url,
  );
  const script = `
    const { assertAgentEvaluationReportPassed } = await import(${JSON.stringify(gateUrl.href)});
    assertAgentEvaluationReportPassed(JSON.parse(process.argv[1]));
  `;
  return spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script, JSON.stringify(results)],
    { encoding: "utf8", timeout: 15_000 },
  );
}

describe("scoped factual report", () => {
  it("requires a validated target clarification and zero REA calls for the negative route", () => {
    const clarification = {
      ...routingSuccess,
      expectedFirstTool: null,
      naturalUse: false,
      factualCorrectness: "not_assessed" as const,
      answerHeuristicsMet: false,
      epistemicCuePresent: false,
      targetClarificationPassed: true,
    };
    expect(agentEvaluationPassed(clarification)).toBe(true);
    for (const change of [
      { naturalUse: true },
      { correctFirstTool: false },
      { targetClarificationPassed: false },
      { exitCode: 1 },
      { inputTokens: 0 },
    ])
      expect(agentEvaluationPassed({ ...clarification, ...change })).toBe(
        false,
      );
  });

  it("accepts correct structured facts without superficial prose cues", () => {
    expect(
      agentEvaluationPassed({
        ...routingSuccess,
        answerHeuristicsMet: false,
        epistemicCuePresent: false,
        factualCorrectness: "passed",
      }),
    ).toBe(true);
  });

  it("retains workflow and execution checks for factually correct answers", () => {
    for (const change of [
      { exitCode: 1 },
      { naturalUse: false },
      { correctFirstTool: false },
      { repeatedCallCount: 1 },
      { inputValidationFailureCount: 1 },
      { requiredToolSubsequenceMet: false },
      { inputTokens: 0 },
    ])
      expect(
        agentEvaluationPassed({
          ...routingSuccess,
          factualCorrectness: "passed",
          ...change,
        }),
      ).toBe(false);
  });

  it("retains heuristic checks only for unassessed scenarios", () => {
    expect(
      agentEvaluationPassed({
        ...routingSuccess,
        factualCorrectness: "not_assessed",
      }),
    ).toBe(true);
    expect(
      agentEvaluationPassed({
        ...routingSuccess,
        factualCorrectness: "not_assessed",
        answerHeuristicsMet: false,
      }),
    ).toBe(false);
    expect(
      agentEvaluationPassed({
        ...routingSuccess,
        factualCorrectness: "not_assessed",
        epistemicCuePresent: false,
      }),
    ).toBe(false);
    expect(
      agentEvaluationPassed({
        ...routingSuccess,
        factualCorrectness: "failed",
      }),
    ).toBe(false);
  });

  it("reports assessed failures separately from unassessed scenarios", () => {
    expect(
      summarizeFactualCorrectness([
        { factualCorrectness: "passed" },
        { factualCorrectness: "failed" },
        { factualCorrectness: "not_assessed" },
      ]),
    ).toEqual({
      status: "failed",
      scope: "configured_fixture_claims",
      counts: { assessed: 2, passed: 1, failed: 1, notAssessed: 1 },
    });
    expect(
      summarizeFactualCorrectness([
        { factualCorrectness: "passed" },
        { factualCorrectness: "not_assessed" },
      ]).status,
    ).toBe("passed");
    expect(
      summarizeFactualCorrectness([{ factualCorrectness: "not_assessed" }])
        .status,
    ).toBe("not_assessed");
    expect(summarizeFactualCorrectness([]).status).toBe("not_assessed");
  });
});
