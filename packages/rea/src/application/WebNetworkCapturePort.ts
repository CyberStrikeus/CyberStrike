import type { ExecutionOptions } from "./AnalysisProvider.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { Result } from "../domain/result.js";
import type {
  InspectWebNetworkCaptureInput,
  WebNetworkCapture,
} from "../domain/webNetworkCapture.js";

/** Replaceable offline capture port; producer protocols remain in format adapters. */
export interface WebNetworkCapturePort {
  inspect(
    input: InspectWebNetworkCaptureInput,
    options?: ExecutionOptions,
  ): Promise<Result<WebNetworkCapture, AnalysisError>>;
  /** Retry retained reader/runtime cleanup when the owning service shuts down. */
  close?(): Promise<void>;
}
