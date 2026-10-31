import type {
  AnalysisClient,
  RetainedResourceScope,
  ProviderRuntimeLineageSnapshot,
  ProviderRequestActivitySnapshot,
} from "../application/AnalysisProvider.js";
import type { ProviderOperationHealth } from "../domain/providerOperationHealth.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { err } from "../domain/result.js";
import { AnalysisClientCreation } from "./AnalysisClientCreation.js";

/** Expose a closeable client before deferred prerequisite work starts. */
export class DeferredAnalysisClient implements AnalysisClient {
  readonly #creation: AnalysisClientCreation;
  readonly #providerId: string;

  executeIfReady: NonNullable<AnalysisClient["executeIfReady"]> = (
    operation,
    parameters,
    options,
  ) =>
    this.#creation.readyClient?.executeIfReady?.(
      operation,
      parameters,
      options,
    ) ?? Promise.resolve(undefined);

  constructor(
    loadClient: (
      signal: AbortSignal,
      resourceOwner: RetainedResourceScope,
    ) => Promise<AnalysisClient>,
    providerId: string,
  ) {
    this.#creation = new AnalysisClientCreation(providerId, loadClient);
    this.#providerId = providerId;
  }

  execute: AnalysisClient["execute"] = async (
    operation,
    parameters,
    options,
  ) => {
    try {
      const loaded = await this.#creation.acquire(operation, options?.signal);
      if (!loaded.ok) return loaded;
      if (this.#creation.readyClient !== loaded.value)
        return err(
          new ProviderAdapterError(this.#providerId, operation, {
            diagnostics: { reason: "client_closed" },
          }),
        );
      return await loaded.value.execute(operation, parameters, options);
    } catch (cause: unknown) {
      if (cause instanceof AnalysisError) return err(cause);
      return err(
        new ProviderAdapterError(this.#providerId, operation, {
          cause,
        }),
      );
    }
  };

  runtimeLineageSnapshots(): readonly ProviderRuntimeLineageSnapshot[] {
    return this.#creation.ownedClient?.runtimeLineageSnapshots?.() ?? [];
  }

  requestActivitySnapshots(): readonly ProviderRequestActivitySnapshot[] {
    return this.#creation.ownedClient?.requestActivitySnapshots?.() ?? [];
  }

  reuseReadiness(): "ready" | "blocked" | "unknown" {
    if (!this.#creation.reusable || this.#creation.readyClient === undefined)
      return "blocked";
    return this.#creation.readyClient.reuseReadiness?.() ?? "unknown";
  }

  operationHealthSnapshot(): ProviderOperationHealth | undefined {
    return this.#creation.ownedClient?.operationHealthSnapshot?.();
  }

  close: AnalysisClient["close"] = (options) => this.#creation.close(options);
}
