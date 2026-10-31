import type { JebAnalysisPort } from "../application/jeb/JebAnalysisPort.js";
import { parseJebMcpTimeoutMs } from "../config/environment.js";
import { ConfigurationError } from "../domain/configurationErrors.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { err } from "../domain/result.js";
import type { JebMcpConnectionFactory } from "../jeb/JebMcpConnection.js";
import { JebProvider } from "../jeb/JebProvider.js";

/**
 * Construct one JEB provider bound to the caller-selected MCP endpoint. An
 * unusable endpoint makes only JEB unavailable; every other CLI command and
 * MCP tool is composed alongside it.
 */
export const createJebAnalysisProvider = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
  connectionFactory?: JebMcpConnectionFactory,
): JebAnalysisPort => {
  const requestTimeout = parseJebMcpTimeoutMs(
    environment.REA_JEB_MCP_TIMEOUT_MS,
  );
  if (!requestTimeout.ok) return unconfiguredJebProvider(requestTimeout.error);
  try {
    return new JebProvider({
      environment,
      ...(requestTimeout.value === undefined
        ? {}
        : {
            requestTimeoutMs: requestTimeout.value,
            discoveryTimeoutMs: requestTimeout.value,
          }),
      ...(connectionFactory === undefined ? {} : { connectionFactory }),
    });
  } catch (cause: unknown) {
    if (!(cause instanceof AnalysisInputError)) throw cause;
    const constraint =
      typeof cause.cause === "string" ? cause.cause : cause.message;
    return unconfiguredJebProvider(
      new ConfigurationError("Invalid REA environment configuration", {
        cause,
        settings: [{ setting: "REA_JEB_MCP_URL", constraint }],
      }),
    );
  }
};

const unconfiguredJebProvider = (
  error: ConfigurationError,
): JebAnalysisPort => {
  const setting = error.settings[0]?.setting ?? "REA_JEB_MCP_URL";
  return {
    inspectAvailability: () =>
      Promise.resolve({
        status: "unavailable",
        code: "not_configured",
        reason: `${setting} is invalid: ${error.settings[0]?.constraint ?? error.message}`,
        diagnostics: { setting },
      }),
    close: () => Promise.resolve(),
    execute: () => Promise.resolve(err(error)),
  };
};
