import { jsonValueSchema } from "../domain/jsonValue.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { RetainedResourceScope } from "../application/AnalysisProvider.js";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { DarwinProcessOwnershipInspectionError } from "../process/DarwinProcessRunTokenReader.js";
import { OwnedCommandFailure } from "../process/OwnedCommand.js";

/** Transfer exact helper and command cleanup capabilities to the caller's scope. */
export const retainOwnedCommandCleanup = (
  cause: unknown,
  resourceOwner: RetainedResourceScope,
  providerId: string,
  operation: string,
): readonly AnalysisError[] => {
  const commandFailure =
    cause instanceof OwnedCommandFailure ? cause : undefined;
  const preparation =
    commandFailure?.preparationFailure ??
    (cause instanceof DarwinProcessOwnershipInspectionError
      ? cause
      : undefined);
  const cleanups: AnalysisError[] = [];
  if (preparation?.cleanupFailure !== undefined) {
    const cleanup = preparation.cleanupFailure;
    const lease = new AnalysisCleanupLease(async () => {
      if (!cleanup.cleanupIncomplete) return;
      if (preparation.cleanupOwner === undefined) throw cleanup;
      await preparation.cleanupOwner.close();
      if (cleanup.cleanupIncomplete) throw cleanup;
    }, cleanup);
    resourceOwner.retain(
      {
        close: () => lease.release(),
        get cleanupResources() {
          return cleanup.cleanupResources;
        },
      },
      cleanup.cleanupResources[0] ??
        "Provider prerequisite ownership preparation",
    );
    cleanups.push(cleanup);
  }
  if (
    commandFailure !== undefined &&
    (commandFailure.cleanupOwner !== undefined ||
      commandFailure.cleanupFailure !== null)
  ) {
    const supervisor = commandFailure.cleanupOwner;
    const failureForStop = (
      reason: string,
      result: OwnedCommandFailure["cleanupResult"],
    ): ProviderCleanupError =>
      new ProviderCleanupError(
        providerId,
        commandFailure.resources,
        {
          reason,
          ...(result === undefined
            ? {}
            : {
                process_cleanup: jsonValueSchema.parse(result),
              }),
        },
        { cause, operation },
      );
    const cleanup = failureForStop(
      commandFailure.cleanupFailure ??
        "Provider prerequisite cleanup remains incomplete",
      commandFailure.cleanupResult,
    );
    const lease = new AnalysisCleanupLease(async () => {
      if (supervisor === undefined) throw cleanup;
      const stopped = await supervisor.stop();
      if (stopped.status === "incomplete") {
        const failure = failureForStop(stopped.reason, stopped.cleanupResult);
        failure.bindCleanupResourceOwner(lease);
        lease.bindCleanupError(failure);
        throw failure;
      }
    }, commandFailure.resources);
    cleanup.bindCleanupResourceOwner(lease);
    lease.bindCleanupError(cleanup);
    resourceOwner.retain(
      {
        close: () => lease.release(),
        get cleanupResources() {
          return cleanup.cleanupResources;
        },
      },
      commandFailure.resources[0] ?? "Provider prerequisite process",
    );
    cleanups.push(cleanup);
  }
  return cleanups;
};
