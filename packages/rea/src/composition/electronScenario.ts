import type { ElectronActiveObservationPort } from "../application/javascript/ElectronActiveObservationPort.js";
import { PlaywrightElectronActiveProvider } from "../browser/PlaywrightElectronActiveProvider.js";

/** Construct a fresh provider without opening a target or acquiring an engine. */
export const createElectronScenarioProvider = (
  environment: Readonly<Record<string, string | undefined>>,
): ElectronActiveObservationPort =>
  new PlaywrightElectronActiveProvider(environment);
