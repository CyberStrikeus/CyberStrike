import { projectCliAnalysisResult } from "../../../src/cli/projectCliAnalysisResult.js";
import { expect, it } from "vitest";

import { finishAnalysisCommand } from "../../../src/cli/finishAnalysisCommand.js";
import { AnalysisOutputError } from "../../../src/domain/analysisErrorCore.js";
import {
  projectAnalysisError,
  projectAnalysisErrorWithoutCapturedOutput,
} from "../../../src/domain/analysisErrorProjection.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { err, ok } from "../../../src/domain/result.js";
import { scriptCaptureEvidenceFixture } from "../../fixtures/webScriptCapture.js";

it("preserves producer-owned cleanup failure when service close does not resolve it", async () => {
  const evidence = scriptCaptureEvidenceFixture();
  const failure = new ProviderCleanupError(
    "fixture-provider",
    ["producer-owned-resource"],
    { reason: "producer cleanup was not confirmed" },
    { operation: "inspect_web_page", partialObservation: evidence },
  );
  const expected = projectAnalysisError(failure);
  const result = await finishAnalysisCommand(
    async () => err(failure),
    { close: async () => {} },
    "fixture-provider",
    "inspect_web_page",
    new AbortController().signal,
  );

  expect(result).toEqual(err(expected));
  expect(failure.cleanupIncomplete).toBe(true);
});

it("returns completed partial Evidence when cancellation arrives during close", async () => {
  const evidence = scriptCaptureEvidenceFixture();
  const controller = new AbortController();
  const result = await finishAnalysisCommand(
    async () => ok(evidence),
    {
      close: async () => {
        controller.abort(new Error("cancelled during close"));
      },
    },
    "fixture-provider",
    "capture_browser_scenario",
    controller.signal,
  );

  expect(result).toMatchObject({
    ok: false,
    error: {
      code: "cancelled",
      details: { partial_observation: { evidence_id: evidence.evidence_id } },
    },
  });
});

it("preserves the primary operation error when cancellation arrives during close", async () => {
  const controller = new AbortController();
  const result = await finishAnalysisCommand(
    async () =>
      err(new AnalysisOutputError("inspect_web_page", "primary failure")),
    {
      close: async () => {
        controller.abort();
      },
    },
    "fixture-provider",
    "inspect_web_page",
    controller.signal,
  ).then(projectCliAnalysisResult);

  expect(result).toMatchObject({
    code: "unreadable_output",
    details: {
      reason: "primary failure",
      operation: "inspect_web_page",
    },
  });
});

it("retains late cancellation and completed Evidence when close also fails", async () => {
  const evidence = scriptCaptureEvidenceFixture();
  const controller = new AbortController();
  const cleanup = new ProviderCleanupError(
    "fixture-provider",
    ["retained connection"],
    { reason: "close failed" },
  );
  const result = await finishAnalysisCommand(
    async () => ok(evidence),
    {
      close: async () => {
        controller.abort({ during: "close" });
        throw cleanup;
      },
    },
    "fixture-provider",
    "inspect_web_page",
    controller.signal,
  ).then(projectCliAnalysisResult);
  expect(result).toMatchObject({
    code: "cleanup_incomplete",
    category: "cancelled",
    details: {
      partial_observation: evidence,
      diagnostics: {
        primary_error: { code: "cancelled" },
        cleanup_error: { details: { resources: ["retained connection"] } },
      },
    },
  });
});

it("keeps the initial failure snapshot when close resolves its cleanup but fails another resource during cancellation", async () => {
  const controller = new AbortController();
  const primary = new ProviderCleanupError(
    "fixture-provider",
    ["initial resource"],
    { reason: "initial cleanup refused" },
    {
      operation: "capture_browser_scenario",
      completedObservation: scriptCaptureEvidenceFixture(),
      capturedOutput: {
        stdout: "startup output",
        stderr: "startup diagnostic",
        exit_code: 1,
        signal: null,
        truncated: false,
      },
    },
  );
  const initial = projectAnalysisErrorWithoutCapturedOutput(primary);
  const result = await finishAnalysisCommand(
    async () => err(primary),
    {
      close: async () => {
        primary.resolveCleanup();
        controller.abort("cancelled during cleanup retry");
        throw new ProviderCleanupError(
          "fixture-provider",
          ["remaining resource"],
          { reason: "remaining cleanup denied" },
        );
      },
    },
    "fixture-provider",
    "capture_browser_scenario",
    controller.signal,
    undefined,
    {
      failureProjection: "initial",
      recoverCompletedObservation: () => {
        throw new Error("Initial failure snapshots must not recover output");
      },
    },
  );
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: "cleanup_incomplete",
      details: {
        captured_output: { stdout: "startup output" },
        diagnostics: {
          primary_error: initial,
          cleanup_error: { details: { resources: ["remaining resource"] } },
        },
      },
    },
  });
  expect(result).not.toHaveProperty(
    "error.details.diagnostics.primary_error.details.captured_output",
  );
});

it.each([false, true])(
  "recovers only producer-attested completed output after confirmed cleanup (cancel=%s)",
  async (cancel) => {
    const evidence = scriptCaptureEvidenceFixture();
    const controller = new AbortController();
    const failure = new ProviderCleanupError(
      "fixture-provider",
      ["root"],
      { reason: "initial cleanup refused" },
      {
        operation: "inspect_web_page",
        partialObservation: evidence,
        completedObservation: evidence,
      },
    );
    const result = await finishAnalysisCommand(
      async () => err(failure),
      {
        close: async () => {
          failure.resolveCleanup();
          if (cancel) controller.abort("cancelled during successful retry");
        },
      },
      "fixture-provider",
      "inspect_web_page",
      controller.signal,
      undefined,
      { recoverCompletedObservation: (observation) => observation },
    ).then(projectCliAnalysisResult);
    if (!cancel) expect(result).toEqual(evidence);
    else
      expect(result).toMatchObject({
        code: "cancelled",
        details: {
          partial_observation: evidence,
          diagnostics: {
            cleanup_history: {
              details: { diagnostics: { reason: "initial cleanup refused" } },
            },
          },
        },
      });
  },
);

it.each(["unresolved", "ordinary-partial", "initial-projection"] as const)(
  "does not recover %s cleanup output",
  async (kind) => {
    const evidence = scriptCaptureEvidenceFixture();
    const failure = new ProviderCleanupError(
      "fixture-provider",
      ["root"],
      { reason: "cleanup refused" },
      {
        partialObservation: evidence,
        ...(kind === "ordinary-partial"
          ? {}
          : { completedObservation: evidence }),
      },
    );
    const initial = projectAnalysisError(failure);
    let attemptedRecovery = false;
    const result = await finishAnalysisCommand(
      async () => err(failure),
      {
        close: async () => {
          if (kind !== "unresolved") failure.resolveCleanup();
        },
      },
      "fixture-provider",
      "inspect_web_page",
      new AbortController().signal,
      undefined,
      {
        ...(kind === "initial-projection"
          ? { failureProjection: "initial" as const }
          : {}),
        recoverCompletedObservation: (observation) => {
          attemptedRecovery = true;
          return observation;
        },
      },
    ).then(projectCliAnalysisResult);
    expect(attemptedRecovery).toBe(false);
    expect(result).toEqual(
      kind === "initial-projection" ? initial : projectAnalysisError(failure),
    );
  },
);
