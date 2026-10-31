import { z } from "incur";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { safeParseJson } from "../domain/safeJson.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";

/** Register provider-free listing and rendering of existing guided prompts. */
export const registerGuidedWorkflowCommands = (
  cli: CliInstance,
  logger: Logger,
): void => {
  cli.command(CLI_COMMANDS.guidedWorkflows, {
    description: "List or render REA's existing guided workflows",
    args: z.object({}),
    options: z.object({
      action: z
        .enum(["list", "render"])
        .default("list")
        .describe("List available workflows or render one"),
      workflowId: z
        .string()
        .optional()
        .describe("Guided workflow identifier for --action render"),
      argumentsJson: z
        .string()
        .optional()
        .describe("JSON object containing caller-supplied string arguments"),
    }),
    run: ({ options }) =>
      logCliCommand(logger, CLI_COMMANDS.guidedWorkflows, async () => {
        let arguments_: unknown;
        if (options.argumentsJson !== undefined) {
          const parsed = safeParseJson(options.argumentsJson);
          if (!parsed.ok)
            return projectAnalysisError(
              new AnalysisInputError(
                "guided_workflows",
                {
                  userMessage:
                    "--arguments-json must contain a valid JSON object of string values.",
                },
                [
                  {
                    path: ["arguments_json"],
                    reason: "invalid_format",
                    expected: "JSON object",
                  },
                ],
              ),
            );
          arguments_ = parsed.value;
        }
        const { accessGuidedWorkflows } =
          await import("../application/GuidedWorkflowAccess.js");
        const result = accessGuidedWorkflows({
          action: options.action,
          ...(options.workflowId === undefined
            ? {}
            : { workflow_id: options.workflowId }),
          ...(arguments_ === undefined ? {} : { arguments: arguments_ }),
        });
        return result.ok ? result.value : projectAnalysisError(result.error);
      }),
  });
};
