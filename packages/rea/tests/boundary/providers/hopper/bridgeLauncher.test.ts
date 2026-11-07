import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, chmod, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

import {
  HopperApplicationLauncher,
  type HopperApplicationLauncherOptions,
  linuxDemoLaunch,
  usesLinuxDemo,
} from "../../../../src/hopper/BridgeLauncher.js";

import { ProviderProcessSupervisor } from "../../../../src/process/ProviderProcess.js";
import { err, ok } from "../../../../src/domain/result.js";

import { HopperReleaseError } from "../../../../src/application/HopperReleaseFeed.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { ArtifactResourceScope } from "../../../../src/artifacts/ArtifactResourceScope.js";
import { AnalysisCleanupLease } from "../../../../src/artifacts/AnalysisCleanupLease.js";
import { ArtifactReaderFailure } from "../../../../src/artifacts/ArtifactReader.js";
import { PrivateRuntimeRoot } from "../../../../src/process/PrivateRuntimeRoot.js";
import { HopperClient } from "../../../../src/hopper/HopperClient.js";
import { selectLinuxPrivateDisplayStrategy } from "../../../../src/hopper/LinuxPrivateDisplayProbe.js";

const readyDirectDisplay = async () =>
  ({
    ok: true,
    strategy: "direct",
    diagnostic: {
      component: "hopper_private_display",
      operation: "probe",
      status: "ready",
      failure_code: null,
      reason: "ready",
      socket_directory: "/tmp/.X11-unix",
      socket_directory_mode: "1777",
      mount_read_only: false,
      effective_socket_directory_mode: "1777",
      effective_mount_read_only: false,
      wsl: false,
      strategy: "direct",
      fallback_reason: null,
      xvfb_stderr_bytes: 0,
    },
  }) as const;

const execFileAsync = promisify(execFile);
const verifiedSha256 = "0".repeat(64);
const demoHelperPath = fileURLToPath(
  new URL("../../../../scripts/hopper-demo-x11.py", import.meta.url),
);

const options = (launcherPath: string): HopperApplicationLauncherOptions => ({
  environment: {},
  launcherPath,
  targetPath: "/target",
  targetKind: "executable",
  loaderArgs: [],
  bridgeScriptPath: "/rea/hopper_bridge.py",
  launchMode: "verified_linux_demo",
  demoHelperPath: "/rea/hopper-demo-x11.py",
});

for (const deniedStops of [0, 2])
  it.skipIf(process.platform === "win32")(
    `retains a timed-out private-display probe through cleanup retry (denied stops=${String(deniedStops)})`,
    async () => {
      const directory = await createTestTempDirectory("rea-probe-owner-retry-");
      const originalStop = ProviderProcessSupervisor.prototype.stop;
      const captured: { current?: ProviderProcessSupervisor } = {};
      let attempts = 0;
      const stop = vi
        .spyOn(ProviderProcessSupervisor.prototype, "stop")
        .mockImplementation(function (
          this: ProviderProcessSupervisor,
          settings,
        ) {
          captured.current = this;
          attempts += 1;
          return attempts <= deniedStops
            ? Promise.resolve({
                status: "incomplete" as const,
                reason: "Fixture probe stop unavailable",
              })
            : originalStop.call(this, settings);
        });
      const launcher = new HopperApplicationLauncher(
        options(process.execPath),
        {
          platform: "win32",
          verifyLinuxLauncher: async () =>
            ok({
              sha256: verifiedSha256,
              version: "fixture",
              primaryFingerprint: "0".repeat(40),
              signingFingerprint: "1".repeat(40),
              source: "signed_package_cache",
            }),
          selectPrivateDisplay: (settings) =>
            selectLinuxPrivateDisplayStrategy({
              ...settings,
              helperPath: fileURLToPath(
                new URL("../../../fixtures/x11ProbeHang.py", import.meta.url),
              ),
              timeoutMs: 75,
            }),
        },
      );
      try {
        const launched = await launcher.launch({
          directory,
          socketPath: join(directory, "bridge.sock"),
          token: "fixture-token",
          runId: randomUUID(),
        });
        expect(launched.ok).toBe(false);
        if (launched.ok) throw new Error("Expected private-display timeout");
        const original = launched.error;
        expect(projectAnalysisError(original).details).toMatchObject({
          diagnostics: { reason: "probe_timeout" },
        });
        expect(original.cleanupIncomplete).toBe(deniedStops > 0);
        const supervisor = captured.current;
        if (supervisor === undefined)
          throw new Error("Expected the real owned probe");
        if (deniedStops > 0) {
          const child = supervisor.launch.process;
          expect(child.exitCode).toBeNull();
          expect(child.signalCode).toBeNull();
          expect((await launcher.cleanup()).ok).toBe(false);
          expect(original.cleanupIncomplete).toBe(true);
        }
        expect((await launcher.cleanup()).ok).toBe(true);
        expect(original.cleanupIncomplete).toBe(false);
        expect(original.cleanupResources).toEqual([]);
        expect(
          supervisor.launch.process.exitCode !== null ||
            supervisor.launch.process.signalCode !== null,
        ).toBe(true);
        expect(attempts).toBe(deniedStops + 1);
      } finally {
        stop.mockRestore();
        if (captured.current !== undefined)
          await originalStop.call(captured.current);
        await launcher.cleanup();
      }
    },
  );

