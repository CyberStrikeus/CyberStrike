import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { Cli, z } from "incur";
import { createWebRuntimeService } from "../composition/webRuntime.js";
import { browserCliError } from "./browserCliError.js";
import {
  browserScopeOptions,
  selectedCommandTimeout,
} from "../cliObservationOptions.js";
import { logCliCommand } from "../cliLogging.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { MAX_BROWSER_DEADLINE_MS } from "../domain/browserDeadline.js";
import type { Logger } from "pino";
import type { ProgressReporter } from "../application/ProgressReporter.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";

/** CLI progress exposes the actual armed point on stderr without corrupting JSON results. */
const runtimeProgress: ProgressReporter = {
  report: async (update) => {
    process.stderr.write(`${JSON.stringify({ rea_progress: update })}\n`);
  },
};

/** Register public equivalents of the two modular website runtime tools. */
export const registerWebRuntimeCommands = (
  cli: ReturnType<typeof Cli.create>,
  logger: Logger,
): void => {
  cli.command(CLI_COMMANDS.observeWebExecution, {
    description:
      "Observe precise page execution; resets counters and temporarily disables optimization",
    args: z.object({
      endpoint: z.string().describe("Existing loopback browser CDP endpoint"),
      targetId: z
        .string()
        .describe("Selected page target ID from list-browser-targets"),
    }),
    options: z.object({
      ...browserScopeOptions,
      // incur only coerces ZodNumber argv fields; domain z.int() constructs
      // ZodNumberFormat. Preserve the canonical bounds in this CLI adapter.
      observationMs: z
        .number()
        .int()
        .min(1)
        .max(MAX_BROWSER_DEADLINE_MS)
        .default(10_000)
        .describe("Observation duration in milliseconds"),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, "observe-web-execution", async () => {
          const service = createWebRuntimeService();
          return await finishAnalysisCommand(
            () =>
              service.observe(
                {
                  cdp_endpoint: args.endpoint,
                  target_id: args.targetId,
                  allowed_origins: options.allowedOrigins,
                  observation_ms: options.observationMs,
                  ...selectedCommandTimeout(options.commandTimeoutMs),
                },
                { progress: runtimeProgress, signal },
              ),
            {
              close: async () => {
                await service.provider.close?.();
              },
            },
            service.provider.identity().id,
            "observe_web_execution",
            signal,
          ).then(projectCliAnalysisResult);
        }),
      ),
  });
  cli.command(CLI_COMMANDS.inspectWebEventListeners, {
    description:
      "Inspect native listener source locations on the first main-document CSS match",
    args: z.object({
      endpoint: z.string().describe("Existing loopback browser CDP endpoint"),
      targetId: z
        .string()
        .describe("Selected page target ID from list-browser-targets"),
      selector: z
        .string()
        .describe("Native CSS selector; inspect the first main-document match"),
    }),
    options: z.object({ ...browserScopeOptions }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, "inspect-web-event-listeners", async () => {
          const service = createWebRuntimeService();
          return await finishAnalysisCommand(
            () =>
              service.inspect(
                {
                  cdp_endpoint: args.endpoint,
                  target_id: args.targetId,
                  selector: args.selector,
                  allowed_origins: options.allowedOrigins,
                  ...selectedCommandTimeout(options.commandTimeoutMs),
                },
                { signal },
              ),
            {
              close: async () => {
                await service.provider.close?.();
              },
            },
            service.provider.identity().id,
            "inspect_web_event_listeners",
            signal,
          ).then(projectCliAnalysisResult);
        }),
      ),
  });
};
