import { AnalysisCapabilityUnavailableError } from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { DarwinProcessOwnershipInspectionError } from "../process/DarwinProcessRunTokenReader.js";
import { OwnedCommandFailure } from "../process/OwnedCommand.js";
import { LinuxOwnedProcessPrerequisiteError } from "../process/ProcessOwnershipObservation.js";
import type { ProviderAvailability } from "./AnalysisProvider.js";

const REMEDIATION =
  "Install your distribution's procps or procps-ng package, or put a procps-compatible ps on REA's PATH, then retry.";

const DARWIN_REMEDIATION =
  "Check the selected Xcode or Command Line Tools and Swift compiler configuration, then restart REA and retry.";

// Provider adapters re-attribute capability errors and keep the original as cause.
const prerequisiteRefusal = (
  cause: unknown,
): LinuxOwnedProcessPrerequisiteError | undefined => {
  if (
    !(cause instanceof AnalysisCapabilityUnavailableError) ||
    cause.cleanupIncomplete
  )
    return undefined;
  for (
    let current: unknown = cause;
    current instanceof AnalysisCapabilityUnavailableError;
    current = current.cause
  )
    if (current instanceof LinuxOwnedProcessPrerequisiteError) return current;
  return undefined;
};

// Recognize only failures attributed to owned-process preparation. Cancellation
// and failed cleanup remain errors so their owner and completion are not lost.
const darwinPrerequisiteRefusal = (
  cause: unknown,
): DarwinProcessOwnershipInspectionError | undefined => {
  let current = cause;
  while (current instanceof ProviderAdapterError) {
    if (
      current.cleanupIncomplete ||
      current.diagnostics?.stage !== "ownership_preparation"
    )
      return undefined;
    current = current.cause;
  }
  if (current instanceof OwnedCommandFailure) {
    if (
      current.reason !== "process" ||
      current.cleanupOwner !== undefined ||
      current.cleanupFailure !== null ||
      current.cleanupResult !== undefined ||
      current.cancellation !== undefined
    )
      return undefined;
    current = current.preparationFailure;
  }
  return current instanceof DarwinProcessOwnershipInspectionError &&
    current.cleanupFailure === undefined &&
    current.cleanupOwner === undefined &&
    current.cancellation === undefined
    ? current
    : undefined;
};

/** A host prerequisite gap is the probed provider's unavailability, not a probe failure. */
export const ownedProcessPrerequisiteAvailability = (
  cause: unknown,
): ProviderAvailability | undefined => {
  const refusal = prerequisiteRefusal(cause);
  if (refusal !== undefined)
    return {
      status: "unavailable",
      code: "runtime_unavailable",
      reason: `${refusal.reason}. ${REMEDIATION}`,
      diagnostics: {
        stage: "ownership_preparation",
        prerequisite_provider_id: refusal.providerId,
        prerequisite_operation: refusal.operation,
      },
    };
  const darwin = darwinPrerequisiteRefusal(cause);
  if (darwin === undefined) return undefined;
  return {
    status: "unavailable",
    code: "runtime_unavailable",
    reason: `${darwin.message}. ${DARWIN_REMEDIATION}`,
    diagnostics: {
      stage: "ownership_preparation",
      ...(darwin.compilerOutcome === undefined
        ? {}
        : { compiler_outcome: jsonValueSchema.parse(darwin.compilerOutcome) }),
    },
  };
};
