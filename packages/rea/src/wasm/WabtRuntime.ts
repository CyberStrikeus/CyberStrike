import {
  AnalysisCleanupLease,
  AnalysisCleanupLeaseGroup,
} from "../artifacts/AnalysisCleanupLease.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";
import type { ProviderProcessSupervisor } from "../process/ProviderProcess.js";
import { OwnedCommandFailure } from "../process/OwnedCommand.js";

/** A private runtime cannot be removed until every retained command has stopped. */
export class WabtRuntime {
  readonly lease: AnalysisCleanupLease;
  readonly path: string;
  readonly #commands = new Map<
    ProviderProcessSupervisor,
    AnalysisCleanupLease
  >();
  #unknownCommand: string | undefined;

  constructor(root: Pick<PrivateRuntimeRoot, "path" | "close">) {
    this.path = root.path;
    this.lease = new AnalysisCleanupLease(async () => {
      const pending = [...this.#commands.values()].filter(
        (lease) => !lease.released,
      );
      if (pending.length > 0 || this.#unknownCommand !== undefined)
        throw new ArtifactReaderFailure(
          "unavailable",
          "WABT commands must stop before runtime removal",
          {
            cleanup: {
              reason:
                this.#unknownCommand ??
                "WABT command cleanup remains incomplete",
              resources: [
                ...new Set([
                  root.path,
                  ...pending.flatMap((lease) => lease.cleanupResources ?? []),
                ]),
              ],
            },
          },
        );
      await root.close();
    }, [root.path]);
  }

  /** Adopt only the supervisor supplied by the command boundary, never a PID or label. */
  retainCommandFailure(
    cause: unknown,
    failure: AnalysisError,
    resources: ArtifactResourceScope,
  ): void {
    if (
      !(cause instanceof OwnedCommandFailure) ||
      cause.cleanupFailure === null
    )
      return;
    const owner = cause.cleanupOwner;
    if (owner === undefined) {
      this.#unknownCommand = cause.cleanupFailure;
      return;
    }
    let lease = this.#commands.get(owner);
    if (lease === undefined) {
      lease = new AnalysisCleanupLease(async () => {
        const stopped = await owner.stop();
        if (stopped.status === "incomplete")
          throw new ArtifactReaderFailure("unavailable", stopped.reason, {
            cleanup: { reason: stopped.reason, resources: cause.resources },
          });
      }, cause.resources);
      this.#commands.set(owner, lease);
      resources.retain({
        kind: "lease",
        resource: cause.resources[0] ?? this.path,
        lease,
      });
    }
    new AnalysisCleanupLeaseGroup(failure, [lease]);
  }
}
