import { expect, it } from "vitest";

import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { runAdbCapture } from "./AdbCommand.js";

// Exercise the real subprocess capture and public error projection, substituting
// only the bring-your-own executable. These are not Android-device checks.
it.each([
  {
    name: "overflow",
    source: 'process.stdout.write("X".repeat(4096))',
    maxOutputBytes: 64,
    code: "resource_constraint",
    stdout: "X".repeat(64),
    stderr: "",
    truncated: true,
  },
  {
    name: "timeout",
    source:
      'process.stdout.write("partial-雪"); process.stderr.write("waiting\\n"); setInterval(() => {}, 1000)',
    code: "provider_timeout",
    stdout: "partial-雪",
    stderr: "waiting\n",
  },
  {
    name: "offline device",
    source:
      'process.stdout.write("partial-雪"); process.stderr.write("adb: error: device offline\\n"); process.exitCode = 1',
    code: "unsupported_target",
    stdout: "partial-雪",
    stderr: "adb: error: device offline\n",
  },
  {
    name: "local path refusal",
    source:
      'process.stdout.write("partial-雪"); process.stderr.write("adb: error: cannot stat \'/host/token file\': Permission denied\\n"); process.exitCode = 1',
    code: "unsupported_target",
    stdout: "partial-雪",
    stderr: "adb: error: cannot stat '/host/token file': Permission denied\n",
  },
])("preserves bounded capture on $name", async (testCase) => {
  const result = await runAdbCapture(
    "pull_adb_file",
    {
      device: "caller-device",
      path: "/remote/source",
      localPath: "/host/token file",
    },
    {
      binary: process.execPath,
      pathSource: "environment",
      environment: { REA_TEST_PRIVATE: "ambient-value-must-not-be-persisted" },
    },
    ["-e", testCase.source],
    {
      timeoutMs: testCase.name === "timeout" ? 500 : 5_000,
      maxOutputBytes: testCase.maxOutputBytes ?? 1024,
    },
    undefined,
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const projected = projectAnalysisError(result.error);
  expect(projected).toMatchObject({
    code: testCase.code,
    details: {
      captured_output: {
        stdout: testCase.stdout,
        stderr: testCase.stderr,
        stdout_bytes: Buffer.byteLength(testCase.stdout),
        stderr_bytes: Buffer.byteLength(testCase.stderr),
        truncated: testCase.truncated ?? false,
      },
    },
  });
  if (testCase.code === "unsupported_target")
    expect(projected.details?.path).toBe(
      testCase.name === "local path refusal"
        ? "/host/token file"
        : "caller-device",
    );
  expect(JSON.stringify(projected)).not.toContain(
    "ambient-value-must-not-be-persisted",
  );
});
