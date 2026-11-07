import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { z } from "incur";

import type { DirectAnalysis } from "../composition/directAnalysis.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { parseCliJsonInput } from "../cliJsonInput.js";
import { logCliCommand } from "../cliLogging.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { nativeCallObservationInputSchema } from "../domain/native/nativeCallObservation.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";

const OPERATION = "observe_native_calls";

/** `observe-native-calls <path> <input-json>`: the MCP input object as JSON. */
export const registerNativeCallCommands = (
  cli: CliInstance,
  logger: Logger,
  runProviderAnalysis: DirectAnalysis["runProviderAnalysis"],
): void => {
  cli.command(CLI_COMMANDS.observeNativeCalls, {
    description:
      "Launch a Mach-O under LLDB and record entries into selected functions or Objective-C methods",
    args: z.object({
      path: z.string().describe("Mach-O or app path"),
      inputJson: z
        .string()
        .describe(
          "Inline JSON or a JSON file path: breakpoints, arguments, environment, duration_ms, max_events, argument_registers, backtrace_frames",
        ),
    }),
    run: ({ args }) =>
      logCliCommand(logger, CLI_COMMANDS.observeNativeCalls, async () => {
        const input = await parseCliJsonInput(args.inputJson, OPERATION);
        if (!input.ok) return input.error;
        const parsed = nativeCallObservationInputSchema.safeParse(input.value);
        if (!parsed.success)
          return {
            error: "Analysis failed",
            ...projectAnalysisError(
              analysisInputErrorFromIssues(
                OPERATION,
                parsed.error.issues,
                input.value,
              ),
            ),
          };
        return runProviderAnalysis(
          args.path,
          OPERATION,
          z.record(z.string(), jsonValueSchema).parse(parsed.data),
          logger,
        ).then(projectCliAnalysisResult);
      }),
  });
};
