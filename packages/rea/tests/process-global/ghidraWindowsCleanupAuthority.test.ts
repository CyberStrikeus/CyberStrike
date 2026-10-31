import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";

vi.mock("../../src/windows/WindowsPrivateRuntime.js", () => ({
  windowsPrivateRuntime: () => ({ mkdir() {}, writeFile() {} }),
}));

import {
  GhidraHeadlessLauncher,
  GhidraLaunchError,
} from "../../src/ghidra/GhidraLauncher.js";
import type {
  ProviderProcessHandle,
  SpawnedOwnedProviderProcess,
} from "../../src/process/ProviderProcess.js";
import type { ProcessCleanupResult } from "../../src/process/ProcessOwnership.js";

it.each([false, true])(
  "retains Windows cleanup authority for retry after cancellation=%s without PID signaling",
  async (cancel) => {
    const controller = new AbortController();
    const kill = vi.fn(() => true);
    const process: ProviderProcessHandle = Object.assign(new EventEmitter(), {
      pid: 4242,
      stdout: null,
      stdin: null,
      stderr: null,
      exitCode: null,
      signalCode: null,
      kill,
    });
    const spawned: SpawnedOwnedProviderProcess & {
      cleanup?: () => Promise<ProcessCleanupResult>;
    } = {
      process,
      ownership: {
        runId: "fixture-run",
        leaderPid: 4242,
        processGroupId: 4242,
      },
    };
    const launcher = new GhidraHeadlessLauncher({
      platform: "win32",
      configurationDirectoryName: "ghidra_test_PUBLIC",
      environment: {},
      analyzeHeadlessPath: "C:\\Ghidra\\support\\analyzeHeadless.bat",
      bridgeScriptPath: "C:\\REA\\ReaGhidraBridge.java",
      comSpec: "C:\\Windows\\System32\\cmd.exe",
      javaLaunch: async () => ({
        command: "unused",
        arguments: [],
        environment: {},
      }),
      spawnProcess: async () => {
        if (cancel) controller.abort("fixture cancellation");
        return spawned;
      },
    });
    const result = await launcher.launch(
      {
        runtimeRoot: "C:\\REA\\runtime",
        transport: "authenticated-loopback-tcp",
        endpointPath: "C:\\REA\\runtime\\endpoint.json",
        token: "fixture-token",
        runId: "fixture-run",
        targetPath: "C:\\REA\\target.exe",
        targetSha256: "a".repeat(64),
        providerVersion: "test",
        profileDigest: "b".repeat(64),
      },
      { signal: controller.signal },
    );
    const launch = result.ok
      ? result.value
      : result.error instanceof GhidraLaunchError
        ? result.error.partialLaunch
        : undefined;
    expect(result.ok).toBe(!cancel);
    expect(launch).toBeDefined();
    if (launch === undefined || !launch.ownsProcessLifetime)
      throw new Error("missing owner");
    expect(await launch.cleanup?.()).toEqual({
      cleaned: false,
      reason: "Windows Ghidra process has no owned cleanup capability",
    });
    expect(kill).not.toHaveBeenCalled();
    const cleanup = vi.fn(async (): Promise<ProcessCleanupResult> => ({
      cleaned: true,
      signaled: true,
    }));
    spawned.cleanup = cleanup;
    expect(await launch.cleanup?.()).toEqual({ cleaned: true, signaled: true });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(kill).not.toHaveBeenCalled();
  },
);
