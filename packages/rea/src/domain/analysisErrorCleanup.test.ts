import { expect, it } from "vitest";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
  AnalysisTimeoutError,
} from "./analysisErrorCore.js";
import { analysisErrorWithCleanupFailure } from "./analysisErrorCleanup.js";
import {
  projectAnalysisError,
  projectAnalysisErrorWithoutCapturedOutput,
} from "./analysisErrorProjection.js";
import {
  analysisErrorCategory,
  analysisErrorRemediationAction,
  analysisErrorUserMessage,
} from "./analysisErrorPresentation.js";
import { ProviderCleanupError } from "./providerCleanupError.js";
import { createEvidence } from "./evidence.js";
import { ArtifactOperationError } from "./artifactOperationError.js";

it.each([false, true])(
  "keeps each owner's capture without text-based deduplication (matching: %s)",
  (matching) => {
    const primary = new AnalysisTimeoutError("inspect", 1234, {
      capturedOutput: {
        stdout: "primary-capture-sentinel",
        stderr: "",
        truncated: false,
      },
    });
    const cleanup = new ProviderCleanupError(
      "fixture",
      ["owned-worker"],
      {},
      {
        capturedOutput: {
          stdout: matching
            ? "primary-capture-sentinel"
            : "cleanup-capture-sentinel",
          stderr: "",
          truncated: true,
        },
      },
    );
    const composed = analysisErrorWithCleanupFailure(
      primary,
      cleanup,
      "inspect",
    );
    const projected = projectAnalysisError(composed);
    expect(projected.details?.captured_output).toEqual(primary.capturedOutput);
    expect(projected.details?.diagnostics).toMatchObject({
      primary_error: {
        code: "provider_timeout",
        details: { timeout_ms: 1234 },
      },
      cleanup_error: { details: { captured_output: cleanup.capturedOutput } },
    });
    expect(
      JSON.stringify(projected).split("primary-capture-sentinel"),
    ).toHaveLength(matching ? 3 : 2);
    if (!matching)
      expect(
        JSON.stringify(projected).split("cleanup-capture-sentinel"),
      ).toHaveLength(2);
    expect(
      projectAnalysisErrorWithoutCapturedOutput(primary).details,
    ).not.toHaveProperty("captured_output");
    expect(projectAnalysisError(primary).details?.captured_output).toEqual(
      primary.capturedOutput,
    );
  },
);

it("keeps dependency-owned resources empty after the final owner releases", () => {
  const file = new ProviderCleanupError("fixture", ["file-owner"], {});
  const trace = new ProviderCleanupError("fixture", ["trace-owner"], {});
  const composed = analysisErrorWithCleanupFailure(
    file,
    trace,
  ).bindCleanupDependencies([file, trace]);
  expect(new Set(composed.cleanupResources)).toEqual(
    new Set(["file-owner", "trace-owner"]),
  );
  file.resolveCleanup();
  expect(composed.cleanupResources).toEqual(["trace-owner"]);
  trace.resolveCleanup();
  expect(composed.cleanupIncomplete).toBe(false);
  expect(composed.cleanupResources).toEqual([]);
  expect(new Set(composed.cleanup?.resources)).toEqual(
    new Set(["file-owner", "trace-owner"]),
  );
});

it("keeps primary diagnostics separate from historical cleanup diagnostics with the same keys", () => {
  const primary = new AnalysisInputError("inspect", {
    diagnostics: {
      primary_error: "source observation",
      cleanup_error: "another source observation",
    },
  });
  const cleanup = new ProviderCleanupError("fixture", ["owned-input"], {});
  const composed = analysisErrorWithCleanupFailure(
    primary,
    cleanup,
  ).bindCleanupDependencies([primary, cleanup]);
  cleanup.resolveCleanup();
  const projected = projectAnalysisError(composed);
  expect(projected.details?.diagnostics).toEqual(primary.diagnostics);
  expect(projected.details?.cleanup_history).toMatchObject({
    primary_error: projectAnalysisError(primary),
    cleanup_error: { code: "cleanup_incomplete" },
  });
  expect(composed.cleanupPrimary).toBe(primary);
  expect(Object.hasOwn(composed, "cleanupPrimary")).toBe(false);
});

