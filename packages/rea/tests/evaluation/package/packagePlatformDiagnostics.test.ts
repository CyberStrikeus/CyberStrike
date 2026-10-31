import { describe, expect, it } from "vitest";

import {
  assertLinuxPackageProviderFailure,
  verifyPackagePlatform,
} from "../../../scripts/verify-package-platform.mjs";

const missingDisplay = {
  code: "provider_unavailable",
  details: {
    failure_code: "runtime_dependency_unavailable",
    exit_code: 79,
    diagnostics: {
      component: "hopper_private_display",
      operation: "probe",
      reason: "missing_xvfb",
      status: "error",
      failure_code: "runtime_dependency_unavailable",
      strategy: "unavailable",
    },
  },
};
const execution = (failure: unknown, status = 1) => ({
  status,
  stdout: JSON.stringify(failure),
});

const overview = (
  procedure_count?: unknown,
  operation = "binary_overview",
) => ({
  operation,
  ...(procedure_count === undefined
    ? {}
    : { normalized_result: { procedure_count } }),
});

const verifyMacOS = async (
  analyze: unknown,
  inspect: unknown,
): Promise<void> => {
  const outputs: Readonly<Record<string, unknown>> = {
    analyze,
    inspect,
    function: {
      operation: "analyze_function",
      provider: { id: "hopper" },
      normalized_result: { procedure: { address: "0x1000" } },
    },
    xrefs: { operation: "xrefs", normalized_result: ["0x1000"] },
    trace: { operation: "trace_feature" },
  };
  await verifyPackagePlatform({
    cli: "fixture-cli",
    environment: {},
    platform: "darwin",
    commands: {
      run: async (_cli, arguments_) =>
        JSON.stringify(outputs[arguments_[0]!]) ?? "",
      runWithStatus: async () => {
        throw new Error("Unexpected status command in macOS fixture");
      },
    },
  });
};

describe("packaged Linux failure verification", () => {
  it("accepts the unsupported fixture build or an exact missing display dependency", () => {
    expect(() =>
      assertLinuxPackageProviderFailure(execution(missingDisplay)),
    ).not.toThrow();
    expect(() =>
      assertLinuxPackageProviderFailure(
        execution({
          code: "provider_unavailable",
          details: { failure_code: "unsupported_hopper_build", exit_code: 72 },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertLinuxPackageProviderFailure(
        execution({
          code: "provider_unavailable",
          details: {
            stage: "launch",
            launch_rejection: {
              boundary: "publisher_verification",
              reason: "unsupported_hopper_build",
            },
          },
        }),
      ),
    ).not.toThrow();
  });

  it.each([
    execution({
      code: "provider_unavailable",
      details: {
        stage: "launch",
        launch_rejection: {
          boundary: "publisher_verification",
          reason: "download",
        },
      },
    }),
    execution({
      code: "provider_unavailable",
      details: {
        stage: "analysis",
        launch_rejection: {
          boundary: "publisher_verification",
          reason: "unsupported_hopper_build",
        },
      },
    }),
    execution({
      code: "provider_unavailable",
      details: {
        stage: "launch",
        launch_rejection: {
          boundary: "publisher_verification",
          reason: "unsupported_hopper_build",
        },
        exit_code: 72,
      },
    }),
    execution(missingDisplay, 0),
    execution({ code: "provider_unavailable" }),
    execution({
      ...missingDisplay,
      details: {
        failure_code: "runtime_dependency_unavailable",
        exit_code: 79,
      },
    }),
    execution({
      ...missingDisplay,
      details: {
        ...missingDisplay.details,
        diagnostics: {
          ...missingDisplay.details.diagnostics,
          reason: "ownership_mismatch",
        },
      },
    }),
    execution({
      ...missingDisplay,
      details: { failure_code: "unsupported_hopper_build", exit_code: 75 },
    }),
    execution({ ...missingDisplay, code: "internal_error" }),
  ])(
    "rejects success, unrelated failures, and incomplete diagnostics: %j",
    (result) => {
      expect(() => assertLinuxPackageProviderFailure(result)).toThrow(
        "did not fail closed",
      );
    },
  );
});

describe("packaged analyze and inspect result guards", () => {
  it("accepts positive integer procedure counts for both commands", async () => {
    await verifyMacOS(overview(1), overview(2));
  });

  const malformed = [
    ["missing result", undefined],
    ["null result", null],
    ["missing normalized count", overview()],
    ["zero count", overview(0)],
    ["non-integer count", overview(1.5)],
    ["wrong operation", overview(2, "other_operation")],
  ] as const;

  it.each(["analyze", "inspect"] as const)(
    "rejects malformed %s results before trusting the package",
    async (command) => {
      for (const [label, invalid] of malformed) {
        const analyze = command === "analyze" ? invalid : overview(4);
        const inspect = command === "inspect" ? invalid : overview(4);
        await expect(verifyMacOS(analyze, inspect), label).rejects.toThrow();
      }
    },
  );
});
