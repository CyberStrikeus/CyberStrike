import { Cli, z } from "incur";

import {
  captureProcessScenarioFile,
  compareProcessEvidenceFiles,
} from "../application/process/ProcessCli.js";
import { logCliCommand } from "../cliLogging.js";
import type { Logger } from "pino";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { withCommandCancellation } from "./commandCancellation.js";

/** Register direct process capture and comparison commands. */
export const registerProcessCommands = (
  cli: ReturnType<typeof Cli.create>,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  cli.command(CLI_COMMANDS.captureProcess, {
    description: "Capture one caller-selected process scenario",
    args: z.object({ scenario: z.string().describe("Scenario JSON path") }),
    run: ({ args }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, "capture-process", () =>
          captureProcessScenarioFile(args.scenario, environment, signal),
        ),
      ),
  });
  cli.command(CLI_COMMANDS.compareProcessCaptures, {
    description: "Compare two process capture Evidence JSON files",
    args: z.object({
      left: z.string().describe("Left capture Evidence JSON path"),
      right: z.string().describe("Right capture Evidence JSON path"),
      traceSpec: z
        .string()
        .optional()
        .describe("Optional partial-order or finite-trace specification path"),
    }),
    run: ({ args }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, "compare-process-captures", () =>
          compareProcessEvidenceFiles(
            args.left,
            args.right,
            args.traceSpec,
            signal,
          ),
        ),
      ),
  });
};
