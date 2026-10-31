import type { AnalysisPartialObservation } from "../domain/analysisErrorBase.js";
import { err, ok, type Result } from "../domain/result.js";
import type { JavaScriptSourceAnalysisPort } from "../domain/javascript/javascriptSourceAnalysis.js";
import type { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import type { OwnedDirectoryHandle } from "../filesystem/OwnedDirectoryHandle.js";
import type { OwnedStagedOutput } from "../filesystem/OwnedStagedOutput.js";

import type { ArtifactReader } from "./ArtifactReader.js";
import {
  ArtifactReaderFailure,
  artifactPrimaryCleanupLeases,
} from "./ArtifactReader.js";
import type { SafeOutputTree } from "./SafeOutputTree.js";
import type { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";
import { AnalysisCleanupLease } from "./AnalysisCleanupLease.js";

/** One artifact resource and the capability that owns its cleanup. */
export type ArtifactResourceOwner =
  | {
      readonly kind: "lease";
      readonly resource: string;
      readonly lease: { release(): Promise<void> };
    }
  | {
      readonly kind: "javascript-source-analysis";
      readonly resource: string;
      readonly analysis: JavaScriptSourceAnalysisPort;
    }
  | {
      readonly kind: "directory-handle";
      readonly resource: string;
      readonly handle: OwnedDirectoryHandle;
    }
  | {
      readonly kind: "reader";
      readonly resource: string;
      readonly reader: ArtifactReader;
    }
  | {
      readonly kind: "file-handle";
      readonly resource: string;
      readonly handle: OwnedFileHandle;
    }
  | {
      readonly kind: "output-tree";
      readonly resource: string;
      readonly tree: SafeOutputTree;
    }
  | {
      readonly kind: "staged-output";
      readonly resource: string;
      readonly output: OwnedStagedOutput;
    }
  | {
      readonly kind: "private-runtime-root";
      readonly resource: string;
      readonly root: Pick<PrivateRuntimeRoot, "path" | "close">;
    };

export type ArtifactCleanupAttempt =
  | { readonly kind: "released" }
  | {
      readonly kind: "failed";
      readonly cause: unknown;
      readonly owner: ArtifactResourceOwner;
      readonly lease: AnalysisCleanupLease;
    };

/** Retry failure carrying the exact retained owners that did not release. */
export class ArtifactResourceRetryFailure extends ArtifactReaderFailure {
  readonly failedOwners: readonly ArtifactResourceOwner[];
  override readonly cleanupLeases: readonly AnalysisCleanupLease[];
  constructor(
    failures: readonly {
      readonly owner: ArtifactResourceOwner;
      readonly lease: AnalysisCleanupLease;
    }[],
    message: string,
    options: ConstructorParameters<typeof ArtifactReaderFailure>[2],
  ) {
    super("unavailable", message, options);
    this.failedOwners = failures.map(({ owner }) => owner);
    this.cleanupLeases = [...new Set(failures.map(({ lease }) => lease))];
  }
}

/** Caller-owned scope that retains failed artifact cleanup for a later close. */
export class ArtifactResourceScope {
  readonly #pending = new Set<ArtifactResourceOwner>();
  readonly #leases = new WeakMap<
    ArtifactResourceOwner,
    {
      readonly lease: AnalysisCleanupLease;
      resources: readonly string[];
    }
  >();
  readonly #active = new Set<Promise<unknown>>();
  #draining: Promise<void> | undefined;
  #closeInFlight: Promise<void> | undefined;
  readonly #closeHooks: Array<() => Promise<void>> = [];
  #closed = false;

  get hasPending(): boolean {
    return this.#pending.size > 0;
  }

  /** Labels come from the exact retained owners, never from diagnostic text. */
  get cleanupResources(): readonly string[] {
    return [
      ...new Set(
        [...this.#pending].flatMap((owner) => {
          const lease = this.#lease(owner);
          return lease.released
            ? []
            : (lease.cleanupResources ?? [owner.resource]);
        }),
      ),
    ];
  }

  /** Admit a resource operation while the scope remains open. */
  async run<T>(operation: () => Promise<T>): Promise<T> {
    while (true) {
      if (this.#closed)
        throw new ArtifactReaderFailure(
          "unavailable",
          "Artifact resource scope is closed",
        );
      if (this.#draining !== undefined) await this.#draining;
      if (this.#closed)
        throw new ArtifactReaderFailure(
          "unavailable",
          "Artifact resource scope is closed",
        );
      if (this.#pending.size > 0) {
        await this.retryCleanup();
        continue;
      }
      const running = Promise.resolve().then(operation);
      this.#active.add(running);
      try {
        return await running;
      } finally {
        this.#active.delete(running);
      }
    }
  }

  /** Attempt cleanup now and retain the same owner if it fails. */
  async release(owner: ArtifactResourceOwner): Promise<ArtifactCleanupAttempt> {
    try {
      await this.#lease(owner).release();
      this.#pending.delete(owner);
      return { kind: "released" };
    } catch (cause: unknown) {
      this.#pending.add(owner);
      this.#observeCleanupFailure(owner, cause);
      return { kind: "failed", cause, owner, lease: this.#lease(owner) };
    }
  }

  /** Compose initial cleanup authority without confusing it with an independent primary. */
  cleanupFailure(
    outcome:
      | { readonly kind: "completed" }
      | { readonly kind: "failed"; readonly cause: unknown },
    failures: readonly [
      Extract<ArtifactCleanupAttempt, { readonly kind: "failed" }>,
      ...Extract<ArtifactCleanupAttempt, { readonly kind: "failed" }>[],
    ],
    partialObservation?: AnalysisPartialObservation,
  ): ArtifactReaderFailure {
    const observations = failures.map(({ cause, owner }) =>
      ArtifactReaderFailure.cleanupObservation(cause, owner.resource),
    );
    const primary =
      outcome.kind === "failed" ? outcome.cause : failures[0].cause;
    const inherited =
      outcome.kind === "failed" ? artifactPrimaryCleanupLeases(primary) : [];
    return ArtifactReaderFailure.withCleanup(
      primary,
      {
        reason: observations.map(({ reason }) => reason).join("; "),
        resources: [
          ...new Set(observations.flatMap(({ resources }) => resources)),
        ],
      },
      partialObservation,
      inherited === undefined
        ? undefined
        : [...new Set([...inherited, ...failures.map(({ lease }) => lease)])],
    );
  }

  /** Adopt an owner after another boundary's cleanup attempt failed. */
  retain(owner: ArtifactResourceOwner): void {
    this.#pending.add(owner);
  }

  /** Retry retained owners without closing resource admission. */
  retryCleanup(): Promise<void> {
    if (this.#draining !== undefined) return this.#draining;
    this.#draining = this.#drainAndRetry().finally(() => {
      this.#draining = undefined;
    });
    return this.#draining;
  }

  /**
   * Run after retained owners are released. Hooks stay registered so a later
   * close retries them, and a failing hook does not skip the ones after it.
   * Concurrent closes share one in-flight attempt.
   */
  addCloseHook(hook: () => Promise<void>): void {
    this.#closeHooks.push(hook);
  }

  /** Stop admission, wait for active operations, and retry every retained owner. */
  close(): Promise<void> {
    this.#closed = true;
    if (this.#closeInFlight !== undefined) return this.#closeInFlight;
    const attempt = this.#finishClose();
    let published: Promise<void>;
    published = attempt.finally(() => {
      if (this.#closeInFlight === published) this.#closeInFlight = undefined;
    });
    this.#closeInFlight = published;
    return published;
  }

  /** Every registered hook runs. One failure is returned unchanged; several are aggregated. */
  async #runCloseHooks(): Promise<Result<void, unknown>> {
    const failures: unknown[] = [];
    for (const hook of this.#closeHooks) {
      try {
        await hook();
      } catch (cause: unknown) {
        failures.push(cause);
      }
    }
    if (failures.length === 0) return ok(undefined);
    if (failures.length === 1) return err(failures[0]);
    return err(
      new AggregateError(
        failures,
        failures
          .map((cause) =>
            cause instanceof Error ? cause.message : String(cause),
          )
          .join("; "),
      ),
    );
  }

  async #finishClose(): Promise<void> {
    // A parked analyzer is not a pending owner. Stop it even when another
    // retained cleanup is still failing. A later close retries both.
    const cleanup = await this.retryCleanup().then(
      () => ok(undefined),
      (cause: unknown) => err(cause),
    );
    const hooks = await this.#runCloseHooks();
    if (!cleanup.ok && !hooks.ok)
      throw this.#composeCloseFailures(cleanup.error, hooks.error);
    if (!hooks.ok) throw hooks.error;
    if (!cleanup.ok) throw cleanup.error;
  }

  /**
   * Report both outstanding owners. The pending set and the close hook stay
   * registered, so the next close retries each failed path.
   */
  #composeCloseFailures(
    cleanup: unknown,
    hookFailure: unknown,
  ): ArtifactReaderFailure {
    const retained = ArtifactReaderFailure.cleanupObservation(
      cleanup,
      "retained artifact cleanup",
    );
    const hook = ArtifactReaderFailure.cleanupObservation(
      hookFailure,
      "close hook",
    );
    const resources = [...new Set([...retained.resources, ...hook.resources])];
    const options = {
      cause: new AggregateError(
        [cleanup, hookFailure],
        "Retained cleanup and a close hook both failed",
      ),
      cleanup: {
        reason: `${retained.reason}; ${hook.reason}`,
        resources,
      },
    };
    const message = `Artifact cleanup remains incomplete: ${resources.join(", ")}`;
    if (cleanup instanceof ArtifactResourceRetryFailure)
      return new ArtifactResourceRetryFailure(
        cleanup.failedOwners.map((owner) => ({
          owner,
          lease: this.#lease(owner),
        })),
        message,
        options,
      );
    return new ArtifactReaderFailure("unavailable", message, options);
  }

  async #drainAndRetry(): Promise<void> {
    while (this.#active.size > 0) await Promise.allSettled(this.#active);
    const failures: {
      readonly owner: ArtifactResourceOwner;
      readonly cause: unknown;
    }[] = [];
    for (const owner of this.#pending) {
      try {
        await this.#lease(owner).release();
        this.#pending.delete(owner);
      } catch (cause: unknown) {
        this.#observeCleanupFailure(owner, cause);
        failures.push({ owner, cause });
      }
    }
    if (failures.length === 0) return;
    const observations = failures.map(({ owner, cause }) =>
      ArtifactReaderFailure.cleanupObservation(
        cause,
        owner.kind === "lease" && owner.lease instanceof AnalysisCleanupLease
          ? (owner.lease.cleanupResources ?? owner.resource)
          : owner.resource,
      ),
    );
    const resources = [
      ...new Set(observations.flatMap(({ resources }) => resources)),
    ];
    throw new ArtifactResourceRetryFailure(
      failures.map(({ owner }) => ({ owner, lease: this.#lease(owner) })),
      `Artifact cleanup remains incomplete: ${resources.join(", ")}`,
      {
        cause: new AggregateError(
          failures.map(({ cause }) => cause),
          "One or more artifact resources remain owned",
        ),
        cleanup: {
          reason: observations.map(({ reason }) => reason).join("; "),
          resources,
        },
      },
    );
  }

  /** This boundary owns the latest parsed child cleanup facts for a composite owner. */
  #observeCleanupFailure(owner: ArtifactResourceOwner, cause: unknown): void {
    const retained = this.#leases.get(owner);
    if (retained !== undefined)
      retained.resources = [
        ...ArtifactReaderFailure.cleanupObservation(cause, owner.resource)
          .resources,
      ];
  }

  #lease(owner: ArtifactResourceOwner): AnalysisCleanupLease {
    if (owner.kind === "lease" && owner.lease instanceof AnalysisCleanupLease)
      return owner.lease;
    const previous = this.#leases.get(owner);
    if (previous !== undefined) return previous.lease;
    const retained: {
      readonly lease: AnalysisCleanupLease;
      resources: readonly string[];
    } = {
      resources: [owner.resource],
      lease: new AnalysisCleanupLease(() => cleanup(owner), {
        get cleanupResources() {
          return retained.resources;
        },
      }),
    };
    this.#leases.set(owner, retained);
    return retained.lease;
  }
}

const cleanup = async (owner: ArtifactResourceOwner): Promise<void> => {
  switch (owner.kind) {
    case "lease":
      await owner.lease.release();
      return;
    case "javascript-source-analysis":
      await owner.analysis.close();
      return;
    case "reader":
      await owner.reader.close();
      return;
    case "file-handle":
    case "directory-handle":
      await owner.handle.close();
      return;
    case "output-tree":
      await owner.tree.rollback();
      return;
    case "staged-output":
      await owner.output.close();
      return;
    case "private-runtime-root":
      await owner.root.close();
  }
};
