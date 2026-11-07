import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { inspectSignalDecodersInputSchema } from "../domain/signals/signalDecoders.js";
import { z } from "incur";
import type { SignalRecordingService } from "../application/signals/SignalRecordingService.js";
import { createSignalRecordingService } from "../composition/signals.js";
import {
  signalRecordingOptionsSchema,
  signalRecordingSelectorBudgetIssue,
  withinSignalRecordingSelectorBudget,
} from "../domain/signals/signalRecording.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";
import { finishCliEvidenceCommand } from "./cliEvidenceCallerPath.js";
import { localPathStringSchema } from "../domain/localPath.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
export const registerSignalCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<NodeJS.ProcessEnv>,
  service: Pick<
    SignalRecordingService,
    "decode" | "inspectDecoders" | "close"
  > = createSignalRecordingService(environment),
): void => {
  cli.command(CLI_COMMANDS.inspectSignalDecoders, {
    description: "Search installed sigrok decoders or selected decoder help",
    options: z
      .object({
        ...inspectSignalDecodersInputSchema.shape,
        limit: z
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER)
          .optional()
          .describe(
            "Maximum matching decoders or help lines to return; defaults to 50",
          ),
        all: z
          .boolean()
          .default(false)
          .describe("Return all remaining matches"),
      })
      .superRefine((options, context) => {
        if (options.all && options.limit !== undefined)
          context.addIssue({
            code: "custom",
            path: ["all"],
            message: "all and limit are mutually exclusive",
          });
      }),
    run: ({ options: { all, ...options } }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.inspectSignalDecoders, async () =>
          finishAnalysisCommand(
            () =>
              service.inspectDecoders(
                { ...options, ...(all ? { limit: null } : {}) },
                { signal },
              ),
            service,
            "sigrok-recording",
            "inspect_signal_decoders",
            signal,
          ).then(projectCliAnalysisResult),
        ),
      ),
  });
  cli.command(CLI_COMMANDS.decodeSignalRecording, {
    description:
      "Decode an existing signal recording with caller-supplied sigrok",
    args: z.object({
      path: localPathStringSchema.describe("Local signal recording"),
    }),
    options: z
      .object({
        ...signalRecordingOptionsSchema.shape,
        line_limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Returned output lines per page; default 50"),
        all_lines: z
          .boolean()
          .default(false)
          .describe(
            "Return all remaining output lines instead of a bounded page",
          ),
      })
      .superRefine((options, context) => {
        if (options.all_lines && options.line_limit !== undefined)
          context.addIssue({
            code: "custom",
            path: ["all_lines"],
            message: "all_lines and line_limit are mutually exclusive",
          });
      })
      .refine(
        withinSignalRecordingSelectorBudget,
        signalRecordingSelectorBudgetIssue,
      ),
    run: ({ args, options: { all_lines, ...options } }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.decodeSignalRecording, async () => {
          return finishCliEvidenceCommand(
            args.path,
            () =>
              service.decode(
                {
                  ...options,
                  ...(all_lines ? { line_limit: null } : {}),
                  path: absoluteCallerPath(args.path),
                },
                { signal },
              ),
            service,
            "sigrok-recording",
            "decode_signal_recording",
            signal,
          ).then(projectCliAnalysisResult);
        }),
      ),
  });
};
