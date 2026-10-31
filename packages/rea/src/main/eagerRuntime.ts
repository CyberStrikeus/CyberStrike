import { AnalysisSettings } from "../application/AnalysisSettings.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";

import type { AppConfig } from "../config/types.js";
import { ok } from "../domain/result.js";
import { parseConfig } from "../config/parseConfig.js";
import { createBinarySession } from "../composition/binary.js";
import { createLogger } from "../logger.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { RuntimeDependencies } from "./types.js";
import { openInitialTarget } from "./startup.js";
import { startMcpTransport } from "./transport.js";
import {
  createOptionalObservationFactories,
  loadOptionalObservationProviders,
} from "../composition/optionalObservationProviders.js";
import { createToolResultDelivery } from "../server/toolResult.js";
import { createShutdown, reportMcpShutdownFailure } from "./shutdown.js";
import { ownStdioStartupInput } from "./StdioStartupInput.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";

/**
 * Start the long-lived MCP adapter and install idempotent shutdown handlers.
 * The adapter owns its BinarySession for the process lifetime; EOF and process
 * signals close bridge resources without assuming ownership of the Hopper app.
 */
export const runEager = async (
  dependencies: RuntimeDependencies,
  selectedConfig?: AppConfig,
): Promise<number> => {
  const environment = snapshotEnvironment(dependencies.env);
  const config =
    selectedConfig === undefined
      ? parseConfig(environment)
      : ok(selectedConfig);
  if (!config.ok) {
    dependencies.writeStderr(`${projectAnalysisError(config.error).message}\n`);
    return 1;
  }
  const logger = createLogger("mcp", config.value.logLevel);
  const serverLogger = logger.child({ layer: "server" });
  const analysisSettings = new AnalysisSettings(environment);
  const session = createBinarySession(
    config.value,
    logger,
    environment,
    analysisSettings.read,
  );
  const startup = new AbortController();
  let transport: Awaited<ReturnType<typeof startMcpTransport>> | undefined;
  let settleStartup!: () => void;
  const startupSettled = new Promise<void>((resolve) => {
    settleStartup = resolve;
  });
  let inputFailure: AnalysisError | undefined;
  const shutdown = createShutdown({
    // A shutdown request seals session admission immediately, then waits for
    // startup to return every late handle before any resource is released.
    handle: {
      prepareShutdown: async () => {
        await startupSettled;
        await transport?.handle.prepareShutdown?.();
      },
      close: async () => {
        await transport?.handle.close();
      },
    },
    closeAndroid: async () => {
      await transport?.closeAndroid();
    },
    closeOptionalProviders: async () => {
      await transport?.closeOptionalProviders();
    },
    session,
    dependencies: {
      ...dependencies,
      registerShutdown: (handler) =>
        dependencies.registerShutdown(() => {
          startup.abort();
          handler();
        }),
    },
    serverLogger,
  });
  const startupInput =
    dependencies.transport !== "http" &&
    dependencies.stdin !== undefined &&
    !startup.signal.aborted
      ? ownStdioStartupInput(dependencies.stdin, (failure) => {
          inputFailure ??= failure;
          startup.abort(failure);
          shutdown.request();
        })
      : undefined;
  dependencies.captureShutdown?.(async () => {
    startup.abort();
    await shutdown.shutdown();
  });
  let ready = false;
  let startupRejected = false;
  let startupCause: unknown;
  let exitCode = 0;
  try {
    const opened = await openInitialTarget(
      session,
      config.value,
      serverLogger,
      dependencies.writeStderr,
      startup.signal,
    );
    if (!opened.ok) exitCode = opened.exitCode;
    else if (!startup.signal.aborted) {
      const started = await startMcpTransport(
        {
          ...dependencies,
          serve: async (factory, options) => {
            if (startup.signal.aborted) throw startup.signal.reason;
            startupInput?.handoff();
            const handle = await dependencies.serve(factory, options);
            if (!startup.signal.aborted) startupInput?.resume();
            return handle;
          },
        },
        session,
        {
          logger,
          serverLogger,
          analysisSettings,
          environment,
          signal: startup.signal,
          delivery: createToolResultDelivery(config.value.mcpMaxResponseBytes),
          loadOptionalProviders:
            dependencies.loadOptionalProviders ??
            (() =>
              loadOptionalObservationProviders(
                createOptionalObservationFactories(
                  environment,
                  analysisSettings.read,
                ),
              )),
        },
      );
      transport = started;
      if (started.ok) ready = true;
      else exitCode = started.cancelled ? 0 : 1;
    }
  } catch (cause: unknown) {
    startupRejected = true;
    startupCause = cause;
  } finally {
    settleStartup();
    startupInput?.close();
  }
  if (startupRejected || !ready || startup.signal.aborted) {
    if (inputFailure !== undefined)
      dependencies.writeStderr(
        `${projectAnalysisError(inputFailure).message}\n`,
      );
    try {
      await shutdown.shutdown();
    } catch (cause: unknown) {
      reportMcpShutdownFailure(cause, dependencies, serverLogger);
      return 1;
    }
    if (inputFailure !== undefined) return 1;
    if (startupRejected) throw startupCause;
  }
  return exitCode;
};
