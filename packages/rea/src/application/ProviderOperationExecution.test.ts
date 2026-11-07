import { expect, it, vi } from "vitest";
import { z } from "zod";

import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import {
  executeProviderOperation,
  keepIncompleteObservation,
} from "./ProviderOperationExecution.js";

it("projects request-schema issues without exposing the request envelope", async () => {
  const execute = vi.fn();
  const result = await executeProviderOperation(
    "list_jeb_units",
    { parent_unit_path: "" },
    undefined,
    z.strictObject({
      operation: z.literal("list_jeb_units"),
      input: z.strictObject({ parent_unit_path: z.string().min(1) }),
    }),
    { execute },
    "observed",
  );

  expect(result.ok).toBe(false);
  if (result.ok || !(result.error instanceof AnalysisInputError))
    throw new Error("Expected input error");
  expect(result.error.issues).toEqual([
    {
      path: ["parent_unit_path"],
      reason: "out_of_range",
      minimum: 1,
    },
  ]);
  expect(result.error.cause).toBeInstanceOf(z.ZodError);
  expect(execute).not.toHaveBeenCalled();
});

it("removes only the owned envelope prefix while preserving nested caller paths", async () => {
  const execute = vi.fn();
  const result = await executeProviderOperation(
    "inspect",
    { input: "", rows: [{}], mode: "foreign", extra: "caller-only-marker" },
    undefined,
    z.strictObject({
      operation: z.literal("inspect"),
      input: z.strictObject({
        input: z.string().min(1),
        rows: z.array(z.strictObject({ name: z.string() })),
        mode: z.enum(["first", "second"]),
      }),
    }),
    { execute },
    "observed",
  );
  if (result.ok || !(result.error instanceof AnalysisInputError))
    throw new Error("Expected input error");
  expect(result.error.issues).toEqual([
    { path: ["input"], reason: "out_of_range", minimum: 1 },
    {
      path: ["rows", 0, "name"],
      reason: "missing_argument",
      expected: "string",
    },
    { path: ["mode"], reason: "invalid_value", expected: ["first", "second"] },
    { path: ["extra"], reason: "unknown_argument" },
  ]);
  expect(JSON.stringify(result.error.issues)).not.toContain(
    "caller-only-marker",
  );
  expect(execute).not.toHaveBeenCalled();
});

it("preserves operation correction outside the input envelope", async () => {
  const execute = vi.fn();
  const result = await executeProviderOperation(
    "unknown",
    {},
    undefined,
    z.strictObject({
      operation: z.literal("known"),
      input: z.strictObject({}),
    }),
    { execute },
    "observed",
  );
  if (result.ok || !(result.error instanceof AnalysisInputError))
    throw new Error("Expected input error");
  expect(result.error.issues).toEqual([
    { path: ["operation"], reason: "invalid_value", expected: ["known"] },
  ]);
  expect(execute).not.toHaveBeenCalled();
});

const cancelledScenario = (partial: unknown) =>
  new AnalysisCancelledError("capture_browser_scenario", {
    cause: { requested: "stop during capture" },
    partialObservation: partial as never,
  });

const wrapScenarioCleanup = (primary: AnalysisCancelledError) =>
  analysisErrorWithCleanupFailure(
    primary,
    new ProviderCleanupError("fixture", ["browser"], {}),
    "capture_browser_scenario",
  );

it("clears a non-JSON partial from the cleanup primary projection returns after retry", () => {
  const partial = { steps: [] as unknown[] };
  const primary = cancelledScenario(partial);
  const composed = wrapScenarioCleanup(primary);
  partial.steps.push(undefined);
  const reason =
    "Browser scenario provider retained a non-JSON incomplete observation.";
  const retained = keepIncompleteObservation(
    composed,
    "capture_browser_scenario",
    reason,
  );

  expect(retained).toBe(composed);
  expect(composed.partialObservation).toBeUndefined();
  expect(primary.partialObservation).toBeUndefined();
  expect(composed.secondaryFailures).toMatchObject([
    { _tag: "AnalysisOutputError", reason },
  ]);
  expect(primary.secondaryFailures[0]).toBeInstanceOf(AnalysisOutputError);
  expect(projectAnalysisError(composed).code).toBe("cleanup_incomplete");

  composed.resolveCleanup();
  expect(projectAnalysisError(composed)).toMatchObject({
    code: "cancelled",
    category: "cancelled",
  });
  expect(projectAnalysisError(composed).details).not.toHaveProperty(
    "partial_observation",
  );
});

it("freezes one shared snapshot for a cleanup wrapper and its primary", () => {
  const partial = { steps: ["kept"] };
  const primary = cancelledScenario(partial);
  const composed = wrapScenarioCleanup(primary);
  keepIncompleteObservation(
    composed,
    "capture_browser_scenario",
    "unused because the partial is JSON",
  );

  expect(composed.partialObservation).toBe(primary.partialObservation);
  expect(composed.partialObservation).toEqual({ steps: ["kept"] });
  expect(Object.isFrozen(composed.partialObservation)).toBe(true);
  expect(composed.secondaryFailures).toHaveLength(0);
  expect(primary.secondaryFailures).toHaveLength(0);
});

it("freezes a retained partial so a later mutation cannot break projection", () => {
  const partial = { steps: [] as unknown[] };
  const primary = cancelledScenario(partial);
  keepIncompleteObservation(
    primary,
    "capture_browser_scenario",
    "unused because the partial is JSON",
  );
  partial.steps.push(undefined);

  expect(primary.partialObservation).toEqual({ steps: [] });
  expect(Object.isFrozen(primary.partialObservation)).toBe(true);
  expect(primary.secondaryFailures).toHaveLength(0);
  expect(projectAnalysisError(primary)).toMatchObject({
    code: "cancelled",
    details: { partial_observation: { steps: [] } },
  });
});
