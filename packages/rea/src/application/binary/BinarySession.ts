import { randomUUID } from "node:crypto";

import { retainSavedAnalysisSnapshot } from "../../domain/savedAnalysisSnapshot.js";

import type { BinaryTarget } from "../../domain/binaryTargetTypes.js";
import {
  analysisProfilesEqual,
  type AnalysisProfileCommitment,
} from "../../domain/analysisProfile.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import {
  AnalysisError,
  primaryAnalysisError,
} from "../../domain/analysisErrorBase.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { err, ok, type Result } from "../../domain/result.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import { createAnalysisExecutionEvidence } from "../../domain/analysisObservation.js";
import type {
  AnalysisClient,
  AnalysisExecution,
  ExecutionOptions,
  AnalysisOperationPort,
  ProviderIdentity,
  AnalysisOperation,
} from "../AnalysisProvider.js";
import type {
  BinarySessionPort,
  SavedAnalysisSnapshot,
} from "./BinarySessionPort.js";
import {
  SessionProviderRouter,
  type SessionProviderRoute,
} from "./SessionProviderRouter.js";
import {
  routeAllowsSnapshotReplay,
  routeProviderIdentity,
} from "./SessionProviderPolicy.js";
import { InvestigationRecords } from "../investigation/InvestigationRecords.js";
import { recordEvidenceSources } from "../investigation/recordEvidenceSources.js";
import { BinarySessionRecords } from "./BinarySessionRecords.js";
import { binarySessionStatus } from "./BinarySessionStatus.js";
import { isSourceEvidenceRetainable } from "./AnalysisSnapshotCache.js";
import type { BinarySessionDetail } from "../../contracts/sessionStatusContract.js";
import {
  resolveSessionOpen,
  resolveSessionTarget,
  validateResolvedSessionTarget,
  type BinarySessionOpenOptions,
  type ResolvedSessionOpen,
} from "./BinarySessionOpen.js";
import {
  bindExecutionTarget,
  commitExecutionProfile,
  prepareSessionExecution,
} from "./BinarySessionExecution.js";
import { closeAnalysisClient } from "../AnalysisClientCleanup.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import { analysisErrorWithCancellation } from "../../domain/analysisErrorCancellation.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import { profilelessNativeDispatchProfile } from "./ProfilelessNativeWorkflowSnapshot.js";
import type { AnalysisSnapshot } from "../../domain/analysisSnapshot.js";
import { ResourceSnapshotMismatchError } from "../../domain/evidenceErrors.js";
import {
  parseBinaryTarget,
  type BinaryTargetResolverOptions,
} from "../BinaryTargetResolver.js";
import {
  resolveAppBundleResourceRoot,
  type ResolvedAppBundleResourceRoot,
} from "../AppBundleExecutable.js";
import {
  BUNDLE_RESOURCE_OPERATIONS,
  type ActiveBundleResourceSession,
  type BundleResourceClientFactory,
} from "./BundleResourceSession.js";

interface SessionRun {
  readonly client: AnalysisClient;
  readonly route: SessionProviderRoute;
  readonly runId: string;
}

interface SessionBinding extends SessionRun {
  readonly target: BinaryTarget;
  readonly profile: AnalysisProfileCommitment | null;
  readonly profilelessWorkflowProfile?: AnalysisProfileCommitment;
  nativeSourceAdmitted: boolean;
}

interface CleanupFailureTracker {
  readonly error: AnalysisError | undefined;
  readonly onFailure: (failure: AnalysisError) => void;
}

/** Compose live cleanup facts without treating an unowned rejection as completion. */
const sessionCleanupFailure = (
  primary: AnalysisError,
  cleanup: AnalysisError,
  operation: string,
): AnalysisError => {
  const failure = analysisErrorWithCleanupFailure(primary, cleanup, operation);
  return cleanup.cleanupIncomplete
    ? failure.bindCleanupDependencies([primary, cleanup])
    : failure;
};

const trackCleanupFailures = (
  signal: AbortSignal | undefined,
  operation: string,
): CleanupFailureTracker => {
  let error: AnalysisError | undefined;
  let cleanupFailure: AnalysisError | undefined;
  let cancellation: AnalysisCancelledError | undefined;
  const observed = new Set<AnalysisError>();
  return {
    get error() {
      return error;
    },
    onFailure: (failure) => {
      if (
        observed.has(failure) ||
        (failure.cleanupPrimary !== undefined &&
          observed.has(failure.cleanupPrimary))
      )
        return;
      observed.add(failure);
      if (cleanupFailure === undefined) {
        if (isAborted(signal))
          cancellation = new AnalysisCancelledError(operation, {
            cause: signal?.reason,
          });
        cleanupFailure = failure;
      } else {
        // Both operands are cleanup observations here. An earlier rejection
        // without a live lifecycle must not disappear when a later owner resolves.
        cleanupFailure = cleanupFailure.cleanupIncomplete
          ? sessionCleanupFailure(cleanupFailure, failure, operation)
          : analysisErrorWithCleanupFailure(cleanupFailure, failure, operation);
      }
      error =
        cancellation === undefined
          ? cleanupFailure
          : sessionCleanupFailure(cancellation, cleanupFailure, operation);
    },
  };
};

/** Provider metadata cannot confer authority to an uncommitted Evidence ID. */
const unrecordedExecution = (
  result: Result<AnalysisExecution, AnalysisError>,
): Result<AnalysisExecution, AnalysisError> => {
  if (!result.ok || !("evidenceId" in result.value)) return result;
  const observation = { ...result.value };
  delete observation.evidenceId;
  return ok(observation);
};

/**
 * Owns the single active target shared by CLI and MCP adapters.
 *
 * Target transitions are serialized because switching targets tears down the
 * active provider client. A failed switch recreates the previous target instead
 * of retaining a client whose resources were already shut down.
 */
