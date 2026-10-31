import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AnalysisCancelledError } from "../../../../src/domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import {
  GhidraHeadlessLauncher,
  GhidraLaunchError,
} from "../../../../src/ghidra/GhidraLauncher.js";
import { GhidraLaunchSupportError } from "../../../../src/ghidra/GhidraJavaLaunch.js";
import { ExecFileOutputCancelledError } from "../../../../src/process/ExecFileOutput.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

const launch = async (
  javaLaunch: NonNullable<
    ConstructorParameters<typeof GhidraHeadlessLauncher>[0]["javaLaunch"]
  >,
  signal: AbortSignal,
) => {
  const root = await createTestTempDirectory("rea-ghidra-launch-outcome-");
  const spawnProcess = vi.fn(async () => {
    throw new Error("Unexpected spawn after Java failure");
  });
  const launcher = new GhidraHeadlessLauncher({
    environment: {},
    platform: "linux",
    analyzeHeadlessPath: join(root, "support", "analyzeHeadless"),
    configurationDirectoryName: "ghidra_12.1.4_PUBLIC",
    javaHome: join(root, "jdk"),
    bridgeScriptPath: join(root, "bridge.java"),
    javaLaunch,
    spawnProcess,
  });
  const result = await launcher.launch(
    {
      runtimeRoot: root,
      transport: "unix-socket",
      endpointPath: join(root, "bridge.sock"),
      token: "fixture-token",
      runId: "fixture-launch-outcome",
      targetPath: join(root, "unused-target"),
      targetSha256: "a".repeat(64),
      providerVersion: "test",
      profileDigest: "b".repeat(64),
    },
    { signal },
  );
  expect(spawnProcess).not.toHaveBeenCalled();
  return result;
};

it.each(["physical", "support"] as const)(
  "preserves %s Java launch failure when cancellation arrives before catch",
  async (kind) => {
    const controller = new AbortController();
    const physical = new Error("controlled earlier physical failure");
    const failure =
      kind === "support"
        ? new GhidraLaunchSupportError("-envvars", physical)
        : physical;
    const result = await launch(async () => {
      controller.abort(null);
      throw failure;
    }, controller.signal);
    if (result.ok) throw new Error("Expected launch failure");
    expect(result.error).toBeInstanceOf(GhidraLaunchError);
    expect(result.error.cause).toBe(failure);
  },
);

it.each([null, "caller stopped helper", new Error("opaque caller reason")])(
  "preserves the LaunchSupport producer's cancellation reason %j",
  async (reason) => {
    const result = await launch(async () => {
      throw new GhidraLaunchSupportError(
        "-envvars",
        new ExecFileOutputCancelledError(reason),
      );
    }, new AbortController().signal);
    if (result.ok) throw new Error("Expected helper cancellation");
    const primary =
      result.error instanceof GhidraLaunchError
        ? result.error.primaryFailure
        : result.error;
    expect(primary).toBeInstanceOf(AnalysisCancelledError);
    expect(primary?.cause).toBe(reason);
  },
);

it("does not adopt a caller error's cleanup resources at initial cancellation", async () => {
  const controller = new AbortController();
  const reason = new ProviderCleanupError("foreign", ["caller-resource"], {
    reason: "caller-owned",
  });
  controller.abort(reason);
  const result = await launch(async () => {
    throw new Error("Unexpected Java launch");
  }, controller.signal);
  if (result.ok) throw new Error("Expected cancellation");
  expect(result.error).toMatchObject({
    _tag: "AnalysisCancelledError",
    cause: reason,
    cleanupIncomplete: false,
  });
  expect(reason.cleanupIncomplete).toBe(true);
});

it("wraps an opaque typed caller reason at the real spawn preparation checkpoint", async () => {
  const root = await createTestTempDirectory("rea-ghidra-preparation-cancel-");
  const controller = new AbortController();
  const reason = new ProviderCleanupError("foreign", ["foreign-resource"], {
    reason: "caller-owned",
  });
  const launcher = new GhidraHeadlessLauncher({
    environment: {},
    platform: process.platform,
    analyzeHeadlessPath: join(root, "support", "analyzeHeadless"),
    configurationDirectoryName: "ghidra_12.1.4_PUBLIC",
    javaHome: join(root, "jdk"),
    bridgeScriptPath: join(root, "bridge.java"),
    javaLaunch: async () => {
      controller.abort(reason);
      return {
        command: join(root, "must-not-spawn"),
        arguments: [],
        environment: {},
      };
    },
  });
  const result = await launcher.launch(
    {
      runtimeRoot: root,
      transport: "unix-socket",
      endpointPath: join(root, "bridge.sock"),
      token: "fixture-token",
      runId: "fixture-preparation-cancel",
      targetPath: join(root, "unused-target"),
      targetSha256: "a".repeat(64),
      providerVersion: "test",
      profileDigest: "b".repeat(64),
    },
    { signal: controller.signal },
  );
  expect(result).toMatchObject({
    ok: false,
    error: {
      primaryFailure: {
        _tag: "AnalysisCancelledError",
        cause: reason,
        cleanupIncomplete: false,
      },
      cleanupFailure: undefined,
    },
  });
  expect(reason.cleanupIncomplete).toBe(true);
});