it("resolves mixed image and publisher cleanup only after each owner releases", async () => {
  const directory = await createTestTempDirectory("rea-hopper-mixed-cleanup-");
  const targetPath = join(directory, "target.macho");
  const source = Buffer.alloc(64);
  source.writeUInt32BE(0xfeedfacf, 0);
  source.writeUInt32BE(0x0100000c, 4);
  source.writeUInt32BE(0x80000002, 8);
  await writeFile(targetPath, source);

  let allowImageClose = false;
  let imageCloseAttempts = 0;
  const imageFileSystem = {
    async open(
      path: Parameters<typeof open>[0],
      flags: Parameters<typeof open>[1],
      mode?: Parameters<typeof open>[2],
    ) {
      const handle = await open(path, flags, mode);
      if (String(path) === targetPath && flags === "r") {
        const close = handle.close.bind(handle);
        handle.close = async () => {
          imageCloseAttempts += 1;
          if (!allowImageClose)
            throw new Error("Fixture image source close unavailable");
          await close();
        };
      }
      return handle;
    },
  };

  let allowPublisherClose = false;
  let publisherCloseAttempts = 0;
  const publisherOwner = {
    async close() {
      publisherCloseAttempts += 1;
      if (!allowPublisherClose)
        throw new Error("Fixture publisher close unavailable");
    },
  };
  const publisherLease = AnalysisCleanupLease.forCloseOwner(
    publisherOwner,
    "hopper-publisher-verification",
  );
  const retryPublisherCleanup = async () => {
    try {
      await publisherLease.release();
    } catch (cause: unknown) {
      const failure = new ArtifactReaderFailure(
        "unavailable",
        "Publisher verification cleanup remains incomplete",
        {
          cause,
          cleanup: {
            reason: cause instanceof Error ? cause.message : String(cause),
            resources: ["hopper-publisher-verification"],
          },
          cleanupLeases: [publisherLease],
        },
      );
      throw failure;
    }
  };
  const launcher = new HopperApplicationLauncher(
    {
      ...options("/missing/hopper"),
      targetPath,
      preparedImage: {
        image: {
          method: "thin_verified_copy",
          byte_length: source.length,
          cpu_type: 0x0100000c,
          cpu_subtype: 0x80000002,
        },
        sourceSha256: createHash("sha256").update(source).digest("hex"),
      },
    },
    {
      platform: "win32",
      imageFileSystem,
      retryPublisherCleanup,
    },
  );
  const session = {
    directory,
    socketPath: join(directory, "bridge.sock"),
    token: "fixture-token",
    runId: "fixture-run",
  };

  try {
    const launched = await launcher.launch(session);
    expect(launched).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });

    const first = await launcher.cleanup();
    expect(first).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });
    if (first.ok) throw new Error("Expected mixed cleanup to remain pending");
    const originalAggregate = first.error;
    expect(originalAggregate.cleanupResources).toEqual(
      expect.arrayContaining([
        expect.stringContaining("hopper-image-source:"),
        "hopper-publisher-verification",
      ]),
    );

    allowImageClose = true;
    const publisherOnly = await launcher.cleanup();
    expect(publisherOnly).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });
    expect(originalAggregate.cleanupIncomplete).toBe(true);
    const closedImageAttempts = imageCloseAttempts;
    expect(closedImageAttempts).toBeGreaterThan(1);

    allowPublisherClose = true;
    expect(await launcher.cleanup()).toEqual({ ok: true, value: null });
    expect(originalAggregate.cleanupIncomplete).toBe(false);
    expect(imageCloseAttempts).toBe(closedImageAttempts);
    expect(publisherCloseAttempts).toBe(3);
  } finally {
    allowImageClose = true;
    allowPublisherClose = true;
    await launcher.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("retains cancelled verification cleanup through client shutdown and retries it", async () => {
  const directory = await createTestTempDirectory("rea-publisher-cancel-");
  const targetPath = join(directory, "target");
  await writeFile(targetPath, "source-owned target");
  const root = await PrivateRuntimeRoot.create({
    prefix: "rea-publisher-pending-",
  });
  const resources = new ArtifactResourceScope();
  let allowCleanup = false;
  expect(
    await resources.release({
      kind: "private-runtime-root",
      resource: root.path,
      root: {
        path: root.path,
        close: async () => {
          if (!allowCleanup)
            throw new Error("Fixture publisher cleanup denied");
          await root.close();
        },
      },
    }),
  ).toMatchObject({ kind: "failed" });
  const controller = new AbortController();
  const verify = vi.fn(async () => {
    controller.abort();
    return err(
      new HopperReleaseError(
        "cleanup_failed",
        "Publisher cleanup remains owned",
      ),
    );
  });
  const launcher = new HopperApplicationLauncher(
    {
      ...options(process.execPath),
      targetPath,
    },
    {
      verifyLinuxLauncher: verify,
      retryPublisherCleanup: () => resources.close(),
      selectPrivateDisplay: readyDirectDisplay,
    },
  );
  const client = new HopperClient({ launcher, startupTimeoutMs: 5_000 });
  try {
    const started = await client.start(controller.signal);
    expect(started).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true, cleanupResources: [root.path] },
    });
    if (started.ok)
      throw new Error("Expected cancelled startup with pending cleanup");
    expect(projectAnalysisError(started.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        diagnostics: { primary_error: { code: "cancelled" } },
        resources: [root.path],
      },
    });
    expect(await client.start()).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });
    expect(verify).toHaveBeenCalledOnce();
    expect(await client.close()).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });
    await access(root.path);
    allowCleanup = true;
    expect(await client.close()).toEqual({ ok: true, value: null });
    await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    allowCleanup = true;
    await client.close();
    await resources.close();
  }
});