export class BinarySession
  extends BinarySessionRecords
  implements BinarySessionPort
{
  #active: SessionBinding | undefined;
  #externalMutationCleanupFailure: AnalysisError | undefined;
  #pendingCleanup:
    | {
        readonly run: SessionRun;
        readonly retainDocument: boolean;
        readonly failures: Set<AnalysisError>;
      }
    | undefined;
  #transition: Promise<void> = Promise.resolve();
  #transitionGeneration = 0;
  #transitionPending = 0;
  /** Process shutdown has begun; later target acquisition must not outlive it. */
  #shutdownStarted = false;
  readonly #calls = new Map<Promise<unknown>, number>();
  readonly #promptCompletionControllers = new Set<AbortController>();
  readonly #providerRouter: SessionProviderRouter;
  readonly #bundleResourceFactory: BundleResourceClientFactory | undefined;
  #activeBundleResources: ActiveBundleResourceSession | undefined;
  #pendingBundleResourceCleanup: ActiveBundleResourceSession[] = [];
  readonly #runtimeUnavailability = new Map<
    string,
    { readonly reason: string }
  >();
  readonly #availabilityListeners = new Set<() => void | Promise<void>>();

  constructor(
    providerRouter: SessionProviderRouter,
    records: InvestigationRecords = new InvestigationRecords(),
    bundleResourceFactory?: BundleResourceClientFactory,
  ) {
    super(records);
    this.#providerRouter = providerRouter;
    this.#bundleResourceFactory = bundleResourceFactory;
  }

  /** Open an app resource root without requiring CFBundleExecutable. */
  openBundleResources(
    path: string,
    options: Pick<ExecutionOptions, "signal"> = {},
  ): Promise<Result<ResolvedAppBundleResourceRoot, AnalysisError>> {
    return this.#serialize(async (admittedThrough) => {
      const refused = this.#targetAcquisitionRefused("open_bundle_resources");
      if (refused !== undefined) return refused;
      await this.#drainCalls(admittedThrough);
      if (isAborted(options.signal))
        return err(
          new AnalysisCancelledError("open_bundle_resources", {
            cause: options.signal?.reason,
          }),
        );
      if (this.#externalMutationCleanupFailure?.cleanupIncomplete === true)
        return err(this.#externalMutationCleanupFailure);
      if (this.#bundleResourceFactory === undefined)
        return err(
          new AnalysisCapabilityUnavailableError(
            "bundle-resources",
            "open_bundle_resources",
            "No app resource reader is configured.",
          ),
        );
      const resolved = await resolveAppBundleResourceRoot(path);
      if (!resolved.ok) return resolved;
      if (isAborted(options.signal))
        return err(
          new AnalysisCancelledError("open_bundle_resources", {
            cause: options.signal?.reason,
          }),
        );
      const pendingClosed = await this.#retryPendingCleanup();
      if (!pendingClosed.ok) return pendingClosed;
      const pendingResourcesClosed =
        await this.#retryPendingBundleResourceCleanup();
      if (!pendingResourcesClosed.ok) return pendingResourcesClosed;
      if (isAborted(options.signal))
        return err(
          new AnalysisCancelledError("open_bundle_resources", {
            cause: options.signal?.reason,
          }),
        );
      const runId = randomUUID();
      let bundleClient: Awaited<
        ReturnType<BundleResourceClientFactory["createClient"]>
      >;
      try {
        bundleClient = await this.#bundleResourceFactory.createClient(
          resolved.value,
        );
      } catch (cause: unknown) {
        return err(
          cause instanceof AnalysisError
            ? cause
            : new ProviderAdapterError(
                "bundle-resources",
                "open_bundle_resources",
                { cause },
              ),
        );
      }
      const candidate: ActiveBundleResourceSession = {
        root: resolved.value,
        client: bundleClient.client,
        capabilities: bundleClient.capabilities,
        runId,
      };
      const started = await candidate.client.execute("health", {}, options);
      if (!started.ok) {
        this.#pendingBundleResourceCleanup.push(candidate);
        const closed = await this.#retryPendingBundleResourceCleanup();
        return err(
          closed.ok
            ? started.error
            : sessionCleanupFailure(
                started.error,
                closed.error,
                "open_bundle_resources",
              ),
        );
      }
      if (isAborted(options.signal)) {
        const cancelled = new AnalysisCancelledError("open_bundle_resources", {
          cause: options.signal?.reason,
        });
        this.#pendingBundleResourceCleanup.push(candidate);
        const closed = await this.#retryPendingBundleResourceCleanup();
        return err(
          closed.ok
            ? cancelled
            : sessionCleanupFailure(
                cancelled,
                closed.error,
                "open_bundle_resources",
              ),
        );
      }
      const cleanupFailures = trackCleanupFailures(
        options.signal,
        "open_bundle_resources",
      );
      const closed = await this.#closeActive(
        {},
        false,
        cleanupFailures.onFailure,
      );
      if (!closed.ok) {
        this.#pendingBundleResourceCleanup.push(candidate);
        const candidateClosed = await this.#retryPendingBundleResourceCleanup(
          undefined,
          cleanupFailures.onFailure,
        );
        const primary = cleanupFailures.error ?? closed.error;
        return err(
          cleanupFailures.error ??
            (candidateClosed.ok
              ? primary
              : analysisErrorWithCleanupFailure(
                  primary,
                  candidateClosed.error,
                  "open_bundle_resources",
                )),
        );
      }
      if (isAborted(options.signal)) {
        const cancelled = new AnalysisCancelledError("open_bundle_resources", {
          cause: options.signal?.reason,
        });
        this.#pendingBundleResourceCleanup.push(candidate);
        const candidateClosed = await this.#retryPendingBundleResourceCleanup(
          undefined,
          cleanupFailures.onFailure,
        );
        return err(
          cleanupFailures.error ??
            (candidateClosed.ok
              ? cancelled
              : sessionCleanupFailure(
                  cancelled,
                  candidateClosed.error,
                  "open_bundle_resources",
                )),
        );
      }
      this.#activeBundleResources = candidate;
      this.resetSnapshotInvalidation();
      return resolved;
    });
  }

  /**
   * Fast-path liveness gate (#1719): short-circuit only when the retained
   * client is genuinely alive. The probe reads the child's operation health
   * rather than the composite's unconditionally-ok `health`, so a dead child
   * falls through and a real client is started; an aborted caller leaves the
   * session untouched. Returns the fast-path result, or undefined to fall
   * through to the slow path.
   */
  async #tryRetainedFastPath(
    retained: SessionBinding,
    target: BinaryTarget,
    options: Pick<BinarySessionOpenOptions, "signal" | "snapshot">,
  ): Promise<Result<BinaryTarget, AnalysisError> | undefined> {
    const live = await this.#retainedClientLive(retained.client, options);
    if (isAborted(options.signal))
      return err(
        new AnalysisCancelledError("open_binary", {
          cause: options.signal?.reason,
        }),
      );
    if (!live) return undefined;
    if (options.snapshot !== undefined) {
      const imported = this.importAnalysisSnapshot(options.snapshot);
      if (!imported.ok) return imported;
    }
    return ok(target);
  }

  /** Identify the provider producing evidence for this session. */
  providerIdentity(operation?: AnalysisOperation): ProviderIdentity {
    return routeProviderIdentity(this.#currentRoute(), operation);
  }

  /** External live state cannot be replayed by a direct or composed CLI workflow. */
  allowsSnapshotReplay(operation: AnalysisOperation): boolean {
    if (operation === "decompile_all") return false;
    if (this.#activeBundleResources !== undefined) return false;
    return routeAllowsSnapshotReplay(this.#active?.route, operation);
  }

  invalidateSnapshotForExternalMutation(): void {
    this.invalidateSnapshot();
  }

  /** Return the selected immutable profile, optionally scoped to an operation. */
  analysisProfile(
    operation?: AnalysisOperation,
  ): AnalysisProfileCommitment | undefined {
    const profile = this.#active?.profile;
    if (profile === null || profile === undefined) {
      if (operation !== "inspect_native_dispatch_metadata") return undefined;
      return this.#active?.profilelessWorkflowProfile === undefined
        ? undefined
        : structuredClone(this.#active.profilelessWorkflowProfile);
    }
    if (
      operation !== undefined &&
      this.providerIdentity(operation).id !== profile.provider.id
    )
      return undefined;
    return structuredClone(profile);
  }

  /** Observe runtime provider-health changes that affect discovery metadata. */
  onAvailabilityChanged(listener: () => void | Promise<void>): () => void {
    this.#availabilityListeners.add(listener);
    return () => this.#availabilityListeners.delete(listener);
  }

  /** Resolve target identity under this session's file cleanup owner. */
  resolveTarget(
    path: string,
    options: Omit<BinaryTargetResolverOptions, "resources"> = {},
  ) {
    return parseBinaryTarget(path, {
      ...options,
      resources: this.fileResources,
    });
  }

  /** Resolve a target and provider profile without creating a provider client. */
  previewTarget(
    target: BinaryTarget,
    options: BinarySessionOpenOptions = {},
  ): Promise<Result<ResolvedSessionOpen, AnalysisError>> {
    if (isAborted(options.signal))
      return Promise.resolve(
        err(
          new AnalysisCancelledError("open_binary", {
            cause: options.signal?.reason,
          }),
        ),
      );
    return resolveSessionTarget({
      router: this.#providerRouter,
      current: this.#active,
      target,
      options,
      stagedSnapshotMatches: (target, profile) =>
        this.matchesSnapshot(target, profile),
    }).then((resolved) =>
      resolved.ok && isAborted(options.signal)
        ? err(
            new AnalysisCancelledError("open_binary", {
              cause: options.signal?.reason,
            }),
          )
        : resolved,
    );
  }

  /**
   * Open or switch targets after draining calls against the current target.
   * Returns the switch failure even if best-effort restoration also fails.
   */
  open(
    path: string,
    options: BinarySessionOpenOptions = {},
  ): Promise<Result<BinaryTarget, AnalysisError>> {
    return this.#open(
      (admitted) =>
        resolveSessionOpen({
          resources: this.fileResources,
          router: this.#providerRouter,
          current: this.#active,
          path,
          options: admitted,
          stagedSnapshotMatches: (target, profile) =>
            this.matchesSnapshot(target, profile),
        }),
      options,
    );
  }

  /** Open a previewed target without repeating parsing or provider profile discovery. */
  openResolvedTarget(
    resolved: Pick<ResolvedSessionOpen, "target" | "route">,
    options: Pick<BinarySessionOpenOptions, "signal" | "snapshot"> = {},
  ): Promise<Result<BinaryTarget, AnalysisError>> {
    return this.#open(
      () =>
        Promise.resolve(
          validateResolvedSessionTarget({
            ...resolved,
            current: this.#active,
            options,
            stagedSnapshotMatches: (target, profile) =>
              this.matchesSnapshot(target, profile),
          }),
        ),
      options,
    );
  }

  #open(
    resolve: (
      admitted: BinarySessionOpenOptions,
    ) => Promise<Result<ResolvedSessionOpen, AnalysisError>>,
    options: BinarySessionOpenOptions,
  ): Promise<Result<BinaryTarget, AnalysisError>> {
    return this.#serialize(async (admittedThrough) => {
      const refused = this.#targetAcquisitionRefused("open_binary");
      if (refused !== undefined) return refused;
      const admitted = await this.#withLoadedSnapshot(options);
      if (!admitted.ok) return admitted;
      return this.#openWithinTransition(
        admittedThrough,
        () => resolve(admitted.value),
        admitted.value,
      );
    });
  }

  /** Read the staged snapshot only after earlier lifecycle transitions have settled. */
  async #withLoadedSnapshot(
    options: BinarySessionOpenOptions,
  ): Promise<Result<BinarySessionOpenOptions, AnalysisError>> {
    if (options.loadSnapshot === undefined) return ok(options);
    if (isAborted(options.signal))
      return err(
        new AnalysisCancelledError("open_binary", {
          cause: options.signal?.reason,
        }),
      );
    const loaded = await options.loadSnapshot();
    if (!loaded.ok) return loaded;
    const { loadSnapshot: _loaded, ...rest } = options;
    return ok({ ...rest, snapshot: loaded.value });
  }

  async #openWithinTransition(
    admittedThrough: number,
    resolve: () => Promise<Result<ResolvedSessionOpen, AnalysisError>>,
    options: Pick<BinarySessionOpenOptions, "signal" | "snapshot">,
  ): Promise<Result<BinaryTarget, AnalysisError>> {
    if (this.#externalMutationCleanupFailure?.cleanupIncomplete === true)
      return err(this.#externalMutationCleanupFailure);
    if (isAborted(options.signal))
      return err(
        new AnalysisCancelledError("open_binary", {
          cause: options.signal?.reason,
        }),
      );
    const resolved = await resolve();
    if (!resolved.ok) return resolved;
    const { target, route, sameTarget } = resolved.value;
    const { profile } = route;
    if (isAborted(options.signal))
      return err(
        new AnalysisCancelledError("open_binary", {
          cause: options.signal?.reason,
        }),
      );
    const activeProfile = this.#active?.profile;
    const sameProfile =
      activeProfile === null || activeProfile === undefined
        ? profile === null
        : profile !== null && analysisProfilesEqual(activeProfile, profile);
    await this.#drainCalls(admittedThrough);
    if (isAborted(options.signal))
      return err(
        new AnalysisCancelledError("open_binary", {
          cause: options.signal?.reason,
        }),
      );
    const pendingClosed = await this.#retryPendingCleanup();
    if (!pendingClosed.ok) return pendingClosed;
    const pendingResourcesClosed =
      await this.#retryPendingBundleResourceCleanup();
    if (!pendingResourcesClosed.ok) return pendingResourcesClosed;
    if (isAborted(options.signal))
      return err(
        new AnalysisCancelledError("open_binary", {
          cause: options.signal?.reason,
        }),
      );
    const retained = sameTarget && sameProfile ? this.#active : undefined;
    if (retained !== undefined) {
      const fastPath = await this.#tryRetainedFastPath(
        retained,
        target,
        options,
      );
      if (fastPath !== undefined) return fastPath;
    }
    const previous = this.#active;
    this.#active = undefined;
    if (previous !== undefined) {
      const closed = await this.#retireClient(previous);
      if (!closed.ok) {
        // A failed open retires the provider cache, not the investigation.
        // Preserve Evidence and Unknown history for export and recovery.
        this.clearSnapshot();
        this.#clearRuntimeAvailability();
        if (isAborted(options.signal))
          return err(
            analysisErrorWithCleanupFailure(
              new AnalysisCancelledError("open_binary", {
                cause: options.signal?.reason,
              }),
              closed.error,
              "open_binary",
            ).bindCleanupDependencies([closed.error]),
          );
        return closed;
      }
    }
    if (isAborted(options.signal))
      return err(
        await this.#restoreAfterFailedOpen(
          previous,
          new AnalysisCancelledError("open_binary", {
            cause: options.signal?.reason,
          }),
        ),
      );
    const runId = randomUUID();
    const client = route.createClient(target, {
      runId,
    });
    const run: SessionRun = { client, route, runId };
    const started = await client.execute("health", {}, options);
    if (!started.ok) {
      return err(await this.#failedOpen(run, previous, started.error));
    }
    if (isAborted(options.signal)) {
      return err(
        await this.#failedOpen(
          run,
          previous,
          new AnalysisCancelledError("open_binary", {
            cause: options.signal?.reason,
          }),
        ),
      );
    }
    const cleanupFailures = trackCleanupFailures(options.signal, "open_binary");
    if (this.#activeBundleResources !== undefined) {
      this.#pendingBundleResourceCleanup.push(this.#activeBundleResources);
      this.#activeBundleResources = undefined;
      const retiredResources = await this.#retryPendingBundleResourceCleanup(
        undefined,
        cleanupFailures.onFailure,
      );
      if (!retiredResources.ok) {
        const primary = cleanupFailures.error ?? retiredResources.error;
        const failed = await this.#failedOpen(
          run,
          previous,
          primary,
          cleanupFailures.onFailure,
        );
        return err(cleanupFailures.error ?? failed);
      }
    }
    if (isAborted(options.signal)) {
      const cancelled = new AnalysisCancelledError("open_binary", {
        cause: options.signal?.reason,
      });
      const failed = await this.#failedOpen(
        run,
        previous,
        cancelled,
        cleanupFailures.onFailure,
      );
      return err(cleanupFailures.error ?? failed);
    }
    const profilelessWorkflowProfile =
      profile === null ? profilelessNativeDispatchProfile(route) : undefined;
    this.#active = {
      target,
      profile,
      ...(profilelessWorkflowProfile === undefined
        ? {}
        : { profilelessWorkflowProfile }),
      ...run,
      nativeSourceAdmitted: false,
    };
    this.#clearRuntimeAvailability();
    this.resetSnapshotInvalidation();
    if (options.snapshot === undefined) {
      if (profile === null) this.clearSnapshot();
      else this.selectSnapshot(target, profile);
    }
    if (options.snapshot !== undefined) {
      const imported = this.importAnalysisSnapshot(options.snapshot);
      if (!imported.ok) {
        this.#active = undefined;
        return err(await this.#failedOpen(run, previous, imported.error));
      }
    }
    return ok(target);
  }

  /** Serialize an external mutation and retire the potentially stale analysis. */
  withAdmittedExternalMutation<Value>(
    _path: string | undefined,
    signal: AbortSignal | undefined,
    operation: () => Promise<Result<Value, AnalysisError>>,
    completionFailure: (
      value: Result<Value, AnalysisError>,
      error: AnalysisError,
    ) => AnalysisError,
    operationName = "execute_rizin_command",
    cleanupRecovery?: (
      failure: AnalysisError | undefined,
    ) => Promise<Result<null, AnalysisError>>,
  ): Promise<Result<Result<Value, AnalysisError>, AnalysisError>> {
    return this.#serialize(async (admittedThrough) => {
      if (this.#activeBundleResources !== undefined)
        return err(
          new AnalysisCapabilityUnavailableError(
            "bundle-resources",
            operationName,
            "External mutation requires an active executable analysis target.",
          ),
        );
      if (isAborted(signal))
        return err(
          new AnalysisCancelledError(operationName, { cause: signal?.reason }),
        );
      await this.#drainCalls(admittedThrough);
      if (isAborted(signal))
        return err(
          new AnalysisCancelledError(operationName, { cause: signal?.reason }),
        );

      if (this.#externalMutationCleanupFailure?.cleanupIncomplete === true) {
        if (cleanupRecovery === undefined)
          return err(this.#externalMutationCleanupFailure);
        const recovered = await cleanupRecovery(
          this.#externalMutationCleanupFailure,
        );
        if (!recovered.ok)
          return err(
            isAborted(signal)
              ? analysisErrorWithCancellation(
                  recovered.error,
                  new AnalysisCancelledError(operationName, {
                    cause: signal?.reason,
                  }),
                )
              : recovered.error,
          );
        if (this.#externalMutationCleanupFailure.cleanupIncomplete)
          return err(
            isAborted(signal)
              ? analysisErrorWithCancellation(
                  this.#externalMutationCleanupFailure,
                  new AnalysisCancelledError(operationName, {
                    cause: signal?.reason,
                  }),
                )
              : this.#externalMutationCleanupFailure,
          );
        this.#externalMutationCleanupFailure = undefined;
      }

      const pendingCleanup = await this.#retryPendingCleanup();
      if (!pendingCleanup.ok)
        return err(
          isAborted(signal)
            ? analysisErrorWithCancellation(
                pendingCleanup.error,
                new AnalysisCancelledError(operationName, {
                  cause: signal?.reason,
                }),
              )
            : pendingCleanup.error,
        );
      if (isAborted(signal))
        return err(
          new AnalysisCancelledError(operationName, { cause: signal?.reason }),
        );

      const activeAtDispatch = this.#active;
      if (activeAtDispatch?.route.binding?.identity.id === "ghidra")
        return err(
          new AnalysisOutputError(
            operationName,
            "Close the active Ghidra session explicitly before an external mutation; rebinding would discard its ephemeral analysis edits.",
          ),
        );
      // A protocol reply does not prove that background writers have stopped.
      // Retire the old analysis and require an explicit fresh open rather than
      // silently binding a snapshot while an unrestricted command can still write.
      const retireTarget = activeAtDispatch !== undefined;
      this.invalidateSnapshot();
      const value = await operation();
      this.#externalMutationCleanupFailure =
        !value.ok && value.error.cleanupIncomplete ? value.error : undefined;
      if (retireTarget) {
        const retired = await this.#closeActive({}, false);
        if (!retired.ok) {
          const primary = completionFailure(value, retired.error);
          const failure =
            retired.error.cleanupIncomplete && primary !== retired.error
              ? analysisErrorWithCleanupFailure(
                  primary,
                  retired.error,
                  operationName,
                ).bindCleanupDependencies([primary, retired.error])
              : primary;
          return err(
            isAborted(signal)
              ? analysisErrorWithCancellation(
                  failure,
                  new AnalysisCancelledError(operationName, {
                    cause: signal?.reason,
                  }),
                )
              : failure,
          );
        }
      }
      if (isAborted(signal))
        return err(
          completionFailure(
            value,
            new AnalysisCancelledError(operationName, {
              cause: signal?.reason,
            }),
          ),
        );
      return ok(value);
    });
  }

  /**
   * Reject target acquisition once process shutdown has begun.
   * Acquisition already inside its transition still finishes; the shutdown
   * close queued behind that transition retires it.
   */
  beginShutdown(): void {
    this.#shutdownStarted = true;
  }

  #targetAcquisitionRefused(
    operation: "open_binary" | "open_bundle_resources",
  ): Result<never, AnalysisCancelledError> | undefined {
    if (!this.#shutdownStarted) return undefined;
    return err(new AnalysisCancelledError(operation));
  }

  /** Close the active target, if any. */
  close(
    options: Pick<ExecutionOptions, "progress"> & {
      readonly retainProviderDocuments?: boolean;
    } = {},
  ): Promise<Result<null, AnalysisError>> {
    return this.#serialize(async (admittedThrough) => {
      await this.#drainCalls(admittedThrough);
      return this.#closeActive(options);
    });
  }

  /** Drain earlier requests, save an immutable snapshot, and close under one lifecycle lock. */
  closeWithSnapshot(
    path: string,
    overwrite: boolean,
    options: Pick<ExecutionOptions, "progress"> = {},
  ): Promise<Result<SavedAnalysisSnapshot, AnalysisError>> {
    return this.#serialize(async (admittedThrough) => {
      await this.#drainCalls(admittedThrough);
      const snapshot = this.exportAnalysisSnapshot();
      if (!snapshot.ok) return snapshot;
      const written = await this.writeAnalysisSnapshot(
        snapshot.value,
        path,
        overwrite,
      );
      if (!written.ok) return written;
      const receipt: SavedAnalysisSnapshot = {
        ...written.value,
        primitive_entries: snapshot.value.entries.length,
        workflow_entries: snapshot.value.workflow_entries.length,
        evidence_records: snapshot.value.evidence_bundle.records.length,
      };
      const closed = await this.#closeActive(options);
      return closed.ok
        ? ok(receipt)
        : err(retainSavedAnalysisSnapshot(closed.error, receipt));
    });
  }

  async #closeActive(
    options: Pick<ExecutionOptions, "progress"> & {
      readonly retainProviderDocuments?: boolean;
    },
    clearRecords = true,
    onCleanupFailure?: (failure: AnalysisError) => void,
  ): Promise<Result<null, AnalysisError>> {
    const previous = this.#active;
    const previousResources = this.#activeBundleResources;
    this.#active = undefined;
    this.#activeBundleResources = undefined;
    if (previousResources !== undefined)
      this.#pendingBundleResourceCleanup.push(previousResources);
    const closed =
      previous === undefined
        ? await this.#retryPendingCleanup(
            options.progress,
            options.retainProviderDocuments,
            onCleanupFailure,
          )
        : await this.#retireClient(previous, {
            ...(options.progress === undefined
              ? {}
              : { progress: options.progress }),
            ...(options.retainProviderDocuments === true
              ? { retainDocument: true }
              : {}),
            ...(onCleanupFailure === undefined ? {} : { onCleanupFailure }),
          });
    if (clearRecords) this.clearSessionRecords();
    this.#clearRuntimeAvailability();
    const fileResources = await this.closeFileResources();
    if (!fileResources.ok) onCleanupFailure?.(fileResources.error);
    const candidateResources = await this.#providerRouter.closeOwnedResources();
    if (!candidateResources.ok) onCleanupFailure?.(candidateResources.error);
    const bundleClosed = await this.#retryPendingBundleResourceCleanup(
      options.progress,
      onCleanupFailure,
    );
    const resourceFailures = [
      ...(bundleClosed.ok ? [] : [bundleClosed.error]),
      ...(fileResources.ok ? [] : [fileResources.error]),
      ...(candidateResources.ok ? [] : [candidateResources.error]),
    ];
    let resourceFailure = resourceFailures[0];
    for (const next of resourceFailures.slice(1))
      if (resourceFailure !== undefined) {
        const previous = resourceFailure;
        resourceFailure = analysisErrorWithCleanupFailure(
          previous,
          next,
          "close_binary",
        );
        if (previous.cleanupIncomplete && next.cleanupIncomplete)
          resourceFailure.bindCleanupDependencies([previous, next]);
      }
    if (!closed.ok && resourceFailure !== undefined) {
      const combined = analysisErrorWithCleanupFailure(
        closed.error,
        resourceFailure,
        "close_binary",
      );
      if (closed.error.cleanupIncomplete && resourceFailure.cleanupIncomplete)
        combined.bindCleanupDependencies([closed.error, resourceFailure]);
      return err(combined);
    }
    if (!closed.ok) return closed;
    return resourceFailure === undefined ? ok(null) : err(resourceFailure);
  }

  async #retryPendingBundleResourceCleanup(
    progress?: ExecutionOptions["progress"],
    onCleanupFailure?: (failure: AnalysisError) => void,
  ): Promise<Result<null, AnalysisError>> {
    if (this.#pendingBundleResourceCleanup.length === 0) return ok(null);
    const pending = this.#pendingBundleResourceCleanup;
    const retained: ActiveBundleResourceSession[] = [];
    let failure: AnalysisError | undefined;
    for (const session of pending) {
      const closed = await closeAnalysisClient(
        session.client,
        "bundle-resources",
        {
          ...(progress === undefined ? {} : { progress }),
          ...(onCleanupFailure === undefined ? {} : { onCleanupFailure }),
        },
      );
      if (!closed.ok) {
        retained.push(session);
        const previous = failure;
        failure =
          previous === undefined
            ? closed.error
            : analysisErrorWithCleanupFailure(
                previous,
                closed.error,
                "close_binary",
              );
        if (
          previous?.cleanupIncomplete === true &&
          closed.error.cleanupIncomplete
        )
          failure.bindCleanupDependencies([previous, closed.error]);
      }
    }
    this.#pendingBundleResourceCleanup = retained;
    return failure === undefined ? ok(null) : err(failure);
  }

  async #retireClient(
    run: SessionRun,
    options: Pick<ExecutionOptions, "progress"> & {
      readonly retainDocument?: boolean;
      readonly onCleanupFailure?: (failure: AnalysisError) => void;
    } = {},
  ): Promise<Result<null, AnalysisError>> {
    this.#pendingCleanup = {
      run,
      retainDocument: options.retainDocument === true,
      failures: new Set(),
    };
    return this.#retryPendingCleanup(
      options.progress,
      undefined,
      options.onCleanupFailure,
    );
  }

  async #retryPendingCleanup(
    progress?: ExecutionOptions["progress"],
    retainDocument?: boolean,
    onCleanupFailure?: (failure: AnalysisError) => void,
  ): Promise<Result<null, AnalysisError>> {
    let pending = this.#pendingCleanup;
    if (pending === undefined) return ok(null);
    if (retainDocument !== undefined) {
      pending = { ...pending, retainDocument };
      this.#pendingCleanup = pending;
    }
    const closed = await closeAnalysisClient(
      pending.run.client,
      pending.run.route.identity.id,
      {
        ...(progress === undefined ? {} : { progress }),
        ...(pending.retainDocument ? { retainDocument: true } : {}),
        onCleanupFailure: (failure) => {
          if (failure.cleanupIncomplete) pending.failures.add(failure);
          onCleanupFailure?.(failure);
        },
      },
    );
    if (closed.ok) {
      for (const failure of pending.failures)
        if (!failure.hasCleanupOwner) failure.resolveCleanup();
      this.#pendingCleanup = undefined;
    } else if (closed.error.cleanupIncomplete) {
      pending.failures.add(closed.error);
    }
    return closed;
  }

  async #failedOpen(
    run: SessionRun,
    previous: SessionBinding | undefined,
    primary: AnalysisError,
    onCleanupFailure?: (failure: AnalysisError) => void,
  ): Promise<AnalysisError> {
    const closed = await this.#retireClient(
      run,
      onCleanupFailure === undefined ? {} : { onCleanupFailure },
    );
    if (!closed.ok)
      return sessionCleanupFailure(primary, closed.error, "open_binary");
    return this.#restoreAfterFailedOpen(previous, primary);
  }

  async #restoreAfterFailedOpen(
    previous: SessionBinding | undefined,
    primary: AnalysisError,
  ): Promise<AnalysisError> {
    const restored = await this.#restore(previous);
    if (restored.ok) return primary;
    primary.retainSecondaryFailure(restored.error, {
      restoration_error: projectAnalysisError(
        primaryAnalysisError(restored.error),
      ),
    });
    return restored.error.cleanupIncomplete
      ? sessionCleanupFailure(primary, restored.error, "open_binary")
      : primary;
  }

  /** Describe the active binary session. */
  status(
    options: {
      readonly signal?: AbortSignal;
      readonly detail?: BinarySessionDetail;
    } = {},
  ): Promise<JsonValue> {
    const resourceRun = this.#activeBundleResources;
    const run =
      this.#active ??
      resourceRun ??
      this.#pendingBundleResourceCleanup[0] ??
      this.#pendingCleanup?.run;
    const client = run?.client;
    return binarySessionStatus({
      ...options,
      target: this.#active?.target,
      ...(resourceRun === undefined
        ? {}
        : {
            bundleResourceRoot: resourceRun.root,
            resourceCapabilities: resourceRun.capabilities,
          }),
      route: this.#currentRoute(),
      router: this.#providerRouter,
      runtimeUnavailability: this.#runtimeUnavailability,
      runId: run?.runId,
      runtimeLineageSnapshots: client?.runtimeLineageSnapshots?.() ?? [],
      requestActivitySnapshots: client?.requestActivitySnapshots?.() ?? [],
      providerOperationHealth: client?.operationHealthSnapshot?.() ?? null,
      cleanupPending:
        this.#externalMutationCleanupFailure?.cleanupIncomplete === true ||
        this.#pendingCleanup !== undefined ||
        this.#pendingBundleResourceCleanup.length > 0 ||
        this.hasPendingFileResources ||
        this.#providerRouter.hasPendingOwnedResources(),
    });
  }

  /** Return the immutable artifact identity captured before its provider started. */
  activeTarget(): BinaryTarget | undefined {
    return this.#active === undefined
      ? undefined
      : structuredClone(this.#active.target);
  }

  activeBundleResourceRoot(): ResolvedAppBundleResourceRoot | undefined {
    const root = this.#activeBundleResources?.root;
    return root === undefined ? undefined : structuredClone(root);
  }

  override exportAnalysisSnapshot() {
    if (this.#activeBundleResources !== undefined)
      return err(new ResourceSnapshotMismatchError("export"));
    return super.exportAnalysisSnapshot();
  }

  override importAnalysisSnapshot(snapshot: AnalysisSnapshot) {
    if (this.#activeBundleResources !== undefined)
      return err(new ResourceSnapshotMismatchError("import"));
    return super.importAnalysisSnapshot(snapshot);
  }

  protected activeAnalysisBinding() {
    return this.#active;
  }

  /**
   * Invoke a provider operation against the active target.
   * Calls may overlap, but a pending target transition prevents new calls from
   * entering until the transition has settled.
   */
  execute(
    name: Parameters<AnalysisOperationPort["execute"]>[0],
    arguments_: Readonly<Record<string, JsonValue>>,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const generation = this.#transitionGeneration;
    const call = this.#execute(name, arguments_, options, this.#transition);
    this.#calls.set(call, generation);
    return call.finally(() => this.#calls.delete(call));
  }

  /** Run a prompt lookup only against an already connected provider child. */
  executeIfProviderReady(
    name: Parameters<AnalysisOperationPort["execute"]>[0],
    arguments_: Readonly<Record<string, JsonValue>>,
    options?: Pick<ExecutionOptions, "signal" | "selectorOrigin" | "workScope">,
  ): Promise<Result<AnalysisExecution, AnalysisError> | undefined> {
    const active = this.#active;
    if (
      this.#transitionPending > 0 ||
      active === undefined ||
      active.client.executeIfReady === undefined
    )
      return Promise.resolve(undefined);

    const controller = new AbortController();
    this.#promptCompletionControllers.add(controller);
    const signal =
      options?.signal === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, options.signal]);
    const generation = this.#transitionGeneration;
    const call = active.client.executeIfReady(name, arguments_, {
      ...options,
      signal,
    });
    this.#calls.set(call, generation);
    return call.finally(() => {
      this.#calls.delete(call);
      this.#promptCompletionControllers.delete(controller);
    });
  }

  /** Admit one composed request until its result and session bookkeeping settle. */
  withAdmittedAnalysis<Value>(
    operationName: string,
    signal: AbortSignal | undefined,
    operation: (analysis: AnalysisOperationPort) => Promise<Value>,
  ): Promise<Result<Value, AnalysisError>> {
    const generation = this.#transitionGeneration;
    const transition = this.#transition;
    const call = (async (): Promise<Result<Value, AnalysisError>> => {
      const admission = await this.#waitForTransition(
        operationName,
        signal,
        transition,
      );
      if (!admission.ok) return admission;
      return ok(
        await operation({
          resourceScope: this.resourceScope,
          execute: (name, arguments_, options) =>
            this.#execute(name, arguments_, options, Promise.resolve()),
        }),
      );
    })();
    // Register synchronously before a lifecycle transition can snapshot calls.
    this.#calls.set(call, generation);
    return call.finally(() => this.#calls.delete(call));
  }

  async #execute(
    name: Parameters<AnalysisOperationPort["execute"]>[0],
    arguments_: Readonly<Record<string, JsonValue>>,
    options: ExecutionOptions | undefined,
    transition: Promise<void>,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const transitioned = await this.#waitForTransition(
      name,
      options?.signal,
      transition,
    );
    if (!transitioned.ok) return transitioned;
    const resources = this.#activeBundleResources;
    if (resources !== undefined) {
      if (!BUNDLE_RESOURCE_OPERATIONS.has(name))
        return err(
          new AnalysisCapabilityUnavailableError(
            "bundle-resources",
            name,
            "This operation requires an executable analysis target; the active session contains only app resource access.",
          ),
        );
      const result = unrecordedExecution(
        await resources.client.execute(name, arguments_, options),
      );
      if (!result.ok) return result;
      const execution = { ...result.value, subject: null };
      return ok(execution);
    }
    const prepared = prepareSessionExecution({
      active: this.#active,
      operation: name,
      parameters: arguments_,
      nativeSourceAdmitted: this.#active?.nativeSourceAdmitted === true,
      unboundOperationError: (operation, route) =>
        this.#providerRouter.unboundOperationError(operation, route),
      lookupSnapshot: (target, profile, operation, parameters) =>
        this.lookupSnapshot(target, profile, operation, parameters),
    });
    if (!prepared.ok) return prepared;
    const { active, capability, profile, cacheable, cached } = prepared.value;
    if (cached !== undefined) return ok(cached);
    // A failed reply cannot prove that a dispatched metadata write rolled back.
    // Stop replay before dispatch, including reads overlapping the write.
    if (capability.effects.mutatesArtifact) this.invalidateSnapshot();
    const call = active.client.execute(name, arguments_, options);
    const result = unrecordedExecution(await call);
    const profiled = bindExecutionTarget(
      commitExecutionProfile(name, result, profile),
      name,
      active.target,
    );
    const execution =
      profiled.ok &&
      (name === "procedure_callers" || name === "procedure_callees") &&
      profiled.value.relationshipCoverage === undefined
        ? ok({
            ...profiled.value,
            relationshipCoverage: {
              status: "unknown" as const,
              reason:
                "Provider did not report relationship coverage for this observation.",
            },
          })
        : profiled;
    // A successful Ghidra operation proves this client's native source snapshot
    // was admitted; a composite health response and parsed path do not.
    if (
      execution.ok &&
      capability.provider.id === "ghidra" &&
      this.#active === active
    )
      this.#active.nativeSourceAdmitted = true;
    this.#observeRuntimeAvailability(name, execution);
    // Source facts belong to the observation, even when this query cannot be
    // replayed (for example a Ghidra procedure read without a document selector).
    if (execution.ok && execution.value.sourceEvidence !== undefined) {
      const sourcesRecorded = recordEvidenceSources(
        (source) => this.recordEvidence(source),
        execution.value.sourceEvidence,
      );
      if (!sourcesRecorded.ok) return sourcesRecorded;
    }
    if (
      execution.ok &&
      isSourceEvidenceRetainable(name, capability, arguments_) &&
      profile !== undefined
    ) {
      const evidence = createAnalysisExecutionEvidence(
        name,
        arguments_,
        {
          ...execution.value,
          analysisProfile: profile,
          subject:
            execution.value.subject === undefined
              ? active.target
              : execution.value.subject,
        },
        "observed",
      );
      const recorded = this.recordEvidence(evidence);
      if (!recorded.ok) return recorded;
      const retained = { ...execution.value, evidenceId: evidence.evidence_id };
      if (cacheable && execution.value.cachePolicy !== "live")
        this.recordSnapshot({
          target: active.target,
          profile,
          operation: name,
          parameters: arguments_,
          execution: retained,
        });
      return ok(retained);
    }
    return execution;
  }

  #observeRuntimeAvailability(
    operation: AnalysisOperation,
    result: Result<AnalysisExecution, AnalysisError>,
  ): void {
    if (result.ok) {
      if (this.#markRuntimeAvailable(operation))
        this.#emitAvailabilityChanged();
      return;
    }
    if (result.error._tag === "AnalysisCapabilityUnavailableError") {
      if (this.#markRuntimeUnavailable(operation, result.error.message))
        this.#emitAvailabilityChanged();
      return;
    }
    if (
      [
        "ProviderAdapterError",
        "HopperProcessError",
        "HopperStartError",
      ].includes(result.error._tag)
    ) {
      const capabilities = this.#active?.route.capabilities;
      const providerId = capabilities?.get(operation)?.provider.id;
      let changed = false;
      for (const descriptor of capabilities?.values() ?? [])
        if (providerId !== undefined && descriptor.provider.id === providerId)
          changed =
            this.#markRuntimeUnavailable(
              descriptor.operation,
              `${result.error._tag}: ${result.error.message}`,
            ) || changed;
      if (changed) this.#emitAvailabilityChanged();
    }
  }

  #markRuntimeAvailable(operation: string): boolean {
    return this.#runtimeUnavailability.delete(operation);
  }

  #markRuntimeUnavailable(operation: string, reason: string): boolean {
    const current = this.#runtimeUnavailability.get(operation);
    if (current?.reason === reason) return false;
    this.#runtimeUnavailability.set(operation, { reason });
    return true;
  }

  #clearRuntimeAvailability(): void {
    if (this.#runtimeUnavailability.size === 0) return;
    this.#runtimeUnavailability.clear();
    this.#emitAvailabilityChanged();
  }

  #emitAvailabilityChanged(): void {
    for (const listener of this.#availabilityListeners) {
      try {
        const notification = listener();
        if (notification !== undefined) {
          // best-effort cleanup: async observer notifications must not reject
          // unhandled; state transitions and other listeners continue.
          void notification.catch(() => undefined);
        }
      } catch (cause: unknown) {
        // External observers are best-effort notifications. Contain only the
        // callback failure so state transitions and other listeners continue.
        void cause;
      }
    }
  }

  #currentRoute(): SessionProviderRoute {
    return this.#active?.route ?? this.#providerRouter.initialRoute();
  }

  #serialize<T>(
    operation: (admittedThrough: number) => Promise<T>,
  ): Promise<T> {
    for (const controller of this.#promptCompletionControllers)
      controller.abort();
    this.#transitionPending += 1;
    // Later calls wait for this transition and must not be included in its drain.
    const admittedThrough = this.#transitionGeneration++;
    const result = this.#transition.then(
      () => operation(admittedThrough),
      () => operation(admittedThrough),
    );
    this.#transition = result.then(
      () => undefined,
      () => undefined,
    );
    void result.then(
      () => {
        this.#transitionPending -= 1;
      },
      () => {
        this.#transitionPending -= 1;
      },
    );
    return result;
  }

  async #drainCalls(admittedThrough: number): Promise<void> {
    await Promise.allSettled(
      [...this.#calls]
        .filter(([, generation]) => generation <= admittedThrough)
        .map(([call]) => call),
    );
  }

  /**
   * Probe whether a retained provider client is still live.
   *
   * On production routes the client is a CompositeProvider whose `health`
   * answers unconditionally ok without touching a child, so `health` alone
   * cannot see a dead child. `operationHealthSnapshot` reaches the
   * instantiated children instead. Only the known-live states allow the
   * fast path: `exited`/`unreachable` are dead, `unknown` is never
   * evidence of health (it is what a recorded but uncharacterized failure
   * reports), and `not_started` is a startup that never completed — in the
   * Hopper timeout case the client holds retained resources that block the
   * next `start()` until `close()` retries cleanup, so treating it as live
   * would skip the retire path and hand the wedged client to subsequent
   * analysis. The gate fails closed: without a snapshot signal, fall back
   * to the `health` admission probe.
   */
  async #retainedClientLive(
    client: AnalysisClient,
    options: Pick<BinarySessionOpenOptions, "signal">,
  ): Promise<boolean> {
    if (client.reuseReadiness?.() === "blocked") return false;
    const snapshot = client.operationHealthSnapshot?.();
    if (snapshot !== undefined)
      return snapshot.state === "idle" || snapshot.state === "busy";
    try {
      return (await client.execute("health", {}, options)).ok;
    } catch {
      return false;
    }
  }

  async #restore(
    previous: SessionBinding | undefined,
  ): Promise<Result<null, AnalysisError>> {
    if (previous === undefined) return ok(null);
    const runId = randomUUID();
    const client = previous.route.createClient(previous.target, {
      runId,
    });
    const run: SessionRun = { client, route: previous.route, runId };
    const started = await client.execute("health", {});
    if (started.ok) {
      this.#active = {
        ...previous,
        ...run,
        nativeSourceAdmitted: false,
      };
      this.#clearRuntimeAvailability();
      return ok(null);
    }
    const closed = await this.#retireClient(run);
    return closed.ok
      ? err(started.error)
      : err(sessionCleanupFailure(started.error, closed.error, "open_binary"));
  }

  async #waitForTransition(
    operation: string,
    signal: AbortSignal | undefined,
    transition: Promise<void>,
  ): Promise<Result<undefined, AnalysisCancelledError>> {
    if (signal?.aborted === true)
      return err(
        new AnalysisCancelledError(operation, { cause: signal.reason }),
      );
    if (signal === undefined) {
      await transition;
      return ok(undefined);
    }
    return new Promise((resolve) => {
      const onAbort = (): void => {
        resolve(
          err(new AnalysisCancelledError(operation, { cause: signal.reason })),
        );
      };
      signal.addEventListener("abort", onAbort, { once: true });
      transition.then(
        () => {
          signal.removeEventListener("abort", onAbort);
          resolve(
            signal.aborted
              ? err(
                  new AnalysisCancelledError(operation, {
                    cause: signal.reason,
                  }),
                )
              : ok(undefined),
          );
        },
        () => {
          signal.removeEventListener("abort", onAbort);
          resolve(
            signal.aborted
              ? err(
                  new AnalysisCancelledError(operation, {
                    cause: signal.reason,
                  }),
                )
              : ok(undefined),
          );
        },
      );
    });
  }
}

const isAborted = (signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true;
