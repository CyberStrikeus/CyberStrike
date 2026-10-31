import { z } from "incur";

import { projectManagedApplicationGraphEvidence } from "../application/managed/ManagedApplicationGraphService.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { parseCliJsonInput } from "../cliJsonInput.js";
import { logCliCommand } from "../cliLogging.js";
import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { withCommandCancellation } from "./commandCancellation.js";
import {
  evidenceBundleOption,
  runEvidenceInputCommand,
} from "./evidenceInputCommand.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";

/** Register managed static-Evidence application graph projection. */
export const registerProjectManagedApplicationGraph = (
  cli: CliInstance,
  logger: Logger,
): void => {
  cli.command(CLI_COMMANDS.projectManagedApplicationGraph, {
    description:
      "Project authenticated managed static Evidence into an application graph",
    args: z.object({
      inputJson: z
        .string()
        .describe("Inline managed application graph JSON or JSON file path"),
    }),
    options: z.object({ evidenceBundle: evidenceBundleOption }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, "project-managed-application-graph", async () => {
          const input = await parseCliJsonInput(
            args.inputJson,
            "project-managed-application-graph",
            signal,
          );
          if (!input.ok) return input.error;
          return runEvidenceInputCommand(
            "project_managed_application_graph",
            options.evidenceBundle,
            signal,
            (lookup) =>
              Promise.resolve(
                projectManagedApplicationGraphEvidence(input.value, lookup, {
                  signal,
                }),
              ),
          ).then(projectCliAnalysisResult);
        }),
      ),
  });
};