it.each([
  new ArtifactOperationError(
    "inspect_asset_catalog",
    "integrity",
    undefined,
    "Asset catalog changed during inspection: Contents/Resources/Assets.car",
  ),
  new AnalysisInputError("inspect", { diagnostics: { input: "original" } }, [
    {
      path: ["path"],
      reason: "out_of_range",
      message: "fixed input allowance",
    },
  ]),
  new AnalysisCancelledError("inspect", { cause: "caller reason" }),
  new AnalysisTimeoutError("inspect", 1234),
  new AnalysisResourceConstraintError(
    "inspect",
    "file-size",
    "fixed input allowance",
    { maximum_input_bytes: 123 },
    { retryable: false, remediationAction: "Select a smaller suitable input." },
  ),
  new AnalysisOutputError("inspect", "invalid output", {
    capturedOutput: {
      stdout: "original output",
      stderr: "original warning",
      truncated: true,
    },
    partialObservation: createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: null },
      {
        operation: "inspect",
        parameters: {},
        result: { original_fact: true },
        confidence: "observed",
        locations: [],
        limitations: [],
      },
    ),
  }),
])("restores the typed $_tag primary after confirmed cleanup", (primary) => {
  const original = projectAnalysisError(primary);
  const cleanup = new ProviderCleanupError(
    "fixture",
    ["owned-input"],
    { reason: "close denied" },
    {
      operation: "inspect",
      cleanup: { reason: "close denied", resources: ["owned-input"] },
    },
  );
  const composed = analysisErrorWithCleanupFailure(
    primary,
    cleanup,
    "inspect",
  ).bindCleanupDependencies([primary, cleanup]);
  expect(composed.cleanup?.reason).toBe("close denied");
  expect(composed.cleanup?.reason).not.toBe(
    projectAnalysisError(cleanup).message,
  );
  const pending = projectAnalysisError(composed);
  expect(pending.code).toBe("cleanup_incomplete");
  expect(pending.category).toBe(original.category);
  expect(analysisErrorCategory(composed)).toBe(original.category);
  const { diagnostics: _diagnostics, ...semanticDetails } =
    original.details ?? {};
  expect(pending.details).toMatchObject({
    ...semanticDetails,
    cleanup: "incomplete",
    execution_failure: original.code,
    resources: ["owned-input"],
  });
  cleanup.resolveCleanup();
  const projected = projectAnalysisError(composed);
  expect(projected).toMatchObject(original);
  expect(projected.details?.cleanup_history).toMatchObject({
    primary_error:
      primary.capturedOutput === undefined
        ? original
        : projectAnalysisErrorWithoutCapturedOutput(primary),
    cleanup_error: { code: "cleanup_incomplete" },
  });
  expect(projected.details).not.toHaveProperty("cleanup", "incomplete");
  expect(projected.details).not.toHaveProperty("resources");
  expect(analysisErrorCategory(composed)).toBe(original.category);
  expect(analysisErrorUserMessage(composed)).toBe(original.message);
  expect(analysisErrorRemediationAction(composed)).toBe(
    original.remediation.action,
  );
  expect(composed.cause).toBeInstanceOf(AggregateError);
  expect((composed.cause as AggregateError).errors[0]).toBe(primary);
});

it.each(["inner", "outer"] as const)(
  "waits for both nested cleanup owners when %s resolves first",
  (first) => {
    const primary = new AnalysisInputError("inspect", undefined, [
      { path: ["path"], reason: "missing_argument" },
    ]);
    const innerCleanup = new ProviderCleanupError("fixture", ["input"], {});
    const outerCleanup = new ProviderCleanupError("fixture", ["workspace"], {});
    const inner = analysisErrorWithCleanupFailure(
      primary,
      innerCleanup,
    ).bindCleanupDependencies([primary, innerCleanup]);
    const outer = analysisErrorWithCleanupFailure(
      inner,
      outerCleanup,
    ).bindCleanupDependencies([inner, outerCleanup]);
    const released = first === "inner" ? innerCleanup : outerCleanup;
    const pending = first === "inner" ? outerCleanup : innerCleanup;
    expect(projectAnalysisError(outer)).toMatchObject({
      code: "cleanup_incomplete",
      category: "invalid_input",
      details: {
        operation: "inspect",
        issues: primary.issues,
        execution_failure: "invalid_request",
      },
    });
    released.resolveCleanup();
    expect(outer.cleanupIncomplete).toBe(true);
    expect(projectAnalysisError(outer).code).toBe("cleanup_incomplete");
    expect(projectAnalysisError(outer).category).toBe("invalid_input");
    pending.resolveCleanup();
    expect(outer.cleanupIncomplete).toBe(false);
    expect(projectAnalysisError(outer)).toMatchObject(
      projectAnalysisError(primary),
    );
  },
);

