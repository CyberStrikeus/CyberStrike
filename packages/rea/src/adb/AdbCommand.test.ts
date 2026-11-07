import { expect, it, vi } from "vitest";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import {
  ExecFileOutputCancelledError,
  execFileBytes,
} from "../process/ExecFileOutput.js";
import { probeAdbPathExistence, runAdbCapture } from "./AdbCommand.js";

vi.mock("../process/ExecFileOutput.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../process/ExecFileOutput.js")>()),
  execFileBytes: vi.fn(),
}));

const probe = (signal?: AbortSignal) =>
  probeAdbPathExistence(
    "push_adb_file",
    "device",
    "/device/path",
    { binary: "/host/adb", pathSource: "environment", environment: {} },
    {
      timeoutMs: 100,
      maxOutputBytes: 1024,
    },
    signal,
  );

it("classifies the complete diagnostic before shortening its displayed reason", async () => {
  const localPath = `/host/${"directory/".repeat(60)}payload.bin`;
  const stderr = `adb: error: cannot create '${localPath}': Permission denied`;
  vi.mocked(execFileBytes).mockRejectedValueOnce(
    Object.assign(new Error("local destination refused"), {
      code: 1,
      stdout: "",
      stderr,
      signal: null,
      killed: false,
    }),
  );
  await expect(
    runAdbCapture(
      "pull_adb_file",
      { device: "device", path: "/remote/file", localPath },
      { binary: "/host/adb", pathSource: "environment", environment: {} },
      [],
      { timeoutMs: 100, maxOutputBytes: 2048 },
      undefined,
    ),
  ).resolves.toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisUnsupportedTargetError",
      path: localPath,
      reason: stderr.slice(0, 512),
    },
  });
});

it("recognizes only the completed empty false result as absence", async () => {
  vi.mocked(execFileBytes).mockRejectedValueOnce(
    Object.assign(new Error("test false"), {
      code: 1,
      stdout: "",
      stderr: "",
      signal: null,
      killed: false,
    }),
  );
  await expect(probe()).resolves.toEqual({ ok: true, value: false });
});

it.each([
  { code: 2 },
  { code: "ENOENT" },
  { signal: "SIGTERM" },
  { collectionFailure: true },
  { stdout: "unexpected" },
  { stderr: " " },
])("keeps nonstandard false completion unknown: %j", async (extra) => {
  vi.mocked(execFileBytes).mockRejectedValueOnce(
    Object.assign(new Error("probe failed"), {
      code: 1,
      stdout: "",
      stderr: "",
      signal: null,
      killed: false,
      ...extra,
    }),
  );
  const result = await probe();
  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisProtocolError",
      diagnostics: { destination_existence: "unknown" },
    },
  });
});

it.each([
  [{ killed: true }, "AnalysisTimeoutError"],
  [{ outputTruncated: true }, "AnalysisResourceConstraintError"],
] as const)(
  "preserves a stopped or incomplete probe: %j",
  async (extra, tag) => {
    vi.mocked(execFileBytes).mockRejectedValueOnce(
      Object.assign(new Error("probe failed"), {
        code: 1,
        stdout: "",
        stderr: "",
        signal: null,
        killed: false,
        ...extra,
      }),
    );
    await expect(probe()).resolves.toMatchObject({
      ok: false,
      error: { _tag: tag },
    });
  },
);

it("recognizes an empty successful probe as existence", async () => {
  vi.mocked(execFileBytes).mockResolvedValueOnce({
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  });
  await expect(probe()).resolves.toEqual({ ok: true, value: true });
});

it.each(["stdout", "stderr"] as const)(
  "retains unexpected successful %s as unknown",
  async (stream) => {
    vi.mocked(execFileBytes).mockResolvedValueOnce({
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      [stream]: Buffer.from("unexpected"),
    });
    await expect(probe()).resolves.toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisProtocolError",
        capturedOutput: { [stream]: "unexpected", exit_code: 0 },
      },
    });
  },
);

it.each([null, "caller stopped", new Error("caller stopped")] as const)(
  "uses the command owner's exact %s cancellation reason",
  async (reason) => {
    const cancelled = Object.assign(new ExecFileOutputCancelledError(reason), {
      stdout: "partial",
      stderr: "diagnostic",
      stdoutBytes: 7,
      stderrBytes: 10,
    });
    vi.mocked(execFileBytes).mockRejectedValueOnce(cancelled);
    const result = await probe();
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    if (result.ok) throw new Error("Expected owned cancellation");
    expect(result.error.cause).toBe(reason);
    expect(result.error.capturedOutput).toMatchObject({
      stdout: "partial",
      stderr: "diagnostic",
      stdout_bytes: 7,
      stderr_bytes: 10,
    });
  },
);

it("does not infer cancellation from a foreign ABORT_ERR code", async () => {
  const failure = Object.assign(new Error("foreign code"), {
    code: "ABORT_ERR",
    stdout: "",
    stderr: "",
  });
  vi.mocked(execFileBytes).mockRejectedValueOnce(failure);
  expect(await probe()).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisProtocolError" },
  });
});

it.each([true, false])(
  "projects a truncated adb capture as retryable only for volatile output (%s)",
  async (volatileOutput) => {
    vi.mocked(execFileBytes).mockRejectedValueOnce(
      Object.assign(new Error("too much"), {
        code: 1,
        stdout: "",
        stderr: "",
        signal: null,
        killed: false,
        outputTruncated: true,
      }),
    );
    const result = await runAdbCapture(
      volatileOutput ? "read_adb_logcat" : "install_adb_package",
      { device: "device" },
      { binary: "/host/adb", pathSource: "environment", environment: {} },
      volatileOutput ? ["logcat", "-d"] : ["install", "app.apk"],
      { timeoutMs: 100, maxOutputBytes: 1024, volatileOutput },
      undefined,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected a capture allowance refusal");
    const projected = projectAnalysisError(result.error);
    expect(projected.retryable).toBe(volatileOutput);
    expect(projected).toMatchObject({
      code: "resource_constraint",
      details: { reported_limits: { max_output_bytes: 1024 } },
    });
    expect(projected.details?.limit).toBeUndefined();
  },
);

it("reports the effective fixed adb deadline", async () => {
  vi.mocked(execFileBytes).mockRejectedValueOnce(
    Object.assign(new Error("deadline"), {
      code: "ETIMEDOUT",
      stdout: "",
      stderr: "",
      signal: null,
      killed: true,
    }),
  );
  const result = await runAdbCapture(
    "pull_adb_file",
    { device: "device" },
    { binary: "/host/adb", pathSource: "environment", environment: {} },
    ["pull", "/remote"],
    { timeoutMs: 600_000, maxOutputBytes: 1024 },
    undefined,
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected an adb deadline");
  const projected = projectAnalysisError(result.error);
  expect(projected).toMatchObject({
    code: "provider_timeout",
    details: { timeout_ms: 600_000 },
  });
  expect(projected.details?.limit).toBeUndefined();
});

it("keeps a physical failure even when the later abort reason is that same error", async () => {
  const controller = new AbortController();
  const failure = new Error("physical command failure");
  vi.mocked(execFileBytes).mockImplementationOnce(async () => {
    controller.abort(failure);
    throw failure;
  });
  const result = await runAdbCapture(
    "inspect_adb_device",
    { device: "device" },
    { binary: "/host/adb", pathSource: "environment", environment: {} },
    [],
    { timeoutMs: 100, maxOutputBytes: 1024 },
    controller.signal,
  );
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisProtocolError", cause: failure },
  });
});
