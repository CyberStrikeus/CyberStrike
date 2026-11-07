import type { BrowserObservationPort } from "./BrowserObservationPort.js";
import type { BrowserScenarioCapturePort } from "./BrowserScenarioCapturePort.js";
import type { ElectronObservationPort } from "./javascript/ElectronObservationPort.js";
import type { ElectronActiveObservationPort } from "./javascript/ElectronActiveObservationPort.js";
import type { JavaScriptRuntimeObservationPort } from "./javascript/JavaScriptRuntimeObservationPort.js";
import { AnalysisCapabilityUnavailableError } from "../domain/analysisErrorCore.js";

/** Existing observation ports loaded independently at MCP startup. */
export interface OptionalObservationProviders {
  readonly browserObservation?: BrowserObservationPort;
  readonly browserScenarioCapture?: BrowserScenarioCapturePort;
  readonly electronObservation?: ElectronObservationPort;
  readonly electronActiveObservation?: ElectronActiveObservationPort;
  readonly javascriptRuntimeObservation?: JavaScriptRuntimeObservationPort;
}

/** A module failed before its port could be constructed; no engine was opened. */
export interface OptionalProviderLoadFailure {
  readonly providerId: string;
  readonly reason: string;
}

export type OptionalProviderLoadFailures = Readonly<
  Partial<
    Record<
      keyof OptionalObservationProviders | "fridaInstrumentation",
      OptionalProviderLoadFailure
    >
  >
>;

/** Successful ports and failed peers from one independent loading attempt. */
export interface OptionalProviderLoadResult extends OptionalObservationProviders {
  readonly optionalProviderLoadFailures?: OptionalProviderLoadFailures;
}

/** Preserve the module's failure reason through the existing tool error algebra. */
export const optionalProviderUnavailable = (
  failure: OptionalProviderLoadFailure,
  operation: string,
): AnalysisCapabilityUnavailableError =>
  new AnalysisCapabilityUnavailableError(
    failure.providerId,
    operation,
    `Adapter could not load: ${failure.reason}`,
  );
