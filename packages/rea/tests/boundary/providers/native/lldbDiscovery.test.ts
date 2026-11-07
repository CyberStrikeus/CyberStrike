import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

import { DEFAULT_NATIVE_COMMAND_TIMEOUT_MS } from "../../../../src/domain/native/nativeDeadlines.js";
import { thinMach } from "../../../../src/domain/binaryTarget.fixture.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { err } from "../../../../src/domain/result.js";
import { LldbCallTracer } from "../../../../src/native/LldbCallTracer.js";
import { NativeCommandFailure } from "../../../../src/native/CommandRunner.js";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import {
  NativeFixtureRunner,
  nativeMachoTargetForFile,
} from "../../../fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

for (const [reason, code] of [
  ["timeout", "provider_timeout"],
  ["output-limit", "resource_constraint"],
  ["io", "execution_failure"],
  ["unavailable", "capability_unavailable"],
  ["cancelled", "cancelled"],
] as const)
  it(`preserves LLDB discovery ${reason} through the native provider client`, async () => {
    const directory = await createTestTempDirectory("rea-lldb-discovery-");
    const target = join(directory, "inert-header.macho");
    await writeFile(target, thinMach(0xfeedfacf, 0x0100000c));
    const controller = new AbortController();
    const abortReason = { requested: "cancel discovery" };
    const failure = new NativeCommandFailure(
      "lldb",
      reason,
      null,
      {
        cause: new Error("Fixture xcrun failure"),
        ...(reason === "cancelled"
          ? { cancellation: { reason: abortReason } }
          : {}),
      },
      {
        stdout: "fixture discovery output",
        stderr: "fixture discovery diagnostic",
        stdoutBytes: 24,
        stderrBytes: 28,
        exitCode: null,
        signal: null,
        truncated: false,
      },
    );
    const launch = vi.fn(async () => {
      throw new Error("Discovery failure cannot launch LLDB");
    });
    const tracer = new LldbCallTracer({}, launch, async (_tool, signal) => {
      expect(signal).toBe(controller.signal);
      if (reason === "cancelled") controller.abort(abortReason);
      return err(failure);
    });
    const client = new NativeMacOSProvider(
      {},
      new NativeFixtureRunner(),
      "darwin",
      () => tracer,
    ).createClient(await nativeMachoTargetForFile(target));
    try {
      const result = await client.execute(
        "observe_native_calls",
        {
          breakpoints: [{ kind: "function", name: "main" }],
        },
        { signal: controller.signal },
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected discovery failure");
      expect(launch).not.toHaveBeenCalled();
      expect(result.error.cause).toBe(
        reason === "cancelled" ? abortReason : failure,
      );
      const projected = projectAnalysisError(result.error);
      expect(projected).toMatchObject({
        code,
        details: {
          captured_output: {
            stdout: failure.capture?.stdout,
            stderr: failure.capture?.stderr,
          },
        },
      });
      if (reason === "timeout") {
        expect(projected).toMatchObject({
          retryable: true,
          recovery: {
            kind: "inspect_timeout_state",
            operation: "observe_native_calls",
            timeout_ms: DEFAULT_NATIVE_COMMAND_TIMEOUT_MS,
          },
          remediation: {
            action: expect.stringContaining(
              "discovery deadline has no runtime override",
            ),
          },
        });
        expect(projected.remediation.action).not.toContain(
          "Increase native_command_timeout_ms",
        );
      } else if (reason === "unavailable")
        expect(projected.message).toBe(
          "LLDB from Xcode or the Command Line Tools is not available",
        );
      else
        expect(projected.message).not.toBe(
          "LLDB from Xcode or the Command Line Tools is not available",
        );
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });
