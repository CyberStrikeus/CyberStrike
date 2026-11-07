import type {
  AnalysisExecution,
  ExecutionOptions,
  ProviderAvailability,
} from "../AnalysisProvider.js";
import type { ApktoolRequest } from "../../domain/apktool/apktoolResourceAnalysis.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { Result } from "../../domain/result.js";

/**
 * Apktool resource-decoding boundary over a caller-selected launcher.
 * Implementation details belong to the provider adapter.
 */
export interface ApktoolResourceAnalysisPort {
  /** Probe the selected apktool launcher without decoding anything. */
  inspectAvailability(signal?: AbortSignal): Promise<ProviderAvailability>;
  /** The provider owns only per-call workspaces; safe to call always. */
  close(): Promise<void>;
  execute(
    request: ApktoolRequest,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>>;
}
