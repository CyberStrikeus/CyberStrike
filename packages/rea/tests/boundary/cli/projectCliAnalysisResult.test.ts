import { expect, it } from "vitest";

import { AnalysisInputError } from "../../../src/domain/analysisErrorCore.js";
import { analysisErrorWithCleanupFailure } from "../../../src/domain/analysisErrorCleanup.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { freezeJsonSnapshot } from "../../../src/domain/immutableJson.js";
import { ownedJsonObjectSchema } from "../../../src/domain/jsonValue.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { err, ok } from "../../../src/domain/result.js";
import { projectCliAnalysisResult } from "../../../src/cli/projectCliAnalysisResult.js";

const binding = {
  operation: "inspect_keyed_archive",
  fields: { path: "archive" },
};

it("projects bound input fields without changing canonical facts or nested identities", () => {
  const original = freezeJsonSnapshot(
    projectAnalysisError(
      new AnalysisInputError("inspect_keyed_archive", undefined, [
        {
          path: ["path", "path", 0],
          reason: "invalid_format",
          observed: { path: "verbatim source" },
        },
        { path: ["root"], reason: "invalid_value", expected: ["main"] },
      ]),
    ),
  );
  const mapped = projectCliAnalysisResult(err(original), binding);
  expect(mapped).toEqual({
    ...original,
    details: {
      ...original.details,
      issues: [
        {
          path: ["archive", "path", 0],
          reason: "invalid_format",
          observed: { path: "verbatim source" },
        },
        { path: ["root"], reason: "invalid_value", expected: ["main"] },
      ],
    },
  });
  expect(original.details?.issues).toMatchObject([
    { path: ["path", "path", 0] },
    { path: ["root"] },
  ]);
  const details = ownedJsonObjectSchema.parse(
    ownedJsonObjectSchema.parse(mapped).details,
  );
  const mappedIssues = details.issues;
  const originalIssues = original.details?.issues;
  if (!Array.isArray(mappedIssues) || !Array.isArray(originalIssues))
    throw new Error("Expected projected input issues");
  expect(mappedIssues[1]).toBe(originalIssues[1]);
  expect(ownedJsonObjectSchema.parse(mappedIssues[0]).observed).toBe(
    ownedJsonObjectSchema.parse(originalIssues[0]).observed,
  );
});

it("keeps cleanup history and retained output while binding the actionable primary issue", () => {
  const primary = new AnalysisInputError(
    "inspect_keyed_archive",
    {
      capturedOutput: {
        stdout: "retained source output",
        stderr: "",
        truncated: false,
      },
    },
    [{ path: ["path"], reason: "invalid_value" }],
  );
  const cleanup = new ProviderCleanupError(
    "fixture",
    ["owned-input"],
    {},
    {
      cleanup: { reason: "close denied", resources: ["owned-input"] },
    },
  );
  const original = freezeJsonSnapshot(
    projectAnalysisError(analysisErrorWithCleanupFailure(primary, cleanup)),
  );
  expect(original.code).toBe("cleanup_incomplete");
  const mapped = projectCliAnalysisResult(err(original), binding);
  expect(mapped).toMatchObject({
    code: "cleanup_incomplete",
    details: {
      execution_failure: "invalid_request",
      issues: [{ path: ["archive"], reason: "invalid_value" }],
      diagnostics: {
        primary_error: { details: { issues: [{ path: ["path"] }] } },
      },
      captured_output: { stdout: "retained source output" },
    },
  });
  expect(mapped).toEqual({
    ...original,
    details: {
      ...original.details,
      issues: [{ path: ["archive"], reason: "invalid_value" }],
    },
  });
  const details = ownedJsonObjectSchema.parse(
    ownedJsonObjectSchema.parse(mapped).details,
  );
  expect(details.diagnostics).toBe(original.details?.diagnostics);
  expect(details.captured_output).toBe(original.details?.captured_output);
});

it("passes through successful data, unbound operations and unknown error values", () => {
  const value = { path: "caller-selected data" };
  expect(projectCliAnalysisResult(ok(value), binding)).toBe(value);
  const targetError = projectAnalysisError(
    new AnalysisInputError("open_binary", undefined, [
      { path: ["path"], reason: "invalid_format" },
    ]),
  );
  expect(projectCliAnalysisResult(err(targetError), binding)).toBe(targetError);
  const unbound = projectAnalysisError(
    new AnalysisInputError("inspect_keyed_archive", undefined, [
      { path: ["root"], reason: "invalid_value" },
    ]),
  );
  expect(projectCliAnalysisResult(err(unbound), binding)).toBe(unbound);
  expect(projectCliAnalysisResult(err(targetError))).toBe(targetError);
  const unknown = {
    code: "future_failure",
    details: {
      operation: "inspect_keyed_archive",
      issues: [{ path: ["path"] }],
    },
  };
  expect(projectCliAnalysisResult(err(unknown), binding)).toBe(unknown);
});
