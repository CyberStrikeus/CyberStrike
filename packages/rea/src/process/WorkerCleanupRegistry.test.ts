import { expect, it } from "vitest";

import {
  OwnedWorkerRuntime,
  WorkerCleanupRegistry,
} from "./OwnedWorkerRuntime.js";

it("retries one host's retained runtime without failing another host", async () => {
  const first = new WorkerCleanupRegistry();
  const second = new WorkerCleanupRegistry();
  let fail = true;
  const stuck = new OwnedWorkerRuntime({
    rootPrefix: "rea-worker-host-",
    cleanupRegistry: first,
    retryCleanup: async () => {
      if (fail) throw new Error("host still owns its worker");
    },
  });
  stuck.retainForCleanup();
  try {
    await expect(second.retry()).resolves.toBeUndefined();
    await expect(first.retry()).rejects.toThrow("host still owns its worker");
  } finally {
    fail = false;
    await stuck.close();
  }
});
