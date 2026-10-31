import { randomUUID } from "node:crypto";

import { expect, it } from "vitest";

import { verifyNoTokenOwnedProcesses } from "../../../src/process/ProcessOwnership.js";
import { createSystemProcessOwnershipHost } from "../../../src/process/ProcessOwnershipObservation.js";
import {
  spawnProviderProcessFixture,
  stopProviderProcessFixture,
  waitForProviderProcessReady,
} from "../../fixtures/providerProcess.js";

it.skipIf(process.platform !== "linux")(
  "accepts native absence after a baseline process exits between table and identity reads",
  async () => {
    const child = spawnProviderProcessFixture("graceful");
    const native = createSystemProcessOwnershipHost("linux", process.env);
    try {
      await waitForProviderProcessReady(child);
      const baseline = await native.captureBaseline?.();
      expect(baseline).toContainEqual({
        pid: child.pid,
        identity: expect.stringMatching(/^linux-starttime:\d+$/u),
      });
      const rows = (await native.listProcesses()).filter(
        ({ pid }) => pid === child.pid,
      );
      expect(rows).toHaveLength(1);

      await expect(
        verifyNoTokenOwnedProcesses(
          randomUUID(),
          {
            ...native,
            listProcesses: async () => {
              // Keep one real candidate row, then force the enumeration race
              // before the unmodified native identity/token observer runs.
              await stopProviderProcessFixture(child);
              return rows;
            },
          },
          baseline,
        ),
      ).resolves.toEqual({ cleaned: true, signaled: false });
    } finally {
      await stopProviderProcessFixture(child);
      await native.close?.();
    }
  },
);
