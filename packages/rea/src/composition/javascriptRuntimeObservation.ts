import type { AnalysisSettingsReader } from "../domain/analysisSettings.js";
import { runtimeAsarHeaderAdmission } from "../config/runtimeAnalysisSettings.js";
import type { JavaScriptRuntimeObservationPort } from "../application/javascript/JavaScriptRuntimeObservationPort.js";
import {
  V8InspectorAdmission,
  V8InspectorProvider,
} from "../inspector/V8InspectorProvider.js";

export { V8InspectorAdmission };

/** Construct a fresh provider without opening a target or acquiring an engine. */
export const createJavaScriptRuntimeObservationProvider = (
  environment: Readonly<Record<string, string | undefined>>,
  settings?: AnalysisSettingsReader,
  admission?: V8InspectorAdmission,
): JavaScriptRuntimeObservationPort =>
  new V8InspectorProvider(
    runtimeAsarHeaderAdmission(environment, settings),
    admission,
  );
