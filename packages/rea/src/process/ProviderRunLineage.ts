import type { ProcessLineageObservation } from "./ProcessOwnership.js";
import { observeOwnedProcessLineage } from "./ProcessOwnershipObservation.js";
import type { ProviderProcessLaunch } from "./ProviderProcess.js";

/** Retain the latest truthful process-lineage observation for one client. */
export class ProviderRunLineage {
  #observation: ProcessLineageObservation | null = null;

  /** Clear stale lineage before a new launch attempt. */
  reset(): void {
    this.#observation = null;
  }

  /** Observe a token-owned launcher without signaling it. */
  async observe(launch: ProviderProcessLaunch | undefined): Promise<void> {
    if (launch?.ownership === undefined) return;
    this.#observation = await observeOwnedProcessLineage(launch.ownership);
  }

  /** Return a detached copy suitable for caller-visible status. */
  snapshot(): ProcessLineageObservation | null {
    return this.#observation === null
      ? null
      : structuredClone(this.#observation);
  }
}
