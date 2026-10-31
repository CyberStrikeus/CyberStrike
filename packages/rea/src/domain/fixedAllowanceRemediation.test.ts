import { describe, expect, it } from "vitest";
import {
  AnalysisResourceConstraintError,
  resourceConstraintRecovery,
} from "./analysisErrorCore.js";
import { projectAnalysisError } from "./analysisErrorProjection.js";
import {
  fixedAllowanceOptions,
  fixedAllowanceRemediation,
  type FixedAllowanceKind,
} from "./fixedAllowanceRemediation.js";

const forbidden = {
  parser: [
    /available host memory\. Retry/u,
    /worker memory limits and available/u,
  ],
  count: [
    /Wait for an active analysis/u,
    /\bretry\b/iu,
    /fixed byte allowance/u,
  ],
  bytes: [/Wait for an active analysis/u, /\bretry\b/iu, /fixed count/u],
  report: [/get_evidence_bundle/u, /complete CLI JSON output/u],
  input: [/evidence reply/u, /file-size allowance for the evidence/u],
  capture: [/available host memory\. Retry/u, /live output may change/u],
  live: [/available host memory\. Retry/u, /unchanged request/u],
  work: [/worker CPU limits and observed signal/u],
} as const;

describe("resource constraint recovery shape", () => {
  it("keeps a fixed allowance and a remediation action from co-occurring", () => {
    const allowance = new AnalysisResourceConstraintError(
      "inspect_fixture",
      "memory",
      "allowance_exceeded",
      null,
      fixedAllowanceOptions("parser_allowance", "parser"),
    );
    expect(allowance.recovery).toEqual({
      retryable: false,
      fixedAllowance: { name: "parser_allowance", kind: "parser" },
    });
    expect("remediationAction" in allowance.recovery).toBe(false);

    const guided = new AnalysisResourceConstraintError(
      "inspect_fixture",
      "capacity",
      "slots_occupied",
      null,
      { remediationAction: "wait_for_slot", retryable: true },
    );
    expect(guided.recovery).toEqual({
      remediationAction: "wait_for_slot",
      retryable: true,
    });
    expect("fixedAllowance" in guided.recovery).toBe(false);
    expect(resourceConstraintRecovery(guided)).toEqual(guided.recovery);
  });

  it("keeps only the fixed allowance when both recovery fields are supplied", () => {
    const conflict = {
      fixedAllowance: { name: "parser_allowance", kind: "parser" as const },
      remediationAction: "wait_for_slot",
      retryable: false as const,
    };
    const error = new AnalysisResourceConstraintError(
      "inspect_fixture",
      "memory",
      "allowance_exceeded",
      null,
      // The public options type cannot express both fields. This is the
      // runtime object the constructor still has to normalize.
      conflict as never,
    );
    expect(error.recovery).toEqual({
      fixedAllowance: { name: "parser_allowance", kind: "parser" },
      retryable: false,
    });
    expect(error.fixedAllowance).toEqual(conflict.fixedAllowance);
    expect(error.remediationAction).toBeUndefined();
    expect(resourceConstraintRecovery(error)).toEqual(error.recovery);
  });
});

describe("fixed allowance recovery", () => {
  it.each([
    ["parser", "memory"],
    ["count", "capacity"],
    ["bytes", "capacity"],
    ["report", "transport"],
    ["input", "file-size"],
    ["capture", "memory"],
    ["live", "memory"],
    ["work", "cpu"],
  ] as const)(
    "projects %s allowances without the generic %s fallback",
    (kind: FixedAllowanceKind, resource) => {
      const allowance = `The ${kind} allowance`;
      const error = new AnalysisResourceConstraintError(
        "inspect_fixture",
        resource,
        "allowance exceeded",
        { maximum: 1 },
        fixedAllowanceOptions(allowance, kind),
      );
      const projected = projectAnalysisError(error);
      expect(projected.retryable).toBe(false);
      expect(projected.remediation.action).toBe(
        fixedAllowanceRemediation(allowance, kind),
      );
      expect(projected.remediation.action).toContain(allowance);
      for (const pattern of forbidden[kind])
        expect(projected.remediation.action).not.toMatch(pattern);
      if (kind === "live")
        expect(projected.remediation.action).toContain(
          "live output may change between requests",
        );
      if (kind === "capture")
        expect(projected.remediation.action).toContain(
          "Repeating the unchanged request fails the same way.",
        );
    },
  );
});
