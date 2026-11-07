import {
  ArtifactResourceRetryFailure,
  type ArtifactResourceOwner,
  type ArtifactResourceScope,
} from "../artifacts/ArtifactResourceScope.js";
import type { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import type { AnalysisCleanupObservation } from "../domain/analysisErrorBase.js";
import {
  RegularFileCleanupFailure,
  type RegularFileOperationOutcome,
} from "../filesystem/OwnedRegularFile.js";
import { retryRegularFileCleanupFailures } from "./RegularFileRead.js";

/** Completion and exact staging owner retained when publication cleanup fails. */
export class ClientConfigurationPublicationFailure<
  Value = unknown,
> extends ArtifactResourceRetryFailure {
  constructor(
    readonly path: string,
    readonly outcome: RegularFileOperationOutcome<Value>,
    readonly cleanupCause: unknown,
    readonly owner: Extract<
      ArtifactResourceOwner,
      { readonly kind: "staged-output" }
    >,
    readonly cleanupLease: AnalysisCleanupLease,
  ) {
    super(
      [{ owner, lease: cleanupLease }],
      "Configuration publication cleanup remains incomplete",
      {
        cause: new AggregateError(
          [...(outcome.kind === "failed" ? [outcome.cause] : []), cleanupCause],
          "Configuration operation and staging cleanup failures",
        ),
        cleanup: ArtifactReaderFailure.cleanupObservation(
          cleanupCause,
          owner.resource,
        ),
      },
    );
  }
}

type ClientConfigurationCleanupFailure =
  | RegularFileCleanupFailure
  | ClientConfigurationPublicationFailure;

export const isClientConfigurationCleanupFailure = (
  cause: unknown,
): cause is ClientConfigurationCleanupFailure =>
  cause instanceof RegularFileCleanupFailure ||
  cause instanceof ClientConfigurationPublicationFailure;

/** Adopt only capabilities carried by explicit operation outcomes, never opaque causes. */
export const retryClientConfigurationCleanup = async (
  failure: ClientConfigurationCleanupFailure,
  resources: ArtifactResourceScope,
): Promise<{
  readonly primary: unknown;
  readonly failures: readonly RegularFileCleanupFailure[];
  readonly cleanupLeases: readonly AnalysisCleanupLease[];
  readonly cleanup?: AnalysisCleanupObservation;
}> => {
  const failures: RegularFileCleanupFailure[] = [];
  const cleanupLeases = new Set<AnalysisCleanupLease>();
  const observations: AnalysisCleanupObservation[] = [];
  let current = failure;
  let primary: unknown;
  for (;;) {
    let nested: unknown;
    if (current instanceof RegularFileCleanupFailure) {
      const retried = await retryRegularFileCleanupFailures(current, resources);
      failures.push(...retried.failures);
      for (const lease of retried.cleanupLeases) cleanupLeases.add(lease);
      if (retried.cleanup !== undefined) observations.push(retried.cleanup);
      primary = retried.primary;
      const last = retried.failures.at(-1)!;
      nested =
        last.operationFailure === undefined && last.outcome.kind === "failed"
          ? last.outcome.cause
          : undefined;
    } else {
      const released = await resources.release({
        kind: "lease",
        resource: current.owner.resource,
        lease: current.cleanupLease,
      });
      if (released.kind === "failed") {
        cleanupLeases.add(released.lease);
        observations.push(
          ArtifactReaderFailure.cleanupObservation(
            released.cause,
            current.owner.resource,
          ),
        );
      }
      primary =
        current.outcome.kind === "failed"
          ? current.outcome.cause
          : current.cleanupCause;
      nested =
        current.outcome.kind === "failed" ? current.outcome.cause : undefined;
    }
    if (!isClientConfigurationCleanupFailure(nested)) break;
    current = nested;
  }
  return {
    primary,
    failures,
    cleanupLeases: [...cleanupLeases],
    ...(observations.length === 0
      ? {}
      : {
          cleanup: {
            reason: observations.map(({ reason }) => reason).join("; "),
            resources: observations.flatMap(({ resources }) => resources),
          },
        }),
  };
};
