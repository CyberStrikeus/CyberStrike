import { lstat } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, onTestFinished, vi } from "vitest";

import { HopperCancelledError } from "../../../../src/domain/hopperErrors.js";
import { HopperApplicationLauncher } from "../../../../src/hopper/BridgeLauncher.js";
import { HopperClient } from "../../../../src/hopper/HopperClient.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

const removal = vi.hoisted(() => ({
  root: undefined as string | undefined,
  failBootstrapWrite: false,
  rootFailures: 0,
  bootstrapAttempts: 0,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    chmod: async (...args: Parameters<typeof actual.chmod>) => {
      if (
        removal.failBootstrapWrite &&
        args[0] === join(removal.root ?? "", "bootstrap.py")
      )
        throw new Error("injected bootstrap permission failure");
      return actual.chmod(...args);
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (removal.root !== undefined) {
        if (args[0] === join(removal.root, "bootstrap.py")) {
          removal.bootstrapAttempts++;
          throw new Error("injected bootstrap removal failure");
        }
        if (args[0] === removal.root && removal.rootFailures > 0) {
          removal.rootFailures--;
          throw new Error("injected runtime removal failure");
        }
      }
      return actual.rm(...args);
    },
  };
});

it.each(["bootstrap", "launch"] as const)(
  "retries authoritative runtime cleanup after %s failure leaves its bootstrap behind",
  async (stage) => {
    removal.failBootstrapWrite = stage === "bootstrap";
    removal.rootFailures = 1;
    removal.bootstrapAttempts = 0;
    const application = new HopperApplicationLauncher(
      {
        environment: {},
        launcherPath: "/nonexistent-rea-bootstrap-fixture/hopper",
        targetPath: "/fixture-target",
        targetKind: "database",
        loaderArgs: [],
        bridgeScriptPath: "/fixture-bridge.py",
        launchMode: "native",
      },
      { platform: "win32" },
    );
    const client = new HopperClient({
      startupTimeoutMs: 5_000,
      launcher: {
        launch: (session, options) => {
          removal.root = session.directory;
          return application.launch(session, options);
        },
        cleanup: () => application.cleanup(),
      },
    });
    onTestFinished(async () => {
      removal.rootFailures = 0;
      await client.close();
      removal.root = undefined;
      removal.failBootstrapWrite = false;
    });
    const started = await client.start();
    expect(started.ok).toBe(false);
    if (started.ok) throw new Error("Expected failed fixture launch");
    expect(removal.bootstrapAttempts).toBe(1);
    expect(started.error.cleanupIncomplete).toBe(true);
    const root = removal.root;
    if (root === undefined) throw new Error("Fixture session was not created");
    expect(started.error.cleanupResources).toContain(root);
    expect((await lstat(join(root, "bootstrap.py"))).isFile()).toBe(true);
    expect((await client.close()).ok).toBe(true);
    await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each(["failed", "cancelled"] as const)(
  "removes the token-bearing bootstrap and releases the lease after a %s launch",
  async (outcome) => {
    const directory = await createTestTempDirectory("rea-bootstrap-cleanup-");
    const controller = new AbortController();
    const reason = { source: "caller", opaque: 7 };
    if (outcome === "cancelled") controller.abort(reason);
    let releases = 0;
    const launcher = new HopperApplicationLauncher(
      {
        environment: {},
        launcherPath: join(directory, "nonexistent-hopper"),
        targetPath: join(directory, "test-binary"),
        targetKind: "executable",
        loaderArgs: [],
        bridgeScriptPath: join(directory, "bridge.py"),
        launchMode: "native",
      },
      {
        platform: "darwin",
        acquireTargetLease: async () => ({
          acquired: true,
          lease: {
            release: async () => {
              releases++;
            },
          },
        }),
      },
    );
    const result = await launcher.launch(
      {
        directory,
        socketPath: join(directory, "bridge.sock"),
        token: "fixture-token",
        runId: "bootstrap-cleanup",
      },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (outcome === "cancelled") {
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected cancellation");
      expect(result.error).toBeInstanceOf(HopperCancelledError);
      expect(result.error.cause).toBe(reason);
    }
    await expect(lstat(join(directory, "bootstrap.py"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(releases).toBe(1);
  },
);
