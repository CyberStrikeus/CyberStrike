import { BROWSER_SCENARIO_TOOL_CONTRACTS } from "./browserScenarioToolContracts.js";
import { BROWSER_TOOL_CONTRACTS } from "./browserToolContracts.js";

/** Complete ordered browser-provider contract inventory. */
export const BROWSER_PROVIDER_TOOL_CONTRACTS = [
  ...BROWSER_TOOL_CONTRACTS,
  ...BROWSER_SCENARIO_TOOL_CONTRACTS,
] as const;