it("does not infer cleanup success when a composition has no live owner binding", () => {
  const primary = new AnalysisInputError("inspect");
  const cleanup = new ProviderCleanupError("fixture", ["input"], {});
  const composed = analysisErrorWithCleanupFailure(primary, cleanup);
  cleanup.resolveCleanup();
  expect(projectAnalysisError(composed).code).toBe("cleanup_incomplete");
  expect(projectAnalysisError(composed).category).toBe("invalid_input");
  expect(composed.cleanupIncomplete).toBe(true);
});

it("keeps the physical failure primary when later cleanup observes cancellation", () => {
  const physical = Object.assign(new Error("selected file read EIO"), {
    code: "EIO",
  });
  const primary = new ArtifactOperationError(
    "inspect_asset_catalog",
    "io",
    undefined,
    physical.message,
    { cause: physical },
  );
  const reason = { request: "cancel after read failure" };
  const cleanup = new ProviderCleanupError(
    "fixture",
    ["owned-input"],
    {},
    {
      cause: new AnalysisCancelledError("inspect", { cause: reason }),
    },
  );
  const composed = analysisErrorWithCleanupFailure(
    primary,
    cleanup,
    "inspect",
  ).bindCleanupDependencies([primary, cleanup]);
  expect(projectAnalysisError(composed)).toMatchObject({
    code: "cleanup_incomplete",
    category: "execution_failure",
    details: {
      operation: "inspect_asset_catalog",
      reason: "io",
      detail: physical.message,
      execution_failure: "artifact_operation_failed",
    },
  });
  expect(composed.cleanupPrimary?.cause).toBe(physical);
  cleanup.resolveCleanup();
  expect(projectAnalysisError(composed)).toMatchObject(
    projectAnalysisError(primary),
  );
});

it("retains an observation attached to the composite after the primary failed", () => {
  const primary = new AnalysisInputError("inspect");
  const cleanup = new ProviderCleanupError("fixture", ["input"], {});
  const composed = analysisErrorWithCleanupFailure(
    primary,
    cleanup,
  ).bindCleanupDependencies([primary, cleanup]);
  const observation = createEvidence(
    undefined,
    { id: "fixture", name: "Fixture", version: null },
    {
      operation: "inspect",
      parameters: {},
      result: { late_fact: true },
      confidence: "observed",
      locations: [],
      limitations: [],
    },
  );
  composed.retainPartialObservation(observation);
  composed.resolveCleanup();
  expect(projectAnalysisError(composed).code).toBe("cleanup_incomplete");
  cleanup.resolveCleanup();
  expect(projectAnalysisError(composed)).toMatchObject({
    code: "invalid_request",
    details: { partial_observation: observation },
  });
});

it("retains an owner's finalization report independently of pending primary semantics", () => {
  const report = {
    owned_process_group: { state: "not_required" as const, reason: null },
    terminal_renderer: { state: "not_required" as const, reason: null },
    temporary_root: { state: "cleaned" as const, reason: null },
  };
  class ReportedCleanup extends ProviderCleanupError {
    override readonly cleanupReport = report;
  }
  const primary = new AnalysisInputError("inspect", undefined, [
    { path: ["path"], reason: "missing_argument" },
  ]);
  const finalized = new ReportedCleanup(
    "fixture",
    ["input"],
    {},
    {
      cleanupPrimary: primary,
    },
  );
  const later = new ProviderCleanupError("fixture", ["workspace"], {});
  const outer = analysisErrorWithCleanupFailure(
    finalized,
    later,
  ).bindCleanupDependencies([finalized, later]);
  const assertReport = (error: typeof outer) => {
    expect(projectAnalysisError(error)).toMatchObject({
      category: "invalid_input",
      details: {
        operation: "inspect",
        issues: primary.issues,
        cleanup_report: report,
      },
    });
  };
  assertReport(finalized);
  assertReport(outer);
  expect(outer.cleanupIncomplete).toBe(true);
  later.resolveCleanup();
  assertReport(outer);
  expect(outer.cleanupIncomplete).toBe(true);
  finalized.resolveCleanup();
  assertReport(outer);
  expect(outer.cleanupIncomplete).toBe(false);
});
