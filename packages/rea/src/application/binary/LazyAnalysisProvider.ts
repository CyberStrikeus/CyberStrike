import type { AnalysisProfileCommitment } from "../../domain/analysisProfile.js";
import type { BinaryTarget } from "../../domain/binaryTargetTypes.js";
import { AnalysisCancelledError } from "../../domain/analysisErrorCore.js";
import { DeferredAnalysisClient } from "../../providers/DeferredAnalysisClient.js";
import type {
  AnalysisClient,
  AnalysisClientContext,
  AnalysisProvider,
  CapabilityDescriptor,
  ProviderIdentity,
} from "../AnalysisProvider.js";

type LoadAnalysisProvider = () => Promise<AnalysisProvider>;

/**
 * Preserve synchronous provider discovery while loading implementation modules
 * only when a target-bound client first executes.
 */
export class LazyAnalysisProvider implements AnalysisProvider {
  readonly #providerIdentity: ProviderIdentity;
  readonly #capabilityDescriptors: readonly CapabilityDescriptor[];
  readonly #loadProvider: LoadAnalysisProvider;
  #provider: Promise<AnalysisProvider> | undefined;

  constructor(options: {
    readonly identity: ProviderIdentity;
    readonly capabilities: readonly CapabilityDescriptor[];
    readonly load: LoadAnalysisProvider;
  }) {
    this.#providerIdentity = options.identity;
    this.#capabilityDescriptors = options.capabilities;
    this.#loadProvider = options.load;
  }

  /** Return source-declared provider identity without loading its implementation. */
  identity(): ProviderIdentity {
    return this.#providerIdentity;
  }

  /** Return source-declared capability metadata without loading its implementation. */
  capabilities(): readonly CapabilityDescriptor[] {
    return this.#capabilityDescriptors;
  }

  /** Create a client whose implementation is loaded on first execution. */
  createClient(
    target: BinaryTarget,
    profile?: AnalysisProfileCommitment,
    context?: AnalysisClientContext,
  ): AnalysisClient {
    return new DeferredAnalysisClient(async (signal) => {
      const provider = await this.#load();
      if (signal.aborted)
        throw new AnalysisCancelledError("create_analysis_client", {
          cause: signal.reason,
        });
      return provider.createClient(target, profile, context);
    }, this.#providerIdentity.id);
  }

  async #load(): Promise<AnalysisProvider> {
    this.#provider ??= this.#loadProvider().catch((cause: unknown) => {
      this.#provider = undefined;
      throw cause;
    });
    return this.#provider;
  }
}
