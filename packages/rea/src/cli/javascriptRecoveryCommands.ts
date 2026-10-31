import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { javascriptRecoveryInputSchema } from "../domain/javascript/javascriptRecovery.js";
import { z } from "incur";
import { JavaScriptRecoveryService } from "../application/javascript/JavaScriptRecoveryService.js";
import { createJavaScriptRecoveryProvider } from "../composition/javascriptRecovery.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";

/** Share source recovery with MCP while keeping CLI spelling at this boundary. */
export const registerJavaScriptRecoveryCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  const service = new JavaScriptRecoveryService(
    createJavaScriptRecoveryProvider(environment),
  );
  cli.command(CLI_COMMANDS.recoverJavaScriptSources, {
    description:
      "Recover readable JavaScript modules with source provenance and verified files",
    args: z.object({
      path: javascriptRecoveryInputSchema.shape.path,
      outputDirectory: javascriptRecoveryInputSchema.shape.output_directory,
    }),
    options: z.object({
      additionalPath: javascriptRecoveryInputSchema.shape.additional_paths,
      extractionMode: javascriptRecoveryInputSchema.shape.extraction_mode
        .removeDefault()
        .optional()
        .describe(
          javascriptRecoveryInputSchema.shape.extraction_mode.description!,
        ),
      rewriteLevel: javascriptRecoveryInputSchema.shape.rewrite_level
        .removeDefault()
        .optional()
        .describe(
          javascriptRecoveryInputSchema.shape.rewrite_level.description!,
        ),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.recoverJavaScriptSources, () =>
          finishAnalysisCommand(
            () =>
              service.recover(
                {
                  path: args.path,
                  output_directory: args.outputDirectory,
                  ...(options.additionalPath === undefined
                    ? {}
                    : { additional_paths: options.additionalPath }),
                  ...(options.extractionMode === undefined
                    ? {}
                    : { extraction_mode: options.extractionMode }),
                  ...(options.rewriteLevel === undefined
                    ? {}
                    : { rewrite_level: options.rewriteLevel }),
                },
                { signal },
              ),
            service,
            "wakaru",
            "recover_javascript_sources",
            signal,
          ).then(projectCliAnalysisResult),
        ),
      ),
  });
};
