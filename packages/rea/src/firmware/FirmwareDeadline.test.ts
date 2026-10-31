import { afterEach, expect, it, vi } from "vitest";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { firmwareRequestSchema } from "../domain/firmware/firmwareAnalysis.js";
import {
  firmwareFailure,
  firmwareLimitRecovery,
  firmwarePhaseInterruption,
  firmwareProcessLimitRecovery,
  firmwareSignalLimitError,
} from "./FirmwareFailures.js";
import { FIRMWARE_LIMITS } from "./FirmwareRelease.js";
import { startFirmwareDeadline } from "./FirmwareDeadline.js";

afterEach(() => vi.restoreAllMocks());

it.each(["inspect_firmware_regions", "extract_firmware"] as const)(
  "validates %s analysis timer boundaries and preserves omission",
  (operation) => {
    const parse = (settings: Record<string, unknown>) =>
      firmwareRequestSchema.parse({
        operation,
        input: {
          path: "/firmware.bin",
          ...(operation === "extract_firmware"
            ? { output_directory: "/output" }
            : {}),
          ...settings,
        },
      });
    expect(parse({}).input).not.toHaveProperty("analysis_timeout_ms");
    for (const value of [1, 2_147_483_647])
      expect(parse({ analysis_timeout_ms: value }).input).toHaveProperty(
        "analysis_timeout_ms",
        value,
      );
    for (const value of [0, -1, 0.5, 2_147_483_648, null, "120000"])
      expect(() => parse({ analysis_timeout_ms: value })).toThrow();
  },
);

it("enforces absolute expiry before the timer callback while preserving observed caller cancellation", () => {
  const now = vi.spyOn(performance, "now").mockReturnValue(100);
  const deadline = startFirmwareDeadline("publication", 1_000);
  expect(deadline.expiresAtMs).toBe(1_100);
  now.mockReturnValue(1_099);
  expect(
    firmwarePhaseInterruption("extract_firmware", deadline.signal, deadline),
  ).toBeUndefined();
  now.mockReturnValue(1_100);
  expect(deadline.signal.aborted).toBe(false);
  const expired = firmwarePhaseInterruption(
    "extract_firmware",
    deadline.signal,
    deadline,
  );
  if (expired === undefined) throw new Error("Expected elapsed deadline");
  expect(projectAnalysisError(expired)).toMatchObject({
    code: "provider_timeout",
    details: { timeout_ms: 1_000, diagnostics: { phase: "publication" } },
  });
  const reason = { caller: "stop at expiry" };
  const cancelled = firmwarePhaseInterruption(
    "extract_firmware",
    AbortSignal.abort(reason),
    deadline,
  );
  expect(cancelled).toBeInstanceOf(AnalysisCancelledError);
  expect(cancelled?.cause).toBe(reason);
});

it("defaults and preserves the caller's publication budget at the shared contract", () => {
  const parse = (input: Record<string, unknown>) =>
    firmwareRequestSchema.parse({
      operation: "extract_firmware",
      input: { path: "/firmware.bin", output_directory: "/output", ...input },
    });
  expect(parse({}).input).toMatchObject({ publication_timeout_ms: 120_000 });
  expect(parse({ publication_timeout_ms: 345_678 }).input).toMatchObject({
    publication_timeout_ms: 345_678,
  });
  for (const value of [0, -1, 0.5, 2_147_483_648, null, "120000"])
    expect(() => parse({ publication_timeout_ms: value })).toThrow();
});

it("reports the publication phase, verified progress and its selected budget", () => {
  const reason = new Error("deadline");
  const failure = firmwareFailure(
    new AnalysisCancelledError("extract_firmware", { cause: reason }),
    {
      engine: "unblob",
      operation: "extract_firmware",
      deadline: {
        phase: "publication",
        signal: AbortSignal.abort(reason),
        timeoutMs: 345_678,
        expiresAtMs: 0,
      },
      publication: {
        output_directory: "/output",
        verified_files: 2,
        total_files: 10,
      },
    },
  );
  expect(projectAnalysisError(failure)).toMatchObject({
    code: "provider_timeout",
    details: {
      timeout_ms: 345_678,
      diagnostics: {
        phase: "publication",
        publication: {
          output_directory: "/output",
          verified_files: 2,
          total_files: 10,
        },
      },
    },
    remediation: { action: expect.stringContaining("publication_timeout_ms") },
  });
});

