import { TestRunner } from "vitest";

import type { ProcessOwnershipHost } from "../src/process/ProcessOwnership.js";

/** Retire each isolated graph's native cache when its test worker stops. */
export default class ProcessOwnershipRunner extends TestRunner {
  readonly #registeredHosts = new WeakSet<ProcessOwnershipHost>();

  async onBeforeRunFiles(): Promise<void> {
    const { systemProcessOwnershipHost } =
      await import("../src/process/ProcessOwnershipObservation.js");
    if (this.#registeredHosts.has(systemProcessOwnershipHost)) return;
    if (this.onCleanupWorkerContext === undefined)
      throw new Error("The test pool does not support worker resource cleanup");
    this.#registeredHosts.add(systemProcessOwnershipHost);
    this.onCleanupWorkerContext(() => systemProcessOwnershipHost.close?.());
  }
}
