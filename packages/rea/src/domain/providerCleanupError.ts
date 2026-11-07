import type { JsonValue } from "./jsonValue.js";
import { ProviderAdapterError } from "./providerAdapterError.js";
import type {
  AnalysisErrorOptions,
  AnalysisPartialObservation,
} from "./analysisErrorBase.js";

/** Provider resources could not be proven closed after bounded cleanup. */
export class ProviderCleanupError extends ProviderAdapterError {
  override cleanupIncomplete = true;
  override readonly userMessage =
    "Provider cleanup could not be fully confirmed. Review the reported local resources before opening another target.";

  /** Producer-attested completed output; ordinary partial observations cannot recover success. */
  readonly completedObservation: AnalysisPartialObservation | undefined;

  constructor(
    providerId: string,
    resources: readonly string[],
    diagnostics: Readonly<Record<string, JsonValue>>,
    /** Identify the operation owning these resources; binary callers retain their default. */
    options?: Omit<AnalysisErrorOptions, "diagnostics"> & {
      readonly operation?: string;
      readonly remediationAction?: string;
      readonly completedObservation?: AnalysisPartialObservation;
    },
  ) {
    const {
      operation = "close_binary",
      completedObservation,
      ...errorOptions
    } = options ?? {};
    super(providerId, operation, {
      ...errorOptions,
      diagnostics,
    });
    this.completedObservation = completedObservation;
    this.setCleanupResources(resources);
  }
}
