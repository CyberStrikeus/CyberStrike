import { analysisClientFailureForOperation } from "./AnalysisClientFailure.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { bindArtifactFileCleanup } from "../artifacts/ArtifactFileOperation.js";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type {
  AnalysisClient,
  RetainedResourceScope,
} from "../application/AnalysisProvider.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { err, ok, type Result } from "../domain/result.js";
import { SharedStartupAttempt } from "../process/SharedStartupAttempt.js";
import { closeAnalysisClient } from "../application/AnalysisClientCleanup.js";

/** Own deferred client creation while callers wait independently and close joins it. */
export class AnalysisClientCreation {
  readonly #inspectionResources = new ArtifactResourceScope();
  readonly #inspectionOwner: RetainedResourceScope = {
    retain: (owner, resource) =>
      this.#inspectionResources.retain({
        kind: "lease",
        resource,
        lease: AnalysisCleanupLease.forCloseOwner(owner, resource),
      }),
    run: (operation) => this.#inspectionResources.run(operation),
  };
  #attempt:
    | SharedStartupAttempt<Result<AnalysisClient, AnalysisError>>
    | undefined;
  #client: AnalysisClient | undefined;
  #failure: AnalysisError | undefined;
  #closed = false;
  #clientLease: AnalysisCleanupLease | undefined;
  #closing: Promise<Result<null, AnalysisError>> | undefined;
  #closeOptions: Parameters<AnalysisClient["close"]>[0];

  constructor(
    private readonly providerId: string,
    private readonly create: (
      signal: AbortSignal,
      resourceOwner: RetainedResourceScope,
    ) => Promise<AnalysisClient>,
  ) {}

  get ownedClient(): AnalysisClient | undefined {
    return this.#client;
  }
  get readyClient(): AnalysisClient | undefined {
    return this.#closed ||
      this.#attempt !== undefined ||
      this.#failure !== undefined
      ? undefined
      : this.#client;
  }
  get reusable(): boolean {
    return (
      !this.#closed &&
      this.#attempt === undefined &&
      this.#failure === undefined &&
      this.#clientLease?.released !== true
    );
  }
  async acquire(
    operation: string,
    signal?: AbortSignal,
  ): Promise<Result<AnalysisClient, AnalysisError>> {
    if (signal?.aborted)
      return err(
        new AnalysisCancelledError(operation, { cause: signal.reason }),
      );
    if (this.#closed)
      return err(
        new ProviderAdapterError(this.providerId, operation, {
          diagnostics: { reason: "client_closed" },
        }),
      );
    if (this.#failure?.cleanupIncomplete)
      return err(
        analysisClientFailureForOperation(
          this.#failure,
          this.providerId,
          operation,
        ),
      );
    const ready = this.readyClient;
    if (ready !== undefined && this.#clientLease?.released !== true)
      return ok(ready);
    if (this.#clientLease?.released === true) {
      this.#client = undefined;
      this.#clientLease = undefined;
    }
    let attempt = this.#attempt;
    if (attempt === undefined) {
      this.#failure = undefined;
      attempt = new SharedStartupAttempt((ownerSignal) =>
        Promise.resolve().then(() => this.#createOwned(ownerSignal)),
      );
      const owned = attempt;
      this.#attempt = owned;
      void owned.promise.then((result) => {
        if (!result.ok) this.#failure = result.error;
        if (this.#attempt === owned) this.#attempt = undefined;
      });
    }
    const waited = await attempt.wait(signal);
    if (waited.status === "cancelled")
      return err(
        new AnalysisCancelledError(operation, { cause: signal?.reason }),
      );
    if (!waited.value.ok)
      return err(
        analysisClientFailureForOperation(
          waited.value.error,
          this.providerId,
          operation,
        ),
      );
    if (signal?.aborted)
      return err(
        new AnalysisCancelledError(operation, { cause: signal.reason }),
      );
    return waited.value;
  }

  async #createOwned(
    signal: AbortSignal,
  ): Promise<Result<AnalysisClient, AnalysisError>> {
    if (signal.aborted)
      return err(
        new AnalysisCancelledError("create_analysis_client", {
          cause: signal.reason,
        }),
      );
    let primary: AnalysisError | undefined;
    try {
      this.#client = await this.create(signal, this.#inspectionOwner);
    } catch (cause: unknown) {
      primary =
        cause instanceof AnalysisError
          ? cause
          : new ProviderAdapterError(
              this.providerId,
              "create_analysis_client",
              { cause },
            );
    }
    const inspections = await this.#cleanupInspectionResources(() =>
      this.#inspectionResources.retryCleanup(),
    );
    if (signal.aborted && primary === undefined)
      primary = new AnalysisCancelledError("create_analysis_client", {
        cause: signal.reason,
      });
    if (!inspections.ok)
      primary =
        primary === undefined
          ? inspections.error
          : analysisErrorWithCleanupFailure(
              primary,
              inspections.error,
              "create_analysis_client",
            ).bindCleanupDependencies([primary, inspections.error]);
    if (primary !== undefined) {
      const closed = await this.#releaseClient(this.#closeOptions);
      return err(
        closed.ok
          ? primary
          : analysisErrorWithCleanupFailure(
              primary,
              closed.error,
              "create_analysis_client",
            ).bindCleanupDependencies([primary, closed.error]),
      );
    }
    if (this.#client === undefined)
      throw new Error("Client creation completed without a client");
    return ok(this.#client);
  }

  async #cleanupInspectionResources(
    cleanup: () => Promise<void>,
  ): Promise<Result<null, AnalysisError>> {
    try {
      await cleanup();
      return ok(null);
    } catch (cause: unknown) {
      const observation = ArtifactReaderFailure.cleanupObservation(
        cause,
        "client prerequisite resources",
      );
      const failure = new ProviderCleanupError(
        this.providerId,
        observation.resources,
        { reason: observation.reason },
        { cause, operation: "create_analysis_client" },
      );
      bindArtifactFileCleanup(cause, failure);
      return err(failure);
    }
  }

  close(
    options?: Parameters<AnalysisClient["close"]>[0],
  ): Promise<Result<null, AnalysisError>> {
    this.#closed = true;
    this.#closeOptions = options;
    this.#attempt?.close();
    this.#closing ??= Promise.resolve()
      .then(async () => {
        await this.#attempt?.promise;
        const inspections = await this.#cleanupInspectionResources(() =>
          this.#inspectionResources.close(),
        );
        const inspectionFailure = inspections.ok
          ? undefined
          : inspections.error;
        const closed = await this.#releaseClient(options);
        if (!closed.ok && inspectionFailure !== undefined)
          return err(
            analysisErrorWithCleanupFailure(
              closed.error,
              inspectionFailure,
              "create_analysis_client",
            ).bindCleanupDependencies([closed.error, inspectionFailure]),
          );
        if (!closed.ok) return closed;
        if (inspectionFailure !== undefined) return err(inspectionFailure);
        return this.#failure?.cleanupIncomplete ? err(this.#failure) : ok(null);
      })
      .finally(() => {
        this.#closing = undefined;
      });
    return this.#closing;
  }

  async #releaseClient(
    options: Parameters<AnalysisClient["close"]>[0],
  ): Promise<Result<null, AnalysisError>> {
    if (this.#client === undefined) return ok(null);
    const client = this.#client;
    this.#closeOptions = options;
    this.#clientLease ??= new AnalysisCleanupLease(async () => {
      const result = await closeAnalysisClient(
        client,
        this.providerId,
        this.#closeOptions,
      );
      if (!result.ok) throw result.error;
    });
    try {
      await this.#clientLease.release();
      return ok(null);
    } catch (cause: unknown) {
      const failure = new ProviderCleanupError(
        this.providerId,
        cause instanceof AnalysisError && cause.cleanupResources.length > 0
          ? cause.cleanupResources
          : ["provider-client"],
        {
          reason:
            "Client creation retains its exact client until close confirms release",
          ...(cause instanceof AnalysisError
            ? { client_close_failure: projectAnalysisError(cause) }
            : {}),
        },
        { cause, operation: "create_analysis_client" },
      );
      failure.bindCleanupResourceOwner(this.#clientLease);
      this.#clientLease.bindCleanupError(failure);
      return err(failure);
    }
  }
}
