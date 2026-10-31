import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { z } from "incur";
import type { Logger } from "pino";

import { CutterBridgeClient } from "../cutter/CutterBridgeClient.js";
import { CutterBridgeService } from "../cutter/CutterBridgeService.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";
import { withCommandCancellation } from "./commandCancellation.js";
import type { CliInstance } from "./types.js";
import { cliIntegerArgument } from "./options.js";

/** Register commands that control an already-running Cutter instance. */
export const registerCutterCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<NodeJS.ProcessEnv>,
): void => {
  const createCutter = () =>
    new CutterBridgeService(new CutterBridgeClient(environment));

  cli.command(CLI_COMMANDS.listCutterSessions, {
    description:
      "List live Cutter instances connected through the REA Python plugin bridge",
    args: z.object({}),
    run: () =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.listCutterSessions, async () => {
          const cutter = createCutter();
          return finishAnalysisCommand(
            () => cutter.listSessions({ signal }),
            cutter,
            "cutter",
            "list_cutter_sessions",
            signal,
          ).then(projectCliAnalysisResult);
        }),
      ),
  });
  cli.command(CLI_COMMANDS.cutterCommand, {
    description: "Execute one Rizin command in a selected live Cutter instance",
    args: z.object({
      sessionId: z
        .string()
        .uuid()
        .describe("Session ID copied from list-cutter-sessions."),
      expectedGeneration: cliIntegerArgument(0).describe(
        "Session generation returned by list-cutter-sessions.",
      ),
      command: z
        .string()
        .min(1)
        .describe("One unrestricted Rizin command to run in Cutter.")
        .refine((value) => !/[\r\n]/u.test(value)),
    }),
    options: z.object({
      jsonOutput: z
        .boolean()
        .optional()
        .describe(
          "Return command-specific JSON output when available (independent of CLI output formatting).",
        ),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.cutterCommand, async () => {
          const cutter = createCutter();
          return finishAnalysisCommand(
            () =>
              cutter.execute(
                {
                  session_id: args.sessionId,
                  expected_generation: args.expectedGeneration,
                  command: args.command,
                  json: options.jsonOutput ?? false,
                },
                { signal },
              ),
            cutter,
            "cutter",
            "cutter_command",
            signal,
          ).then(projectCliAnalysisResult);
        }),
      ),
  });
};
