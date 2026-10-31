import { describe, expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";

import { ProcessCaptureError } from "../../../src/process/capture/ProcessCaptureError.js";
import {
  analysisErrorJsonSchema,
  analysisErrorProjectionSchema,
} from "../../../src/contracts/errorSchemas.js";
import { ArtifactOperationError } from "../../../src/domain/artifactOperationError.js";
import { EvidenceFileError } from "../../../src/domain/evidenceErrors.js";
import { HopperRemoteError } from "../../../src/domain/hopperErrors.js";
import { UnknownRegistryError } from "../../../src/domain/unknownRegistryError.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { BrowserObservationError } from "../../../src/domain/browserObservationError.js";
import {
  AnalysisCancelledError,
  AnalysisTimeoutError,
} from "../../../src/domain/analysisErrorCore.js";
import type { AnalysisError } from "../../../src/domain/analysisErrorBase.js";

it.each([
  { declaredSha256: "a".repeat(64), calculatedSha256: "b".repeat(64) },
  {
    algorithm: "md5" as const,
    declaredMd5: "a".repeat(32),
    calculatedMd5: "b".repeat(32),
  },
])("retains partial observations on integrity errors", (digests) => {
  const error = new ArtifactOperationError(
    "trace_web_module_imports",
    "integrity",
    {
      logicalPath: "modules/main.js",
      unpacked: false,
      ...digests,
    },
  );
  error.retainPartialObservation({
    kind: "web-artifact-acquisition",
    analysis: "not-performed",
    files: [],
  });
  const projected = projectAnalysisError(error);
  expect(analysisErrorProjectionSchema.parse(projected)).toEqual(projected);
  const validate = new Ajv2020({ strict: false }).compile(
    analysisErrorJsonSchema,
  );
  expect(validate(projected), JSON.stringify(validate.errors)).toBe(true);
});

describe("analysis error projection contract", () => {
  it("keeps cleanup failure distinct from unreadable collected output", () => {
    const projected = projectAnalysisError(
      new BrowserObservationError(
        "capture_electron_scenario",
        "cleanup_failed",
        {
          cause: new Error("lineage could not be inspected"),
          cleanup: {
            reason: "process table permission denied",
            resources: ["owned_process_group"],
          },
          capturedOutput: {
            stdout: "completed observation",
            stderr: "",
            truncated: false,
          },
        },
      ),
    );
    expect(projected).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        cleanup_reason: "process table permission denied",
        execution_failure: "execution_failure",
        captured_output: { stdout: "completed observation", truncated: false },
      },
    });
    expect(projected.details).not.toHaveProperty("primary_reason");
    expect(analysisErrorProjectionSchema.safeParse(projected).success).toBe(
      true,
    );
  });

  it.each([
    [new AnalysisCancelledError("capture_electron_scenario"), "cancelled"],
    [new AnalysisTimeoutError("capture_electron_scenario", 10), "timeout"],
    [
      new BrowserObservationError("capture_electron_scenario", "disconnected"),
      "disconnected",
    ],
  ] as const)(
    "preserves direct and aggregated primary failures: %s",
    (primary, reason) => {
      for (const cause of [
        primary,
        new AggregateError([primary, new Error("close failed")]),
      ]) {
        const projected = projectAnalysisError(
          new BrowserObservationError(
            "capture_electron_scenario",
            "cleanup_failed",
            {
              cause,
              cleanup: {
                reason: "close failed",
                resources: ["owned_process_group"],
              },
            },
          ),
        );
        expect(projected).toMatchObject({
          code: "cleanup_incomplete",
          details: { primary_reason: reason, cleanup_reason: "close failed" },
        });
        expect(analysisErrorProjectionSchema.safeParse(projected).success).toBe(
          true,
        );
      }
    },
  );

  it("accepts every closed error-reason variant", () => {
    const variants: AnalysisError[] = [
      ...(
        [
          "cancelled",
          "format",
          "integrity",
          "limit",
          "path",
          "unavailable",
          "io",
        ] as const
      ).map(
        (reason) => new ArtifactOperationError("inventory_artifact", reason),
      ),
      ...(
        [
          "not-file",
          "exists",
          "invalid-json",
          "missing",
          "path-limit",
          "io",
        ] as const
      ).map((reason) => new EvidenceFileError("read", reason)),
      ...(
        [
          "not-found",
          "already-exists",
          "revision-conflict",
          "invalid-transition",
          "integrity",
          "limit",
        ] as const
      ).map((reason) => new UnknownRegistryError(reason)),
      ...(["capture_failed", "cleanup_incomplete", "cancelled"] as const).map(
        (reason) =>
          new ProcessCaptureError("API_TOKEN=selected capture diagnostic", {
            reason,
          }),
      ),
      ...(
        [
          "remote",
          "authorization",
          "invalid_request",
          "bridge_exception",
        ] as const
      ).map(
        (diagnostic) =>
          new HopperRemoteError(9, "safe", { diagnosticType: diagnostic }),
      ),
    ];

    for (const variant of variants) {
      const projected = projectAnalysisError(variant);
      expect(
        analysisErrorProjectionSchema.safeParse(projected),
        JSON.stringify({ variant, projected }),
      ).toMatchObject({ success: true });
      expect(projected.code).toMatch(/^[a-z][a-z0-9_]*$/u);
      if (variant instanceof ProcessCaptureError)
        expect(projected).toMatchObject({
          message: variant.message,
          details: { execution_failure: variant.message },
        });
    }
  });
});
