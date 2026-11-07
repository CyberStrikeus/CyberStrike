import { z } from "incur";
import {
  WEB_NETWORK_CAPTURE_FORMATS,
  inspectWebNetworkCaptureInputSchema,
} from "../domain/webNetworkCapture.js";
import { createWebNetworkCaptureService } from "../composition/webNetworkCaptures.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { cliIntegerArgument } from "./options.js";
import { withCommandCancellation } from "./commandCancellation.js";
import {
  analysisEvidenceDeliveryOptions,
  deliverCliAnalysisEvidence,
} from "./analysisEvidenceDelivery.js";
import { localPathStringSchema } from "../domain/localPath.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { explicitSensitiveValueOptions } from "./explicitSensitiveArguments.js";

/** Expose offline historical capture inspection with the same selection contract as MCP. */
export const registerWebNetworkCaptureCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<NodeJS.ProcessEnv>,
): void => {
  cli.command(CLI_COMMANDS.inspectWebNetworkCapture, {
    description:
      "Inspect retained HAR, native mitmproxy, Fiddler SAZ or aioquic qlog records without fetching recorded URLs",
    args: z.object({
      capturePath: localPathStringSchema.describe("Local capture path"),
      format: z
        .enum(WEB_NETWORK_CAPTURE_FORMATS)
        .describe("Producer capture format"),
    }),
    options: z.object({
      ...analysisEvidenceDeliveryOptions,
      protobufFraming: z
        .enum(["auto", "raw", "grpc", "grpc-web", "grpc-web-text"])
        .optional()
        .describe("Override framing for selected retained binary bodies"),
      protobufBodyPointer: z
        .array(z.string())
        .optional()
        .describe("Exact body pointers; repeat to select several"),
      protobufSchema: localPathStringSchema
        .optional()
        .describe("Local compiled FileDescriptorSet path"),
      protobufMessage: z
        .string()
        .optional()
        .describe("Fully qualified message type in the descriptor set"),
      record: z
        .array(cliIntegerArgument(0))
        .optional()
        .describe("Zero-based producer ordinals; repeat to select several"),
      ...explicitSensitiveValueOptions,
      captureTimeoutMs:
        inspectWebNetworkCaptureInputSchema.shape.capture_timeout_ms,
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(
          logger,
          CLI_COMMANDS.inspectWebNetworkCapture,
          async () => {
            const service = createWebNetworkCaptureService(environment);
            return deliverCliAnalysisEvidence({
              run: () =>
                service.inspect(
                  {
                    capture_path: absoluteCallerPath(args.capturePath),
                    format: args.format,
                    sensitive_values: options.sensitiveValue,
                    ...([
                      options.protobufFraming,
                      options.protobufBodyPointer,
                      options.protobufSchema,
                      options.protobufMessage,
                    ].every((value) => value === undefined)
                      ? {}
                      : {
                          protobuf: {
                            framing: options.protobufFraming ?? "auto",
                            ...(options.protobufBodyPointer === undefined
                              ? {}
                              : { body_pointers: options.protobufBodyPointer }),
                            ...(options.protobufSchema === undefined &&
                            options.protobufMessage === undefined
                              ? {}
                              : {
                                  schema: {
                                    descriptor_set_path:
                                      options.protobufSchema === undefined
                                        ? undefined
                                        : absoluteCallerPath(
                                            options.protobufSchema,
                                          ),
                                    message_type: options.protobufMessage,
                                  },
                                }),
                          },
                        }),
                    ...(options.record === undefined
                      ? {}
                      : { record_ordinals: options.record }),
                    ...(options.captureTimeoutMs === undefined
                      ? {}
                      : { capture_timeout_ms: options.captureTimeoutMs }),
                  },
                  { signal },
                ),
              service,
              providerId: "web-network-capture",
              operation: "inspect_web_network_capture",
              signal,
              detail: options.detail,
              evidenceOutput: options.evidence_output,
              sensitiveValues: options.sensitiveValue ?? [],
            });
          },
        ),
      ),
  });
};
