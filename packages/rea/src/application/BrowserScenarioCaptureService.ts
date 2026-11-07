import type { ExecutionOptions } from "./AnalysisProvider.js";
import type { BrowserScenarioCapturePort } from "./BrowserScenarioCapturePort.js";
import { createBrowserScenarioEvidence } from "./BrowserScenarioEvidence.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { Evidence } from "../domain/evidence.js";
import type { BrowserScenario } from "../domain/browserScenario.js";
import { err, type Result } from "../domain/result.js";
import { browserScenarioCaptureSchema } from "../domain/browserScenarioCapture.js";
import {
  completeProviderEvidence,
  keepIncompleteObservation,
} from "./ProviderOperationExecution.js";

const OPERATION = "capture_browser_scenario" as const;
const PROVIDER_ID = "rea-playwright-browser-scenario";

/** Execute one controlled browser scenario using its explicit request scope. */
export const captureBrowserScenario = async (
  provider: BrowserScenarioCapturePort | undefined,
  scenario: BrowserScenario,
  options: ExecutionOptions = {},
): Promise<Result<Evidence, AnalysisError>> => {
  if (provider === undefined)
    return err(
      new AnalysisCapabilityUnavailableError(
        PROVIDER_ID,
        OPERATION,
        "browser scenario provider is not configured",
      ),
    );
  if (options.signal?.aborted)
    return err(
      new AnalysisCancelledError(OPERATION, { cause: options.signal.reason }),
    );
  const captured = await provider.captureScenario(scenario, options);
  if (!captured.ok) {
    const partial = captured.error.partialObservation;
    if (
      partial !== undefined &&
      "kind" in partial &&
      partial.kind === "browser-scenario-observation"
    ) {
      const report = browserScenarioCaptureSchema.safeParse(partial.capture);
      // Only a completed capture becomes Evidence. A JSON-safe incomplete
      // observation stays on the owner error, including typed cancellation.
      if (
        report.success &&
        report.data.steps.every(({ status }) => status === "completed")
      ) {
        captured.error.partialObservation = createBrowserScenarioEvidence(
          scenario,
          report.data,
          provider.identity(),
        );
        return captured;
      }
    }
    return err(
      keepIncompleteObservation(
        captured.error,
        OPERATION,
        "Browser scenario provider retained a non-JSON incomplete observation.",
      ),
    );
  }
  const report = browserScenarioCaptureSchema.safeParse(captured.value);
  if (!report.success)
    return err(
      new AnalysisOutputError(
        OPERATION,
        "Browser scenario provider returned a malformed completed capture.",
        { cause: report.error },
      ),
    );
  return completeProviderEvidence(
    createBrowserScenarioEvidence(scenario, report.data, provider.identity()),
    options.signal,
  );
};
