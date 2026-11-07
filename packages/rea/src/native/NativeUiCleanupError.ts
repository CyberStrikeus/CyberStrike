import { AnalysisCleanupLeaseGroup } from "../artifacts/AnalysisCleanupLease.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import type { NativeUiObservationResult } from "../domain/native/nativeUiObservation.js";
import type { NativeUiHelperRuntime } from "./NativeUiHelperRuntime.js";

/** Exact runtime owners remain reachable for standalone callers' cleanup retry. */
export class NativeUiCleanupError extends ProviderCleanupError {
  readonly runtimes: readonly NativeUiHelperRuntime[];

  constructor(
    failures: readonly {
      readonly runtime: NativeUiHelperRuntime;
      readonly cause: unknown;
    }[],
    operation: string,
    partialObservation?: NativeUiObservationResult,
  ) {
    const runtimes = failures.map(({ runtime }) => runtime);
    const resources = () =>
      runtimes
        .filter((runtime) => !runtime.cleanupLease.released)
        .flatMap((runtime) => runtime.resources());
    super(
      "native-macos",
      resources(),
      {
        reason: "Native UI runtime cleanup remains incomplete",
        failures: failures.map(({ runtime, cause }) => ({
          resources: [...runtime.resources()],
          reason: cause instanceof Error ? cause.message : String(cause),
        })),
      },
      {
        operation,
        cause: new AggregateError(
          failures.map(({ cause }) => cause),
          "Native UI runtime cleanup failed",
        ),
        partialObservation,
      },
    );
    this.runtimes = runtimes;
    new AnalysisCleanupLeaseGroup(
      this,
      runtimes.map((runtime) => runtime.cleanupLease),
    );
    this.bindCleanupResourceOwner({
      get cleanupResources() {
        return resources();
      },
    });
  }
}
