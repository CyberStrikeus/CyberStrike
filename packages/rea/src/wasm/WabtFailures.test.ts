import { expect, it } from "vitest";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { wabtFailure } from "./WabtFailures.js";
import { WABT_LIMITS } from "./WabtRelease.js";
import { OwnedCommandFailure } from "../process/OwnedCommand.js";

it.each(["configuration", "producer"] as const)(
  "retains timeout recovery under %s cleanup failure without making cleanup retryable",
  (phase) => {
    const cause = new OwnedCommandFailure(
      "timeout",
      "Command deadline elapsed.",
      null,
      "owned stop unconfirmed",
      undefined,
      ["pid:owned-fixture"],
    );
    const failure = wabtFailure(cause, phase, "/module.wasm", {
      commandTimeoutMs: 1234,
    });
    expect(failure.cause).toBe(cause);
    const projected = projectAnalysisError(failure);
    expect(projected).toMatchObject({
      code: "cleanup_incomplete",
      retryable: false,
      details: {
        resources: ["pid:owned-fixture"],
        diagnostics: {
          previous_error: {
            code: "provider_timeout",
            details: {
              timeout_ms: 1234,
              limit: {
                setting: "wasm.command_timeout_ms",
                effective_value: 1234,
                rea_restart_required: false,
              },
            },
            recovery: { kind: "inspect_timeout_state", timeout_ms: 1234 },
          },
        },
      },
    });
    expect(projected.recovery).toBeUndefined();
  },
);

it("retains timeout command output once, including when cleanup wraps its recovery", () => {
  for (const cleanup of [null, "stop unconfirmed"]) {
    const cause = new OwnedCommandFailure(
      "timeout",
      "deadline",
      {
        stdout: { text: "partial-owned-output", bytes: 20, observedBytes: 20 },
        stderr: { text: "", bytes: 0, observedBytes: 0 },
        exitCode: null,
        signal: null,
      },
      cleanup,
    );
    const projected = projectAnalysisError(
      wabtFailure(cause, "producer", "/module.wasm", {
        commandTimeoutMs: 1234,
      }),
    );
    expect(
      JSON.stringify(projected).split("partial-owned-output"),
    ).toHaveLength(2);
    expect(projected.code).toBe(
      cleanup === null ? "provider_timeout" : "cleanup_incomplete",
    );
  }
});

it.each([1234, 2_147_483_647])(
  "reports the actual %i ms command budget without an unsupported higher timer",
  (commandTimeoutMs) => {
    const projected = projectAnalysisError(
      wabtFailure(
        new OwnedCommandFailure("timeout", "deadline"),
        "producer",
        "/module.wasm",
        { commandTimeoutMs },
      ),
    );
    expect(projected).toMatchObject({
      code: "provider_timeout",
      details: {
        timeout_ms: commandTimeoutMs,
        limit: {
          setting: "wasm.command_timeout_ms",
          effective_value: commandTimeoutMs,
          minimum: 1,
          maximum: 2_147_483_647,
          unit: "ms",
          parameter: "command_timeout_ms",
          applies_at: "next_operation",
          agent_editable: true,
          rea_restart_required: false,
        },
      },
      recovery: { kind: "inspect_timeout_state", timeout_ms: commandTimeoutMs },
    });
  },
);

it.each([
  { reason: "timeout" as const, cleanup: null, code: "provider_timeout" },
  { reason: "cancelled" as const, cleanup: null, code: "cancelled" },
  {
    reason: "process" as const,
    cleanup: "owned stop failed",
    code: "cleanup_incomplete",
  },
])(
  "retains version-probe facts without changing $reason cleanup=$cleanup",
  ({ reason, cleanup, code }) => {
    const cause = new OwnedCommandFailure(
      reason,
      "version command failed",
      null,
      cleanup,
    );
    const probe = {
      configuration_key: "REA_WABT_BIN_DIRECTORY" as const,
      executable_path: "/tools/wasm2wat",
      tool: "wasm2wat",
      expected_version: "1.0.42" as const,
    };
    const failure = wabtFailure(cause, "configuration", "/selected.wasm", {
      commandTimeoutMs: 1234,
      versionProbe: probe,
    });
    const original = wabtFailure(cause, "configuration", "/selected.wasm");
    expect(failure._tag).toBe(original._tag);
    expect(failure.cleanupIncomplete).toBe(original.cleanupIncomplete);
    expect(failure.cause).toBe(original.cause);
    expect(projectAnalysisError(failure)).toMatchObject({
      code,
      details: { diagnostics: probe },
    });
  },
);

