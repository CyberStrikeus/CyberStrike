import { access, mkdtemp, rmdir } from "node:fs/promises";
import { expect, it, onTestFinished } from "vitest";

import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import { HopperStartError } from "../../../src/domain/hopperErrors.js";
import { err, ok as resultOk } from "../../../src/domain/result.js";
import type {
  BridgeLauncher,
  BridgeSession,
} from "../../../src/hopper/BridgeLauncher.js";
import { HopperClient } from "../../../src/hopper/HopperClient.js";
import { acquireHopperTargetLease } from "../../../src/process/HopperLease.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { hopperFixturePath } from "../providers/hopper/hopperClient.fixture.js";
import {
  createBinarySessionTargets,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";

const createShortLeaseDirectory = async (): Promise<string> => {
  // A redirected TMPDIR can exceed macOS's Unix socket path limit once
  // Hopper appends its lease key. Remove only an empty directory after the
  // owning client has closed; recursive removal could hide a retained lease.
  const directory = await mkdtemp("/tmp/rea-hl-");
  onTestFinished(async () => {
    await rmdir(directory);
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });
  return directory;
};

class RetryingHopperLauncher implements BridgeLauncher {
  cleanupAllowed = false;
  cleanupAttempts = 0;
  directory: string | undefined;

  constructor(
    readonly leaseDirectory: string,
    readonly targetPath: string,
    readonly cleanupRequired = false,
  ) {}

  acquire(runId: string) {
    return acquireHopperTargetLease({
      targetPath: this.targetPath,
      targetKind: "database",
      loaderArgs: [],
      runId,
      directory: this.leaseDirectory,
    });
  }

  async launch(session: BridgeSession) {
    const lease = await this.acquire(session.runId);
    if (!lease.acquired)
      return err(
        new HopperStartError({ userMessage: "fixture lease is held" }),
      );
    this.directory = session.directory;
    const started = await spawnOwnedProviderProcess({
      command: process.execPath,
      arguments: [
        hopperFixturePath,
        session.socketPath,
        session.token,
        session.runId,
        this.cleanupRequired ? "cleanup-required" : "acknowledge",
      ],
      runId: session.runId,
      expectedCommand: null,
    });
    return resultOk({
      ...started,
      ownsProcessLifetime: true as const,
      providerLifetime: "launcher-process" as const,
      shutdownMode: "process-cleanup" as const,
      cleanup: () => {
        this.cleanupAttempts += 1;
        return this.cleanupAllowed
          ? cleanupOwnedProcessGroup(started.ownership)
          : Promise.resolve({
              cleaned: false as const,
              reason: "fixture process cleanup not confirmed",
            });
      },
      releaseLease: () => lease.lease.release(),
    });
  }
}

it("retains Hopper process handles, private files, and lease until an actual session cleanup retry succeeds", async () => {
  const leaseDirectory = await createShortLeaseDirectory();
  const [first, second] = await createBinarySessionTargets();
  const launcher = new RetryingHopperLauncher(leaseDirectory, first);
  const hopper = new HopperClient({ launcher, startupTimeoutMs: 10_000 });
  let clientsCreated = 0;
  const session = createTestBinarySession(() => {
    clientsCreated += 1;
    return {
      execute: async () => {
        const started = await hopper.start();
        return started.ok
          ? resultOk(
              createAnalysisExecution(null, {
                id: "hopper",
                name: "fixture Hopper",
                version: null,
              }),
            )
          : started;
      },
      close: (options) => hopper.close(options),
    };
  });
  onTestFinished(async () => {
    launcher.cleanupAllowed = true;
    const sessionClosed = await session.close();
    if (!sessionClosed.ok) throw sessionClosed.error;
    const hopperClosed = await hopper.close();
    if (!hopperClosed.ok) throw hopperClosed.error;
  });
  expect(await session.open(first)).toMatchObject({ ok: true });
  expect(await session.close()).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });
  const runtime = launcher.directory;
  if (runtime === undefined)
    throw new Error("Fixture did not capture its runtime");
  await access(runtime);
  // The fixture exits after its shutdown acknowledgement. When the supervisor
  // observes that exit only after a failed verification began, it verifies
  // once more; a failed stop never runs more than two verifications.
  const firstCloseAttempts = launcher.cleanupAttempts;
  expect(firstCloseAttempts).toBeGreaterThanOrEqual(1);
  expect(firstCloseAttempts).toBeLessThanOrEqual(2);
  expect(await launcher.acquire("other-owner")).toMatchObject({
    acquired: false,
  });
  expect(await session.open(second)).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });
  expect(clientsCreated).toBe(1);
  // The launcher exit was already observed, so the retry has no new evidence.
  expect(launcher.cleanupAttempts).toBe(firstCloseAttempts + 1);
  launcher.cleanupAllowed = true;
  expect(await session.close()).toEqual(resultOk(null));
  expect(launcher.cleanupAttempts).toBe(firstCloseAttempts + 2);
  await expect(access(runtime)).rejects.toMatchObject({ code: "ENOENT" });
  const replacement = await launcher.acquire("replacement-owner");
  expect(replacement.acquired).toBe(true);
  if (replacement.acquired) await replacement.lease.release();
  expect((await session.open(second)).ok).toBe(true);
  expect(clientsCreated).toBe(2);
});

it("reports a direct Hopper close failure and retries the retained owned process", async () => {
  const leaseDirectory = await createShortLeaseDirectory();
  const [target] = await createBinarySessionTargets();
  const launcher = new RetryingHopperLauncher(leaseDirectory, target, true);
  const hopper = new HopperClient({ launcher, startupTimeoutMs: 10_000 });
  onTestFinished(async () => {
    launcher.cleanupAllowed = true;
    const closed = await hopper.close();
    if (!closed.ok) throw closed.error;
  });
  expect(await hopper.start()).toMatchObject({ ok: true });
  expect(await hopper.close()).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });
  expect(launcher.cleanupAttempts).toBe(1);
  launcher.cleanupAllowed = true;
  expect(await hopper.close()).toEqual(resultOk(null));
  expect(launcher.cleanupAttempts).toBe(2);
});
