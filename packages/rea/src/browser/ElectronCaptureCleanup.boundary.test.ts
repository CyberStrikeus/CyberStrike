import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { expect, it, vi } from "vitest";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import {
  spawnOwnedProviderProcess,
  ProviderProcessSupervisor,
} from "../process/ProviderProcess.js";
import { observeOwnedProcessLineage } from "../process/ProcessOwnershipObservation.js";
import { ElectronCaptureCleanup } from "./ElectronCaptureCleanup.js";

// An authored idle Node fixture exercises POSIX ownership; it is not Electron.
it.skipIf(process.platform === "win32")(
  "retains transport recovery after real owned process-family cleanup",
  async () => {
    const spawned = await spawnOwnedProviderProcess({
      command: process.execPath,
      arguments: [
        "-e",
        "process.stdout.write('ready'); setInterval(() => {}, 1000)",
      ],
      expectedCommand: null,
      runId: randomUUID(),
      sweepTokenOwnedProcesses: true,
    });
    const supervisor = new ProviderProcessSupervisor({
      ...spawned,
      ownsProcessLifetime: true,
    });
    const scope = new ArtifactResourceScope();
    let denied = true;
    const close = vi.fn(async () => {
      if (denied) throw new Error("authored transport close denial");
    });
    try {
      await once(spawned.process.stdout!, "data");
      const lineage = await observeOwnedProcessLineage(spawned.ownership);
      expect(lineage.status).toBe("verified");
      const evidenceOwner = spawned.ownership.evidenceOwner;
      if (evidenceOwner === undefined)
        throw new Error("owned spawn omitted persistent ownership evidence");
      const owner = new ElectronCaptureCleanup(
        { close },
        { ...spawned.ownership, evidenceOwner },
        lineage,
      );
      expect(await owner.release(scope)).toMatchObject({
        transport: { kind: "failed" },
        processes: { kind: "released" },
      });
      expect(await supervisor.waitForExit(1000)).toBe(true);
      const error = new ProviderCleanupError(
        "rea-playwright-electron-active",
        owner.pendingResources,
        {},
      );
      owner.bind(error);
      expect(error.cleanupResources).toEqual(["browser_transport"]);
      denied = false;
      await scope.close();
      expect(error.cleanupIncomplete).toBe(false);
      expect(close).toHaveBeenCalledTimes(2);
    } finally {
      denied = false;
      try {
        await scope.close();
      } finally {
        try {
          const stopped = await supervisor.stop();
          expect(stopped.status).not.toBe("incomplete");
        } finally {
          supervisor.dispose();
        }
      }
    }
  },
);
