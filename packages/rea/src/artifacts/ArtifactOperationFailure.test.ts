import { expect, it } from "vitest";

import { ArtifactReaderFailure } from "./ArtifactReader.js";
import { translateArtifactFailure } from "./ArtifactOperationFailure.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";

it.each(["capacity", "file-size", "memory"] as const)(
  "retains the producing %s limit through public error projection",
  (boundary) => {
    const failure = new ArtifactReaderFailure(
      "limit",
      "The specific reader allowance was exceeded",
      { boundary },
    );
    const result = projectAnalysisError(
      translateArtifactFailure("inventory_artifact", failure),
    );
    expect(result).toMatchObject({
      code: "truncated",
      retryable: false,
      message: failure.message,
      details: { boundary, detail: failure.message },
    });
  },
);

it("keeps producer-owned recovery through cleanup wrapping and public projection", () => {
  const userMessage = "Caller-selected reader recovery";
  const failure = new ArtifactReaderFailure(
    "unavailable",
    "Exact command diagnostic",
    {
      userMessage,
    },
  );
  const wrapped = ArtifactReaderFailure.withCleanup(failure, {
    reason: "Owned staging cleanup needs retry",
    resources: ["owned staging"],
  });
  const projected = projectAnalysisError(
    translateArtifactFailure("inspect_artifact", wrapped),
  );
  expect(projected.message).toBe(userMessage);
  expect(projected.remediation.action).toBe(userMessage);
  expect(projected.details?.detail).toBe("Exact command diagnostic");
  expect(projected.details?.cleanup).toBeDefined();
});
