import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { inspectPacketFieldsInputSchema } from "../domain/captures/packetFields.js";
import { z } from "incur";
import type { PacketCaptureService } from "../application/captures/PacketCaptureService.js";
import { createPacketCaptureService } from "../composition/captures.js";
import {
  packetCaptureOptionsSchema,
  packetCaptureSelectorBudgetIssue,
  withinPacketCaptureSelectorBudget,
} from "../domain/captures/packetCapture.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";
import { finishCliEvidenceCommand } from "./cliEvidenceCallerPath.js";
import { localPathStringSchema } from "../domain/localPath.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
export const registerCaptureCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<NodeJS.ProcessEnv>,
  service: Pick<
    PacketCaptureService,
    "inspect" | "inspectFields" | "close"
  > = createPacketCaptureService(environment),
): void => {
  cli.command(CLI_COMMANDS.inspectPacketFields, {
    description: "Search installed TShark protocol and field definitions",
    options: z
      .object({
        ...inspectPacketFieldsInputSchema.shape,
        limit: z
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER)
          .optional()
          .describe("Maximum matching records to return; defaults to 50"),
        all: z
          .boolean()
          .default(false)
          .describe("Return all remaining matches within resource limits"),
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
        logCliCommand(logger, CLI_COMMANDS.inspectPacketFields, async () =>
          finishAnalysisCommand(
            () =>
              service.inspectFields(
                { ...options, ...(all ? { limit: null } : {}) },
                { signal },
              ),
            service,
            "tshark-capture",
            "inspect_packet_fields",
            signal,
          ).then(projectCliAnalysisResult),
        ),
      ),
  });
  cli.command(CLI_COMMANDS.inspectPacketCapture, {
    description:
      "Inspect an existing packet capture with caller-supplied TShark",
    args: z.object({
      path: localPathStringSchema.describe("Local packet capture"),
    }),
    options: z
      .object({
        ...packetCaptureOptionsSchema.shape,
        match_limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Returned matching frames per page; default 50"),
        all_matches: z
          .boolean()
          .default(false)
          .describe(
            "Return all remaining matching frames instead of a bounded page",
          ),
      })
      .superRefine((options, context) => {
        if (options.all_matches && options.match_limit !== undefined)
          context.addIssue({
            code: "custom",
            path: ["all_matches"],
            message: "all_matches and match_limit are mutually exclusive",
          });
      })
      .refine(
        withinPacketCaptureSelectorBudget,
        packetCaptureSelectorBudgetIssue,
      ),
    run: ({ args, options: { all_matches, ...options } }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.inspectPacketCapture, async () => {
          return finishCliEvidenceCommand(
            args.path,
            () =>
              service.inspect(
                {
                  ...options,
                  ...(all_matches ? { match_limit: null } : {}),
                  path: absoluteCallerPath(args.path),
                },
                { signal },
              ),
            service,
            "tshark-capture",
            "inspect_packet_capture",
            signal,
          ).then(projectCliAnalysisResult);
        }),
      ),
  });
};
