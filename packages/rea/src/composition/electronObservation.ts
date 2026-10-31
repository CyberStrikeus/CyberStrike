import type { AnalysisSettingsReader } from "../domain/analysisSettings.js";
import { runtimeAsarHeaderAdmission } from "../config/runtimeAnalysisSettings.js";
import type { ElectronObservationPort } from "../application/javascript/ElectronObservationPort.js";
import { CdpElectronProvider } from "../browser/CdpElectronProvider.js";

/** Construct a fresh provider without opening a target or acquiring an engine. */
export const createElectronObservationProvider = (
  environment: Readonly<Record<string, string | undefined>>,
  settings?: AnalysisSettingsReader,
): ElectronObservationPort =>
  new CdpElectronProvider(runtimeAsarHeaderAdmission(environment, settings));
