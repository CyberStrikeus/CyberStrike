import { describe, expect, it } from "vitest";

import { HopperApplicationLauncher } from "../../../../src/hopper/BridgeLauncher.js";
import { HopperStartError } from "../../../../src/domain/hopperErrors.js";

describe("Linux Hopper application leases in the launcher", () => {
  it.each(["/first-target", "/different-target"])(
    "rejects Linux demo launch for %s before it can forward a document to another owner",
    async (targetPath) => {
      let probedDisplay = false;
      const launcher = new HopperApplicationLauncher(
        {
          environment: {},
          launcherPath: "/unused/Hopper",
          targetPath,
          targetKind: "executable",
          loaderArgs: [],
          bridgeScriptPath: "/rea/hopper_bridge.py",
          launchMode: "verified_linux_demo",
          demoHelperPath: "/rea/hopper-demo-x11.py",
        },
        {
          platform: "linux",
          acquireApplicationLease: async () => ({
            acquired: false,
            owner: { runId: "owning-session", processId: 17 },
          }),
          selectPrivateDisplay: async () => {
            probedDisplay = true;
            throw new Error("Launch must stop before probing the display");
          },
        },
      );
      expect(
        await launcher.launch({
          directory: "/missing/rea-launch",
          socketPath: "/missing/rea-launch/bridge.sock",
          token: "token",
          runId: "new-session",
        }),
      ).toMatchObject({
        ok: false,
        error: {
          _tag: "HopperStartError",
          ownerRunId: "owning-session",
          userMessage: expect.stringContaining(targetPath),
        },
      });
      expect(probedDisplay).toBe(false);
    },
  );

  it("preserves the reason that an existing lease could not be verified", async () => {
    const failure = new HopperStartError({
      userMessage: "Existing owner timed out; the lease was left unchanged",
    });
    const launcher = new HopperApplicationLauncher(
      {
        environment: {},
        launcherPath: "/unused/Hopper",
        targetPath: "/target",
        targetKind: "executable",
        loaderArgs: [],
        bridgeScriptPath: "/rea/hopper_bridge.py",
        launchMode: "verified_linux_demo",
        demoHelperPath: "/rea/helper.py",
      },
      {
        platform: "linux",
        acquireApplicationLease: async () => {
          throw failure;
        },
      },
    );
    expect(
      await launcher.launch({
        directory: "/missing/rea-launch",
        socketPath: "/missing/rea-launch/bridge.sock",
        token: "token",
        runId: "new-session",
      }),
    ).toEqual({ ok: false, error: failure });
  });
});

describe("Hopper launch leases", () => {
  it("reports an active target owner without launching another document", async () => {
    let leaseChecks = 0;
    const launcher = new HopperApplicationLauncher(
      {
        environment: {},
        launcherPath:
          "/Applications/Hopper Disassembler.app/Contents/MacOS/hopper",
        targetPath: "/target",
        targetKind: "executable",
        loaderArgs: [],
        bridgeScriptPath: "/rea/hopper_bridge.py",
        launchMode: "native",
      },
      {
        platform: "darwin",
        acquireTargetLease: async () => {
          leaseChecks += 1;
          return {
            acquired: false,
            owner: { runId: "owning-session", processId: 17 },
          };
        },
      },
    );

    const result = await launcher.launch({
      directory: "/tmp/rea-launch-test",
      socketPath: "/tmp/rea-launch-test/bridge.sock",
      token: "token",
      runId: "new-session",
    });

    expect(leaseChecks).toBe(1);
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "HopperStartError",
        ownerRunId: "owning-session",
        userMessage: expect.stringContaining("owning-session"),
      },
    });
  });

  it.each(["darwin", "linux"] as const)(
    "releases the %s launch lease when bridge setup fails",
    async (platform) => {
      let releases = 0;
      const launcher = new HopperApplicationLauncher(
        {
          environment: {},
          launcherPath: "/unused/hopper",
          targetPath: "/target",
          targetKind: "executable",
          loaderArgs: [],
          bridgeScriptPath: "/rea/hopper_bridge.py",
          ...(platform === "linux"
            ? {
                launchMode: "verified_linux_demo" as const,
                demoHelperPath: "/unused/helper.py",
              }
            : { launchMode: "native" as const }),
        },
        {
          platform,
          acquireTargetLease: async () => ({
            acquired: true,
            lease: { release: async () => void (releases += 1) },
          }),
          acquireApplicationLease: async () => ({
            acquired: true,
            lease: { release: async () => void (releases += 1) },
          }),
        },
      );

      const result = await launcher.launch({
        directory: "/missing/rea-launch-test",
        socketPath: "/missing/rea-launch-test/bridge.sock",
        token: "token",
        runId: "failed-session",
      });

      expect(result.ok).toBe(false);
      expect(releases).toBe(1);
    },
  );
});
