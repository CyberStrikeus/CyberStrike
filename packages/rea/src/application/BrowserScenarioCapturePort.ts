import type { ExecutionOptions, ProviderIdentity } from "./AnalysisProvider.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { BrowserScenario } from "../domain/browserScenario.js";
import type { BrowserScenarioCapture } from "../domain/browserScenarioCapture.js";
import type { Result } from "../domain/result.js";

/** Provider-neutral application boundary for controlled browser scenarios. */
export interface BrowserScenarioCapturePort {
  close?(): Promise<void>;
  identity(): ProviderIdentity;
  captureScenario(
    scenario: BrowserScenario,
    options?: ExecutionOptions,
  ): Promise<Result<BrowserScenarioCapture, AnalysisError>>;
}
