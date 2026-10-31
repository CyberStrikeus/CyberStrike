import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { z } from "incur";
import { createWebSourceLocationService } from "../composition/webSourceLocations.js";
import { webSourceLocationInputSchema } from "../domain/webSourceLocation.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { cliIntegerArgument } from "./options.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";

/** Expose the same explicit selected map/point contract through the CLI. */
export const registerWebSourceLocationCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<NodeJS.ProcessEnv>,
): void => {
  const service = createWebSourceLocationService(environment);
  cli.command(CLI_COMMANDS.traceWebSourceLocation, {
    description:
      "Trace one retained script position through an explicitly selected local source map",
    args: z.object({
      manifestPath: z
        .string()
        .describe("Absolute export_web_scripts manifest path"),
      scriptIndex: cliIntegerArgument(0).describe(
        "Zero-based manifest script index",
      ),
      sourceMapPath: z.string().describe("Absolute local source-map path"),
      sourceMapUrl: z
        .string()
        .describe("Absolute source-map URL context; no fetch"),
      line: cliIntegerArgument(1).describe("One-based generated line"),
      column: cliIntegerArgument(0).describe(
        "Zero-based UTF-16 generated column",
      ),
    }),
    options: z.object({
      decodeTimeoutMs: webSourceLocationInputSchema.shape.decode_timeout_ms,
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.traceWebSourceLocation, () =>
          finishAnalysisCommand(
            () =>
              service.trace(
                {
                  manifest_path: args.manifestPath,
                  script_index: args.scriptIndex,
                  source_map: {
                    path: args.sourceMapPath,
                    url: args.sourceMapUrl,
                  },
                  generated_position: { line: args.line, column: args.column },
                  ...(options.decodeTimeoutMs === undefined
                    ? {}
                    : { decode_timeout_ms: options.decodeTimeoutMs }),
                },
                { signal },
              ),
            service,
            "web-source-location",
            "trace_web_source_location",
            signal,
          ).then(projectCliAnalysisResult),
        ),
      ),
  });
};
