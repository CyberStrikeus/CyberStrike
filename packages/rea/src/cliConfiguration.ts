import { parseLogLevel } from "./config/processStart.js";
import { projectAnalysisError } from "./domain/analysisErrorProjection.js";

/**
 * Describe invalid CLI settings before loading command implementations.
 * CLI, MCP and Doctor share the process-start configuration contract.
 */
export const cliConfigurationError = (
  selectedEnvironment: Readonly<Record<string, string | undefined>>,
): string | undefined => {
  const value = selectedEnvironment.REA_LOG_LEVEL;
  if (value === undefined) return undefined;
  const level = parseLogLevel(value);
  return level.ok ? undefined : projectAnalysisError(level.error).message;
};
