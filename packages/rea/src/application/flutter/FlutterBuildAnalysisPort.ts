import type {
  AnalysisExecution,
  ExecutionOptions,
  ProviderAvailability,
} from "../AnalysisProvider.js";
import type { FlutterRequest } from "../../domain/flutter/flutterBuildAnalysis.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { Result } from "../../domain/result.js";

/**
 * Flutter build-identification boundary by pure APK parsing.
 * Implementation details belong to the provider adapter.
 */
export interface FlutterBuildAnalysisPort {
  /** Pure parsing; always available. */
  inspectAvailability(signal?: AbortSignal): Promise<ProviderAvailability>;
  /** The provider holds no long-lived resources; safe to call always. */
  close(): Promise<void>;
  execute(
    request: FlutterRequest,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>>;
}
