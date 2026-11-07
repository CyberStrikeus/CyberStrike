import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createConnection, Server } from "node:net";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { HopperStartError } from "../domain/hopperErrors.js";
const createTestTempDirectory = async (prefix: string): Promise<string> => {
  const directory = await mkdtemp(join("/tmp", prefix));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

const injection = vi.hoisted(() => ({
  directory: undefined as string | undefined,
  admission: "accepted" as "accepted" | "not_private" | "access_denied",
  invalidateOnClose: false,
  closeCalls: 0,
  recoveryRemoveFailures: 0,
  staleRemoveFailure: false,
  socketPermissionsFailure: false,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    chmod: async (...args: Parameters<typeof actual.chmod>) => {
      if (injection.socketPermissionsFailure)
        throw new Error("injected socket permission failure");
      return actual.chmod(...args);
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (injection.staleRemoveFailure && String(args[0]).endsWith(".sock"))
        throw new Error("injected stale socket removal failure");
      return actual.rm(...args);
    },
    rmdir: async (...args: Parameters<typeof actual.rmdir>) => {
      if (injection.recoveryRemoveFailures > 0) {
        injection.recoveryRemoveFailures -= 1;
        throw new Error("injected recovery removal failure");
      }
      return actual.rmdir(...args);
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (args[0] !== injection.directory) return handle;
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        injection.closeCalls += 1;
        if (injection.closeCalls === 1) {
          if (injection.invalidateOnClose) await close();
          throw new Error("injected directory close failure");
        }
        await close();
      });
      if (injection.admission !== "accepted") {
        const stat = handle.stat.bind(handle);
        vi.spyOn(handle, "stat").mockImplementation(async () => {
          if (injection.admission === "access_denied")
            throw Object.assign(new Error("denied"), { code: "EACCES" });
          const observed = await stat();
          observed.isDirectory = () => false;
          return observed;
        });
      }
      return handle;
    },
  };
});

const { acquireLinuxHopperApplicationLease } = await import("./HopperLease.js");
const { acquireOwnedLease } = await import("./OwnedLease.js");
const { HopperApplicationLauncher } =
  await import("../hopper/BridgeLauncher.js");

afterEach(() => {
  injection.directory = undefined;
  injection.admission = "accepted";
  injection.invalidateOnClose = false;
  injection.closeCalls = 0;
  injection.recoveryRemoveFailures = 0;
  injection.staleRemoveFailure = false;
  injection.socketPermissionsFailure = false;
  vi.restoreAllMocks();
});

describe.skipIf(process.platform === "win32")(
  "accepted lease connections",
  () => {
    it.each([false, true])(
      "closes a held peer and preserves retry after failure=%s",
      async (failClose) => {
        const directory = await createTestTempDirectory("rea-peer-");
        const input = {
          identity: { test: "held-peer" },
          directory,
          runId: "held-peer",
          failure: (failure: { kind: string }) => new Error(failure.kind),
        };
        const acquired = await acquireOwnedLease(input);
        if (!acquired.acquired) throw new Error("expected acquired lease");
        onTestFinished(() => acquired.lease.release());
        const contender = await acquireOwnedLease({
          ...input,
          runId: "contender",
        });
        expect(contender).toEqual({
          acquired: false,
          owner: { runId: input.runId, processId: process.pid },
        });
        const peer = createConnection({
          path: acquired.lease.socketPath!,
          allowHalfOpen: true,
        });
        onTestFinished(() => {
          peer.destroy();
        });
        peer.resume();
        await new Promise<void>((resolve, reject) => {
          peer.once("end", resolve);
          peer.once("error", reject);
        });
        expect(peer.writable).toBe(true);
        if (failClose) {
          const close = Server.prototype.close;
          vi.spyOn(Server.prototype, "close")
            .mockImplementationOnce(function (this: Server, callback) {
              callback?.(new Error("injected socket close failure"));
              return this;
            })
            .mockImplementation(function (this: Server, callback) {
              return close.call(this, callback);
            });
          await expect(acquired.lease.release()).rejects.toThrow(
            "injected socket close failure",
          );
        }
        // The peer stays open until the owner releases; a test timeout catches the
        // original server.close deadlock without relying on elapsed-time assertions.
        await acquired.lease.release();
        const next = await acquireOwnedLease(input);
        expect(next.acquired).toBe(true);
        if (next.acquired) await next.lease.release();
      },
    );
  },
);

