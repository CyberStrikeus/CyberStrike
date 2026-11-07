import type { BrowserScenario } from "../../src/domain/browserScenario.js";
import { BrowserScenarioSecrets } from "../../src/browser/BrowserScenarioSecrets.js";

/** Resolve valid fixture declarations, failing with the producer's typed input error. */
export const resolveScenarioSecrets = (
  scenario: BrowserScenario,
  environment: Readonly<Record<string, string | undefined>>,
): BrowserScenarioSecrets => {
  const result = BrowserScenarioSecrets.resolve(scenario, environment);
  if (!result.ok) throw result.error;
  return result.value;
};