it("keeps a distinct caller cancellation when the phase deadline has also expired", () => {
  const reason = { caller: "stop" };
  const original = new AnalysisCancelledError("extract_firmware", {
    cause: reason,
  });
  expect(
    firmwareFailure(original, {
      engine: "unblob",
      operation: "extract_firmware",
      deadline: {
        phase: "publication",
        signal: AbortSignal.abort(new Error("late timeout")),
        timeoutMs: 345_678,
        expiresAtMs: 0,
      },
    }),
  ).toBe(original);
});

it.each([1234, 2_147_483_647])(
  "names the actual adjustable analysis budget %s without suggesting publication repair",
  (timeoutMs) => {
    const reason = new Error("analysis deadline");
    const failure = firmwareFailure(
      new AnalysisCancelledError("inspect_firmware_regions", { cause: reason }),
      {
        engine: "binwalk",
        operation: "inspect_firmware_regions",
        deadline: {
          phase: "analysis",
          signal: AbortSignal.abort(reason),
          timeoutMs,
          expiresAtMs: 0,
        },
      },
    );
    const projected = projectAnalysisError(failure);
    expect(projected).toMatchObject({
      code: "provider_timeout",
      details: { timeout_ms: timeoutMs, diagnostics: { phase: "analysis" } },
      remediation: { action: expect.stringContaining("analysis_timeout_ms") },
    });
    expect(projected.remediation.action).toContain("--analysis-timeout-ms");
    expect(projected.remediation.action).toContain("publication_timeout_ms");
    expect(projected.remediation.action).toContain("CPU");
    if (timeoutMs === 2_147_483_647)
      expect(projected.remediation.action).toContain("maximum");
  },
);

it("says a CPU signal is fixed and analysis_timeout_ms does not raise it", () => {
  const error = firmwareSignalLimitError(
    "inspect_firmware_regions",
    "SIGXCPU",
    FIRMWARE_LIMITS.reportBytes,
    false,
  );
  const projected = projectAnalysisError(error!);
  expect(projected).toMatchObject({
    code: "resource_constraint",
    details: {
      resource: "cpu",
      reported_limits: { cpu_seconds: FIRMWARE_LIMITS.cpuSeconds },
    },
  });
  expect(projected.message).toContain(String(FIRMWARE_LIMITS.cpuSeconds));
  expect(projected.remediation.action).toBe(
    firmwareLimitRecovery(
      `cpuSeconds is ${String(FIRMWARE_LIMITS.cpuSeconds)}`,
    ),
  );
  expect(projected.remediation.action).toContain("no runtime override");
  expect(projected.remediation.action).toContain(
    "analysis_timeout_ms (--analysis-timeout-ms in the CLI) does not raise it",
  );
});

it("retains captured tool output on a CPU or file-size signal", () => {
  const captured = {
    stdout: "partial scan\n",
    stderr: "stopped by prlimit\n",
    stdout_bytes: 13,
    stderr_bytes: 19,
    exit_code: null,
    signal: "SIGXCPU",
    truncated: false,
  };
  for (const signal of ["SIGXCPU", "SIGXFSZ"] as const) {
    const error = firmwareSignalLimitError(
      "inspect_firmware_regions",
      signal,
      FIRMWARE_LIMITS.reportBytes,
      false,
      { ...captured, signal },
    );
    expect(projectAnalysisError(error!).details?.captured_output).toEqual({
      ...captured,
      signal,
    });
  }
});

it("names the fixed address-space allowance on an unclassified tool failure", () => {
  const recovery = firmwareProcessLimitRecovery(
    FIRMWARE_LIMITS.reportBytes,
    false,
  );
  expect(recovery).toContain(String(FIRMWARE_LIMITS.addressSpaceBytes));
  expect(recovery).toContain(String(FIRMWARE_LIMITS.cpuSeconds));
  expect(recovery).toContain("no runtime override");
  expect(recovery).toContain("analysis_timeout_ms does not raise");
});