describe.skipIf(process.platform === "win32")(
  "lease socket recovery finalization",
  () => {
    it("preserves the failed recovery operation when its directory cleanup also fails", async () => {
      const directory = await createTestTempDirectory("rea-recovery-primary-");
      const key = createHash("sha256")
        .update(JSON.stringify({ application: "linux-hopper-demo" }))
        .digest("hex")
        .slice(0, 32);
      const socketPath = join(directory, `${key}.sock`);
      await promisify(execFile)(process.execPath, [
        "--input-type=module",
        "-e",
        'import {createServer} from "node:net"; createServer().listen(process.argv[1],()=>process.exit(0));',
        socketPath,
      ]);
      injection.staleRemoveFailure = true;
      injection.recoveryRemoveFailures = 1;
      const resources = new ArtifactResourceScope();
      const failure = await acquireLinuxHopperApplicationLease({
        directory,
        runId: "recovery-primary",
        resources,
      }).catch((cause: unknown) => cause);
      expect(failure).toBeInstanceOf(HopperStartError);
      if (!(failure instanceof HopperStartError)) return;
      expect(failure.cause).toMatchObject({
        primary: expect.objectContaining({
          message: "injected stale socket removal failure",
        }),
      });
      expect(failure.cleanupIncomplete).toBe(true);
      await resources.retryCleanup();
      expect(resources.hasPending).toBe(false);
      expect(failure.cleanupIncomplete).toBe(false);
    });

    it.each([false, true])(
      "retains a bound socket when permission hardening and final close fail during recovery=%s",
      async (recovering) => {
        const directory = await createTestTempDirectory(
          "rea-socket-permissions-",
        );
        if (recovering) {
          const key = createHash("sha256")
            .update(JSON.stringify({ application: "linux-hopper-demo" }))
            .digest("hex")
            .slice(0, 32);
          await promisify(execFile)(process.execPath, [
            "--input-type=module",
            "-e",
            'import {createServer} from "node:net"; createServer().listen(process.argv[1],()=>process.exit(0));',
            join(directory, `${key}.sock`),
          ]);
          injection.recoveryRemoveFailures = 1;
        }
        const close = Server.prototype.close;
        let closeFailures = 1;
        vi.spyOn(Server.prototype, "close").mockImplementation(function (
          this: Server,
          callback,
        ) {
          if (closeFailures-- > 0) {
            callback?.(new Error("injected socket close failure"));
            return this;
          }
          return close.call(this, callback);
        });
        injection.socketPermissionsFailure = true;
        const resources = new ArtifactResourceScope();
        const failure = await acquireLinuxHopperApplicationLease({
          directory,
          runId: "permissions",
          resources,
        }).catch((cause: unknown) => cause);
        expect(failure).toBeInstanceOf(HopperStartError);
        if (!(failure instanceof HopperStartError)) return;
        let primary = failure;
        while (primary.cleanupPrimary instanceof HopperStartError)
          primary = primary.cleanupPrimary;
        expect(primary.cause).toMatchObject({
          message: "injected socket permission failure",
        });
        expect(failure.userMessage).toContain("socket permissions");
        expect(failure.cleanupIncomplete).toBe(true);
        expect(resources.cleanupResources).toHaveLength(recovering ? 2 : 1);
        await resources.retryCleanup();
        expect(failure.cleanupIncomplete).toBe(false);
        injection.socketPermissionsFailure = false;
        const next = await acquireLinuxHopperApplicationLease({
          directory,
          runId: "next",
          resources,
        });
        expect(next.acquired).toBe(true);
        if (next.acquired) await next.lease.release();
      },
    );
  },
);

