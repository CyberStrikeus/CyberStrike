import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  GhidraHeadlessLauncher,
  GhidraLaunchError,
  type GhidraLaunchSession,
} from "./GhidraLauncher.js";
import { bindGhidraSessionFailure } from "./GhidraSessionError.js";

// The POSIX `bin/java` fixture cannot execute on Windows (extensionless sh script
// handed to execFile), so these tests only run on POSIX hosts.
const it = test.skipIf(process.platform === "win32");

/** Projection bound per launcher-command stream asserted by the tests. */
const EXPECTED_OUTPUT_BOUND_BYTES = 8 * 1024;

const launchSession = (runtimeRoot: string): GhidraLaunchSession => ({
  runtimeRoot,
  transport: "unix-socket",
  endpointPath: join(runtimeRoot, "endpoint.sock"),
  token: "test-token",
  runId: "test-run",
  targetPath: join(runtimeRoot, "target.bin"),
  targetSha256: "0".repeat(64),
  providerVersion: "test",
  profileDigest: "test",
});

/** Stand-in "java" whose LaunchSupport probe fails the way a broken JVM does. */
const failingJavaHome = async (script: string): Promise<string> => {
  const javaHome = await mkdtemp(join(tmpdir(), "rea-fake-java-"));
  await mkdir(join(javaHome, "bin"), { recursive: true });
  await writeFile(join(javaHome, "bin", "java"), script, { mode: 0o755 });
  return javaHome;
};

const probeLauncher = (javaHome: string, runtimeRoot: string) =>
  new GhidraHeadlessLauncher({
    environment: {},
    platform: "darwin",
    analyzeHeadlessPath: join(runtimeRoot, "support", "analyzeHeadless"),
    configurationDirectoryName: "ghidra_test_PUBLIC",
    javaHome,
    bridgeScriptPath: join(runtimeRoot, "bridge", "ReaGhidraBridge.java"),
  });

const launchOutcomeOf = (error: Error): Record<string, unknown> | undefined => {
  const sessionError = bindGhidraSessionFailure(() => ({}))(
    "start",
    error.message,
    error,
  );
  const cause = sessionError.diagnostics["failure_cause"] as Record<
    string,
    unknown
  >;
  const nested = cause["cause"] as Record<string, unknown> | undefined;
  const outcome = nested?.["command_outcome"] as Record<string, unknown>;
  return outcome === undefined ? undefined : outcome;
};

describe("Ghidra launch failure diagnostics", () => {
  it("retains the failed launcher command outcome on the launch error", async () => {
    const javaHome = await failingJavaHome(
      "#!/bin/sh\necho 'jvm probe exploded' >&2\nexit 3\n",
    );
    const runtimeRoot = await mkdtemp(join(tmpdir(), "rea-ghidra-launch-"));
    try {
      const launched = await probeLauncher(javaHome, runtimeRoot).launch(
        launchSession(runtimeRoot),
      );
      expect(launched.ok).toBe(false);
      if (launched.ok) throw new Error("expected the launch to fail");
      expect(launched.error).toBeInstanceOf(GhidraLaunchError);
      expect(launched.error.message).toBe("Ghidra headless launch failed");
      const captured =
        launched.error instanceof GhidraLaunchError
          ? launched.error.capturedOutput
          : undefined;
      expect(captured).toBeUndefined();
      const outcome = launchOutcomeOf(launched.error);
      expect(outcome).toMatchObject({
        killed: false,
        outputTruncated: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdout: "",
      });
      expect(outcome?.["stderr"]).toContain("jvm probe exploded");
    } finally {
      await rm(javaHome, { recursive: true, force: true });
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  it("bounds projected launcher output and marks truncation explicitly", async () => {
    const oversized = `${"x".repeat(EXPECTED_OUTPUT_BOUND_BYTES)}UNRETAINED-TAIL`;
    const javaHome = await failingJavaHome(
      `#!/bin/sh\nprintf '%s' '${oversized}' >&2\nexit 1\n`,
    );
    const runtimeRoot = await mkdtemp(join(tmpdir(), "rea-ghidra-launch-"));
    try {
      const launched = await probeLauncher(javaHome, runtimeRoot).launch(
        launchSession(runtimeRoot),
      );
      expect(launched.ok).toBe(false);
      if (launched.ok) throw new Error("expected the launch to fail");
      const outcome = launchOutcomeOf(launched.error);
      expect(outcome?.["stderrTruncated"]).toBe(true);
      expect(outcome?.["outputTruncated"]).toBe(false);
      expect(outcome?.["stderrBytes"]).toBe(oversized.length);
      const stderr = outcome?.["stderr"];
      if (typeof stderr !== "string")
        throw new Error("Expected launcher stderr");
      expect(stderr.length).toBeLessThanOrEqual(EXPECTED_OUTPUT_BOUND_BYTES);
      expect(stderr).not.toContain("UNRETAINED-TAIL");
    } finally {
      await rm(javaHome, { recursive: true, force: true });
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  it("leaves non-command launch failures without retained output", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "rea-ghidra-launch-"));
    try {
      const launcher = new GhidraHeadlessLauncher({
        environment: {},
        platform: "darwin",
        analyzeHeadlessPath: join(runtimeRoot, "support", "analyzeHeadless"),
        configurationDirectoryName: "ghidra_test_PUBLIC",
        bridgeScriptPath: join(runtimeRoot, "bridge", "ReaGhidraBridge.java"),
      });
      const launched = await launcher.launch(launchSession(runtimeRoot));
      expect(launched.ok).toBe(false);
      if (launched.ok) throw new Error("expected the launch to fail");
      expect(launched.error).toBeInstanceOf(GhidraLaunchError);
      expect(launched.error.message).toBe("Ghidra headless launch failed");
      expect(
        launched.error instanceof GhidraLaunchError
          ? launched.error.capturedOutput
          : undefined,
      ).toBeUndefined();
      expect(launchOutcomeOf(launched.error)).toBeUndefined();
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});