describe("Hopper bridge launcher selection", () => {
  it.each([
    "/opt/hopper/bin/Hopper",
    "/usr/local/bin/hopper",
    "/workspace/bin/hopper-wrapper",
  ])(
    "routes launcher spelling %s through the explicitly selected demo adapter",
    (path) => {
      expect(usesLinuxDemo(options(path))).toBe(true);
    },
  );

  it("does not infer demo behavior from a native launcher's basename", () => {
    expect(
      usesLinuxDemo({
        environment: {},
        launcherPath: "/opt/hopper/bin/Hopper",
        targetPath: "/target",
        targetKind: "executable",
        loaderArgs: [],
        bridgeScriptPath: "/rea/hopper_bridge.py",
        launchMode: "native",
      }),
    ).toBe(false);
  });

  it("builds the namespace launch without sudo or a shell command", () => {
    const launch = linuxDemoLaunch(
      options("/opt/hopper/bin/Hopper"),
      {
        directory: "/tmp/rea-fixture",
        socketPath: "/tmp/rea-fixture/bridge.sock",
        token: "not-forwarded",
        runId: "fixture-run",
      },
      ["--analysis"],
      "user-mount-namespace",
      verifiedSha256,
    );

    expect(launch).toMatchObject({
      command: "/usr/bin/unshare",
      ownershipCommand: "/usr/bin/python3",
      args: [
        "--user",
        "--map-root-user",
        "--mount",
        "--propagation",
        "private",
        "/usr/bin/python3",
        "/rea/hopper-demo-x11.py",
        "--owner-stdin",
        "--strategy",
        "user-mount-namespace",
        "--mount-private-x11",
        "--hopper",
        "/opt/hopper/bin/Hopper",
        "--expected-launcher-sha256",
        verifiedSha256,
        "--socket",
        "/tmp/rea-fixture/bridge.sock",
        "--",
        "/opt/hopper/bin/Hopper",
        "--analysis",
      ],
    });
    expect(launch?.args).not.toContain("sudo");
    expect(launch?.args).not.toContain("-c");
  });

  it("keeps an ordinary Linux launch on the direct Python adapter", () => {
    expect(
      linuxDemoLaunch(
        options("/opt/hopper/bin/Hopper"),
        {
          directory: "/tmp/rea-fixture",
          socketPath: "/tmp/rea-fixture/bridge.sock",
          token: "not-forwarded",
          runId: "fixture-run",
        },
        [],
        "direct",
        verifiedSha256,
      ),
    ).toMatchObject({
      command: "/usr/bin/python3",
      args: [
        "/rea/hopper-demo-x11.py",
        "--owner-stdin",
        "--strategy",
        "direct",
        "--hopper",
        "/opt/hopper/bin/Hopper",
        "--expected-launcher-sha256",
        verifiedSha256,
        "--socket",
        "/tmp/rea-fixture/bridge.sock",
        "--",
        "/opt/hopper/bin/Hopper",
      ],
    });
  });

  it("rejects launcher bytes changed since publisher verification before executing them", async () => {
    const directory = await createTestTempDirectory("rea-hopper-wrapper-");
    const wrapper = join(directory, "hopper-wrapper");
    const marker = join(directory, "executed");
    try {
      await writeFile(wrapper, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`);
      await chmod(wrapper, 0o700);
      await expect(
        execFileAsync(
          "python3",
          [
            demoHelperPath,
            "--hopper",
            wrapper,
            "--expected-launcher-sha256",
            verifiedSha256,
            "--socket",
            join(directory, "bridge.sock"),
            "--",
            wrapper,
          ],
          { timeout: 3_000 },
        ),
      ).rejects.toMatchObject({
        code: 72,
        stderr: expect.stringContaining(
          '"failure_code":"unsupported_hopper_build"',
        ),
      });
      await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it("launches Hopper helpers with the caller-selected environment without restoring ambient values", async () => {
  const directory = await createTestTempDirectory("rea-hopper-selected-env-");
  const targetPath = join(directory, "target");
  await writeFile(targetPath, "fixture target");
  const launcher = new HopperApplicationLauncher({
    environment: { REA_SELECTED_VALUE: "caller-value" },
    launcherPath: process.execPath,
    targetPath,
    targetKind: "executable",
    loaderArgs: [
      "-e",
      "process.stdout.write(JSON.stringify({ selected: process.env.REA_SELECTED_VALUE ?? null, home: process.env.HOME ?? null }))",
      "--",
    ],
    bridgeScriptPath: "/rea/unused-bridge.py",
    launchMode: "native",
  });
  const launched = await launcher.launch({
    directory,
    socketPath: join(directory, "bridge.sock"),
    token: "fixture-token",
    runId: randomUUID(),
  });
  if (!launched.ok) throw launched.error;
  const supervisor = new ProviderProcessSupervisor(launched.value);
  try {
    expect(await supervisor.waitForOutputClose(5_000)).toBe(true);
    expect(JSON.parse(supervisor.snapshot().stdout.text)).toEqual({
      selected: "caller-value",
      home: null,
    });
    expect(await supervisor.stop()).toMatchObject({
      status: "verified-cleanup",
    });
  } finally {
    await supervisor.stop();
    await launched.value.releaseLease?.();
  }
});

it.skipIf(process.platform !== "linux")(
  "gives the demo helper a live owner stream through Node's actual stdio transport",
  async () => {
    const directory = await createTestTempDirectory("rea-hopper-owner-stdio-");
    const selectPrivateDisplay = vi.fn(readyDirectDisplay);
    const launcher = new HopperApplicationLauncher(
      {
        ...options(process.execPath),
        launchMode: "verified_linux_demo",
        demoHelperPath: fileURLToPath(
          new URL("../../../fixtures/hopperLifetimeLaunch.py", import.meta.url),
        ),
      },
      {
        verifyLinuxLauncher: async () =>
          ok({
            sha256: verifiedSha256,
            version: "fixture",
            primaryFingerprint: "0".repeat(40),
            signingFingerprint: "1".repeat(40),
            source: "signed_package_cache",
          }),
        selectPrivateDisplay,
      },
    );
    const launched = await launcher.launch({
      directory,
      socketPath: join(directory, "bridge.sock"),
      token: "fixture-token",
      runId: randomUUID(),
    });
    if (!launched.ok) throw launched.error;
    expect(selectPrivateDisplay).toHaveBeenCalledOnce();
    const supervisor = new ProviderProcessSupervisor(launched.value);
    try {
      expect(await supervisor.waitForOutputClose(5_000)).toBe(true);
      expect(supervisor.snapshot().exitCode).toBe(0);
      expect(JSON.parse(supervisor.snapshot().stdout.text)).toEqual({
        owner_alive: true,
      });
    } finally {
      await supervisor.stop();
      await launched.value.releaseLease?.();
    }
  },
);

it.skipIf(process.platform !== "linux")(
  "preserves a publisher rejection through the public error without inventing a helper exit",
  async () => {
    const directory = await createTestTempDirectory("rea-publisher-rejection-");
    const targetPath = join(directory, "target");
    await writeFile(targetPath, "fixture target");
    const rejected = new HopperReleaseError(
      "unsupported_hopper_build",
      "Fixture launcher is outside verified releases",
    );
    const selectPrivateDisplay = vi.fn(readyDirectDisplay);
    const launcher = new HopperApplicationLauncher(
      { ...options("/unused/Hopper"), targetPath },
      {
        selectPrivateDisplay,
        verifyLinuxLauncher: async () => err(rejected),
      },
    );
    const result = await launcher.launch({
      directory,
      socketPath: join(directory, "bridge.sock"),
      token: "fixture-token",
      runId: randomUUID(),
    });
    if (result.ok) throw new Error("Unverified launcher started");
    const projected = projectAnalysisError(result.error);
    expect(projected).toMatchObject({
      code: "provider_unavailable",
      details: {
        stage: "launch",
        launch_rejection: {
          boundary: "publisher_verification",
          reason: rejected.reason,
        },
      },
    });
    expect(projected.details).not.toHaveProperty("exit_code");
    expect(projected.details).not.toHaveProperty("launcher");
    expect(selectPrivateDisplay).not.toHaveBeenCalled();
  },
);

it.skipIf(process.platform !== "linux")(
  "asks the demo helper to shut down orderly so its X lock is removed",
  async () => {
    const directory = await createTestTempDirectory("rea-hopper-orderly-");
    const lockPath = join(directory, ".X199-lock");
    const markerPath = join(directory, "orderly-shutdown");
    const launcher = new HopperApplicationLauncher(
      {
        ...options(process.execPath),
        launchMode: "verified_linux_demo",
        environment: { REA_FIXTURE_LOCK_DIR: directory },
        demoHelperPath: fileURLToPath(
          new URL(
            "../../../fixtures/hopperOrderlyShutdown.py",
            import.meta.url,
          ),
        ),
      },
      {
        verifyLinuxLauncher: async () =>
          ok({
            sha256: verifiedSha256,
            version: "fixture",
            primaryFingerprint: "0".repeat(40),
            signingFingerprint: "1".repeat(40),
            source: "signed_package_cache",
          }),
        selectPrivateDisplay: readyDirectDisplay,
      },
    );
    const launched = await launcher.launch({
      directory,
      socketPath: join(directory, "bridge.sock"),
      token: "fixture-token",
      runId: randomUUID(),
    });
    if (!launched.ok) throw launched.error;
    const supervisor = new ProviderProcessSupervisor(launched.value);
    try {
      const deadline = Date.now() + 5_000;
      for (;;) {
        try {
          await access(lockPath);
          break;
        } catch {
          if (Date.now() >= deadline)
            throw new Error("lock file never appeared");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      expect(await supervisor.stop()).toMatchObject({
        status: "verified-cleanup",
      });
      // The helper shut down orderly: it removed its own lock before exiting.
      await expect(access(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(markerPath)).resolves.toBeUndefined();
    } finally {
      await supervisor.stop();
      await launched.value.releaseLease?.();
    }
  },
);

it.skipIf(process.platform !== "linux")(
  "still cleans up when the demo helper ignores the orderly shutdown request",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-hopper-orderly-ignored-",
    );
    const lockPath = join(directory, ".X199-lock");
    const launcher = new HopperApplicationLauncher(
      {
        ...options(process.execPath),
        launchMode: "verified_linux_demo",
        environment: {
          REA_FIXTURE_LOCK_DIR: directory,
          REA_FIXTURE_IGNORE_SHUTDOWN: "1",
        },
        demoHelperPath: fileURLToPath(
          new URL(
            "../../../fixtures/hopperOrderlyShutdown.py",
            import.meta.url,
          ),
        ),
      },
      {
        verifyLinuxLauncher: async () =>
          ok({
            sha256: verifiedSha256,
            version: "fixture",
            primaryFingerprint: "0".repeat(40),
            signingFingerprint: "1".repeat(40),
            source: "signed_package_cache",
          }),
        selectPrivateDisplay: readyDirectDisplay,
        demoOrderlyShutdownGraceMs: 500,
      },
    );
    const launched = await launcher.launch({
      directory,
      socketPath: join(directory, "bridge.sock"),
      token: "fixture-token",
      runId: randomUUID(),
    });
    if (!launched.ok) throw launched.error;
    const supervisor = new ProviderProcessSupervisor(launched.value);
    try {
      // The fixture really started: its lock is on disk before we ask it to
      // shut down, so an early fixture failure cannot fake a passing test.
      const deadline = Date.now() + 5_000;
      for (;;) {
        try {
          await access(lockPath);
          break;
        } catch {
          if (Date.now() >= deadline)
            throw new Error("lock file never appeared");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      const started = Date.now();
      expect(await supervisor.stop()).toMatchObject({
        status: "verified-cleanup",
      });
      // Bounded by the configured 500 ms grace, not a hardcoded 10 s wait:
      // the group kill must follow the ignored shutdown request promptly.
      expect(Date.now() - started).toBeLessThan(5_000);
      // The fallback path ran: the helper was reaped by the group SIGKILL,
      // and its lock survives because the orderly path never ran.
      expect(launched.value.process.signalCode).toBe("SIGKILL");
      await expect(access(lockPath)).resolves.toBeUndefined();
    } finally {
      await supervisor.stop();
      await launched.value.releaseLease?.();
    }
  },
);

it.skipIf(process.platform !== "linux")(
  "does not wait out the orderly grace when the demo helper already died from a signal",
  async () => {
    const directory = await createTestTempDirectory("rea-hopper-signal-dead-");
    const lockPath = join(directory, ".X199-lock");
    const launcher = new HopperApplicationLauncher(
      {
        ...options(process.execPath),
        launchMode: "verified_linux_demo",
        environment: {
          REA_FIXTURE_LOCK_DIR: directory,
          REA_FIXTURE_SIGNAL_DEATH: "1",
        },
        demoHelperPath: fileURLToPath(
          new URL(
            "../../../fixtures/hopperOrderlyShutdown.py",
            import.meta.url,
          ),
        ),
      },
      {
        verifyLinuxLauncher: async () =>
          ok({
            sha256: verifiedSha256,
            version: "fixture",
            primaryFingerprint: "0".repeat(40),
            signingFingerprint: "1".repeat(40),
            source: "signed_package_cache",
          }),
        selectPrivateDisplay: readyDirectDisplay,
      },
    );
    const launched = await launcher.launch({
      directory,
      socketPath: join(directory, "bridge.sock"),
      token: "fixture-token",
      runId: randomUUID(),
    });
    if (!launched.ok) throw launched.error;
    const supervisor = new ProviderProcessSupervisor(launched.value);
    try {
      // The fixture wrote its lock, then killed itself with SIGKILL before
      // the launcher asked for cleanup.
      const lockDeadline = Date.now() + 5_000;
      for (;;) {
        try {
          await access(lockPath);
          break;
        } catch {
          if (Date.now() >= lockDeadline)
            throw new Error("lock file never appeared");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      const exitDeadline = Date.now() + 5_000;
      for (;;) {
        if (launched.value.process.signalCode !== null) break;
        if (Date.now() >= exitDeadline)
          throw new Error("signal exit never observed");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const started = Date.now();
      expect(await supervisor.stop()).toMatchObject({
        status: "verified-cleanup",
      });
      // No grace wait: the helper was already gone, so cleanup must not sit
      // out the 10 s orderly shutdown window.
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(launched.value.process.signalCode).toBe("SIGKILL");
    } finally {
      await supervisor.stop();
      await launched.value.releaseLease?.();
    }
  },
);

it("ordinary executable launches pass a verified private image with configured loader arguments", async () => {
  const directory = await createTestTempDirectory("rea-hopper-ordinary-image-");
  const targetPath = join(directory, "target.exe");
  const selected = Buffer.from("MZ selected image");
  await writeFile(targetPath, selected);
  const launcher = new HopperApplicationLauncher({
    environment: {},
    launcherPath: process.execPath,
    targetPath,
    targetKind: "executable",
    targetSha256: createHash("sha256").update(selected).digest("hex"),
    loaderArgs: ["-e", "process.stdout.write(process.argv.at(-1))", "--"],
    bridgeScriptPath: "/rea/unused-bridge.py",
    launchMode: "native",
  });
  const launched = await launcher.launch({
    directory,
    socketPath: join(directory, "bridge.sock"),
    token: "fixture-token",
    runId: randomUUID(),
  });
  if (!launched.ok) throw launched.error;
  const supervisor = new ProviderProcessSupervisor(launched.value);
  try {
    expect(await supervisor.waitForOutputClose(5_000)).toBe(true);
    const preparedPath = join(directory, "image.executable");
    expect(supervisor.snapshot().stdout.text).toBe(preparedPath);
    expect(launched.value.preparedImagePath).toBe(preparedPath);
    await writeFile(targetPath, "replacement bytes");
    expect(Buffer.compare(await readFile(preparedPath), selected)).toBe(0);
  } finally {
    await supervisor.stop();
    await launched.value.releaseLease?.();
    expect(await launcher.cleanup()).toEqual({ ok: true, value: null });
  }
});