it.each([
  { code: "EACCES", action: "read and execute access" },
  {
    code: "ENOENT",
    action: "contains wasm-validate, wasm-objdump and wasm2wat",
  },
  { code: "ENOTDIR", action: "directory, not an individual executable" },
])(
  "explains $code configuration recovery without blaming the WASM input",
  ({ code, action }) => {
    const failure = wabtFailure(
      Object.assign(new Error(`tool admission failed: ${code}`), { code }),
      "configuration",
      "/selected.wasm",
    );
    const projected = projectAnalysisError(failure);
    expect(projected).toMatchObject({
      code: "capability_unavailable",
      retryable: false,
      remediation: { action: expect.stringContaining(action) },
    });
    expect(projected.remediation.action).toContain("REA_WABT_BIN_DIRECTORY");
    expect(projected.remediation.action).toContain("restart");
    expect(projected.remediation.action).toContain("Do not repeat");
  },
);

it.each([false, true])(
  "preserves the file-size boundary with cleanup=%s when an input exceeds its fixed allowance",
  (cleanup) => {
    const cause = new ArtifactReaderFailure(
      "limit",
      "Selected artifact exceeds its byte allowance",
      {
        boundary: "file-size",
        ...(cleanup
          ? {
              cleanup: { reason: "close denied", resources: ["selected.wasm"] },
            }
          : {}),
      },
    );
    const projected = projectAnalysisError(
      wabtFailure(cause, "artifact", "selected.wasm"),
    );
    expect(projected).toMatchObject({
      code: cleanup ? "cleanup_incomplete" : "resource_constraint",
      category: "resource_constraint",
      retryable: false,
      details: {
        resource: "file-size",
        reported_limits: { maximum_input_bytes: WABT_LIMITS.inputBytes },
      },
    });
    if (!cleanup) {
      expect(projected.remediation.action).toContain("input byte allowance");
      expect(projected.remediation.action).not.toContain("evidence reply");
    }
    expect(
      wabtFailure(cause, "artifact", "selected.wasm").cleanupResources,
    ).toEqual(cleanup ? ["selected.wasm"] : []);
  },
);

it("keeps oversized tool admission distinct from selected artifact size", () => {
  const cause = new ArtifactReaderFailure(
    "limit",
    "Configured tool exceeds its byte allowance",
    { boundary: "file-size" },
  );
  expect(
    projectAnalysisError(wabtFailure(cause, "configuration", "selected.wasm"))
      .code,
  ).toBe("capability_unavailable");
});

it.each([null, { stopped: "caller" }])(
  "keeps the command-owned cancellation reason as the direct typed cause: %j",
  (reason) => {
    const cause = new OwnedCommandFailure(
      "cancelled",
      "cancelled",
      null,
      null,
      { cancellation: { reason } },
    );
    const error = wabtFailure(cause, "producer", "/module.wasm");
    expect(error._tag).toBe("AnalysisCancelledError");
    expect(error.cause).toBe(reason);
  },
);
it("attributes optional artifact admission to its selected caller field", () => {
  const cause = Object.assign(new Error("missing candidate"), {
    code: "ENOENT",
  });
  expect(
    projectAnalysisError(
      wabtFailure(cause, "artifact", "/missing.wasm", {
        commandTimeoutMs: 30000,
        inputField: ["candidate_paths", 2],
      }),
    ),
  ).toMatchObject({
    code: "invalid_request",
    details: { issues: [{ path: ["candidate_paths", 2] }] },
  });
});