describe.skipIf(process.platform === "win32")(
  "lease recovery cleanup retries",
  () => {
    it.each(["socket", "directory"] as const)(
      "retains both failed recovery owners while %s needs another retry",
      async (remaining) => {
        const directory = await createTestTempDirectory("rea-recovery-close-");
        const key = createHash("sha256")
          .update(JSON.stringify({ application: "linux-hopper-demo" }))
          .digest("hex")
          .slice(0, 32);
        const socketPath = join(directory, `${key}.sock`);
        await promisify(execFile)(process.execPath, [
          "--input-type=module",
          "-e",
          'import {createServer} from "node:net"; createServer().listen(process.argv[1],()=>process.exit(0));',
          socketPath,
        ]);
        const close = Server.prototype.close;
        let closeFailures = remaining === "socket" ? 2 : 1;
        vi.spyOn(Server.prototype, "close").mockImplementation(function (
          this: Server,
          callback,
        ) {
          if (closeFailures > 0) {
            closeFailures -= 1;
            callback?.(new Error("injected socket close failure"));
            return this;
          }
          return close.call(this, callback);
        });
        injection.recoveryRemoveFailures = remaining === "directory" ? 2 : 1;
        const resources = new ArtifactResourceScope();
        const failure = await acquireLinuxHopperApplicationLease({
          directory,
          runId: "recovery",
          resources,
        }).catch((cause: unknown) => cause);
        expect(failure).toBeInstanceOf(HopperStartError);
        if (!(failure instanceof HopperStartError)) return;
        expect(failure.cleanupIncomplete).toBe(true);
        expect(failure.cleanupResources).toEqual(
          expect.arrayContaining([socketPath, `${socketPath}.recovery`]),
        );
        expect(resources.cleanupResources).toHaveLength(2);
        await expect(resources.retryCleanup()).rejects.toThrow();
        const remainingPath =
          remaining === "socket" ? socketPath : `${socketPath}.recovery`;
        expect(resources.cleanupResources).toEqual([remainingPath]);
        expect(failure.cleanupResources).toEqual([remainingPath]);
        expect(failure.cleanupIncomplete).toBe(true);
        await resources.retryCleanup();
        expect(resources.hasPending).toBe(false);
        expect(failure.cleanupIncomplete).toBe(false);
        const next = await acquireLinuxHopperApplicationLease({
          directory,
          runId: "next",
          resources,
        });
        expect(next.acquired).toBe(true);
        if (next.acquired) await next.lease.release();
      },
    );
  },
);

describe.skipIf(process.platform === "win32")(
  "lease directory finalization",
  () => {
    it.each(["accepted", "not_private", "access_denied"] as const)(
      "retains failed directory close after admission failure=%s",
      async (admission) => {
        const root = await createTestTempDirectory("rea-lease-close-");
        injection.directory = join(root, "leases");
        injection.admission = admission;
        const resources = new ArtifactResourceScope();
        const failure = await acquireLinuxHopperApplicationLease({
          runId: "directory-close-test",
          directory: injection.directory,
          resources,
        }).catch((cause: unknown) => cause);
        expect(failure).toBeInstanceOf(HopperStartError);
        if (!(failure instanceof HopperStartError)) return;
        expect(failure.cleanupIncomplete).toBe(true);
        expect(resources.cleanupResources).toEqual([injection.directory]);
        expect(failure.cleanupResources).toEqual([injection.directory]);
        if (admission !== "accepted") {
          expect(failure.userMessage).toContain(
            admission === "not_private"
              ? "not a private directory"
              : "could not access",
          );
          expect(failure.cleanupPrimary).toBeInstanceOf(HopperStartError);
        } else
          expect(failure.userMessage).toContain("could not confirm closure");
        await resources.retryCleanup();
        expect(injection.closeCalls).toBe(2);
        expect(failure.cleanupIncomplete).toBe(false);
        expect(resources.hasPending).toBe(false);
        injection.directory = undefined;
        const retried = await acquireLinuxHopperApplicationLease({
          runId: "directory-close-retry",
          directory: join(root, "leases"),
          resources,
        });
        expect(retried.acquired).toBe(true);
        if (retried.acquired) await retried.lease.release();
      },
    );

    it("retries the directory owner through the actual Hopper launcher cleanup", async () => {
      const root = await createTestTempDirectory("rea-launch-lease-");
      injection.directory = join(root, "leases");
      injection.admission = "not_private";
      const launcher = new HopperApplicationLauncher(
        {
          environment: {},
          launcherPath: join(root, "hopper"),
          targetPath: join(root, "target"),
          targetKind: "database",
          loaderArgs: [],
          bridgeScriptPath: join(root, "bridge.py"),
          launchMode: "verified_linux_demo",
          demoHelperPath: join(root, "helper"),
        },
        {
          platform: "linux",
          acquireApplicationLease: (input) =>
            acquireLinuxHopperApplicationLease({
              ...input,
              directory: join(root, "leases"),
            }),
          retryPublisherCleanup: async () => undefined,
        },
      );
      const launched = await launcher.launch({
        directory: root,
        socketPath: join(root, "bridge.sock"),
        token: "fixture-token",
        runId: "launcher-lease-close-test",
      });
      expect(launched.ok).toBe(false);
      if (launched.ok) return;
      expect(launched.error.userMessage).toContain("not a private directory");
      expect(launched.error.cleanupIncomplete).toBe(true);
      expect(injection.closeCalls).toBe(1);
      expect((await launcher.cleanup()).ok).toBe(true);
      expect(injection.closeCalls).toBe(2);
      expect(launched.error.cleanupIncomplete).toBe(false);
      expect((await launcher.cleanup()).ok).toBe(true);
      expect(injection.closeCalls).toBe(2);
    });

    it("retains uncertainty when Node invalidates the directory handle before rejecting close", async () => {
      const root = await createTestTempDirectory("rea-lease-invalidated-");
      injection.directory = join(root, "leases");
      injection.invalidateOnClose = true;
      const resources = new ArtifactResourceScope();
      const failure = await acquireLinuxHopperApplicationLease({
        runId: "invalidated-close-test",
        directory: injection.directory,
        resources,
      }).catch((cause: unknown) => cause);
      expect(failure).toBeInstanceOf(HopperStartError);
      await expect(resources.retryCleanup()).rejects.toThrow();
      expect(injection.closeCalls).toBe(1);
      expect(resources.hasPending).toBe(true);
      if (failure instanceof HopperStartError)
        expect(failure.cleanupIncomplete).toBe(true);
    });
  },
);

describe.skipIf(process.platform === "win32")(
  "launcher lease release finalization",
  () => {
    it.each(["bootstrap", "cancelled", "nested"] as const)(
      "retains a lease whose release fails after %s startup failure",
      async (stage) => {
        const root = await createTestTempDirectory("rea-launch-release-");
        const release = vi
          .fn()
          .mockRejectedValueOnce(new Error("injected lease release failure"))
          .mockResolvedValue(undefined);
        const socketPath = join(root, "lease.sock");
        const controller = new AbortController();
        const probeRelease = vi
          .fn()
          .mockRejectedValueOnce(new Error("probe cleanup still pending"))
          .mockResolvedValue(undefined);
        const probeLease = new AnalysisCleanupLease(probeRelease, ["probe"]);
        const launcher = new HopperApplicationLauncher(
          {
            environment: {},
            launcherPath: join(root, "hopper"),
            targetPath: join(root, "target"),
            targetKind: "database",
            loaderArgs: [],
            bridgeScriptPath: join(root, "bridge.py"),
            launchMode: "verified_linux_demo",
            demoHelperPath: join(root, "helper"),
          },
          {
            platform: "linux",
            acquireApplicationLease: async () => ({
              acquired: true,
              lease: { socketPath, release },
            }),
            retryPublisherCleanup: async () => undefined,
            verifyLinuxLauncher: async () => ({
              ok: true,
              value: {
                sha256: "0".repeat(64),
                version: "fixture",
                primaryFingerprint: "0".repeat(40),
                signingFingerprint: "1".repeat(40),
                source: "signed_package_cache",
              },
            }),
            selectPrivateDisplay: async () => {
              controller.abort("cancel during probe finalization");
              return {
                ok: false,
                strategy: "unavailable",
                exitCode: 70,
                diagnostic: {
                  component: "hopper_private_display",
                  operation: "probe",
                  status: "error",
                  failure_code: "private_display_unavailable",
                  reason: "fixture",
                  socket_directory: "/tmp/.X11-unix",
                  socket_directory_mode: null,
                  mount_read_only: null,
                  effective_socket_directory_mode: null,
                  effective_mount_read_only: null,
                  wsl: false,
                  strategy: "unavailable",
                  fallback_reason: null,
                  xvfb_stderr_bytes: 0,
                },
                cleanup: {
                  status: "pending",
                  lease: probeLease,
                  reason: "fixture cleanup",
                },
              };
            },
          },
        );
        const signal =
          stage === "nested"
            ? controller.signal
            : AbortSignal.abort("cancel fixture");
        const launched = await launcher.launch(
          {
            directory: stage === "bootstrap" ? join(root, "missing") : root,
            socketPath: join(root, "bridge.sock"),
            token: "fixture-token",
            runId: "lease-release-test",
          },
          stage !== "bootstrap" ? { signal } : {},
        );
        expect(launched.ok).toBe(false);
        if (launched.ok) return;
        expect(launched.error.cleanupPrimary?._tag).toBe(
          stage !== "bootstrap" ? "HopperCancelledError" : "HopperStartError",
        );
        expect(launched.error.cleanupIncomplete).toBe(true);
        expect(launched.error.cleanupResources).toEqual(
          stage === "nested" ? ["probe", socketPath] : [socketPath],
        );
        expect(release).toHaveBeenCalledTimes(1);
        if (stage === "nested") {
          expect((await launcher.cleanup()).ok).toBe(false);
          expect(launched.error.cleanupResources).toEqual(["probe"]);
          expect(launched.error.cleanupIncomplete).toBe(true);
        }
        expect((await launcher.cleanup()).ok).toBe(true);
        expect(release).toHaveBeenCalledTimes(2);
        expect(launched.error.cleanupIncomplete).toBe(false);
        expect((await launcher.cleanup()).ok).toBe(true);
        expect(release).toHaveBeenCalledTimes(2);
      },
    );
  },
);
