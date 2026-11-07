import { z } from "incur";
import { localPathStringSchema } from "../domain/localPath.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { createBeamService } from "../composition/erlang.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { inspectErlangBeamInputSchema } from "../domain/erlang/beam.js";
import {
  analysisEvidenceDeliveryOptions,
  deliverCliAnalysisEvidence,
  parseCliAnalysisEvidenceDelivery,
} from "./analysisEvidenceDelivery.js";
import { erlangBeamDeliverySchema } from "../domain/analysisView/erlangBeamView.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";

/** Inspect operator-selected BEAM files through the same shared workflow as MCP. */
export const registerErlangCommands = (
  cli: CliInstance,
  logger: Logger,
): void => {
  cli.command(CLI_COMMANDS.inspectErlangBeam, {
    description:
      "Inspect Erlang BEAM atoms, exports, imports and Code header without executing bytecode",
    args: z.object({
      path: localPathStringSchema.describe("Local BEAM file"),
    }),
    options: z.object({
      maxFileBytes: inspectErlangBeamInputSchema.shape.max_file_bytes,
      maxChunks: inspectErlangBeamInputSchema.shape.max_chunks,
      maxAtoms: inspectErlangBeamInputSchema.shape.max_atoms,
      ...analysisEvidenceDeliveryOptions,
      view: z
        .string()
        .optional()
        .describe(
          "JSON beam view; requires --detail summary and --evidence_output",
        ),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.inspectErlangBeam, async () => {
          const delivery = parseCliAnalysisEvidenceDelivery(
            "inspect_erlang_beam",
            options,
            erlangBeamDeliverySchema,
          );
          if (!delivery.ok) return projectAnalysisError(delivery.error);
          const service = createBeamService();
          return deliverCliAnalysisEvidence({
            callerInputPath: args.path,
            run: () =>
              service.inspect(
                {
                  path: absoluteCallerPath(args.path),
                  max_file_bytes: options.maxFileBytes,
                  max_chunks: options.maxChunks,
                  max_atoms: options.maxAtoms,
                },
                { signal },
              ),
            service,
            providerId: "rea-erlang-beam",
            operation: "inspect_erlang_beam",
            signal,
            detail: delivery.value.detail,
            evidenceOutput: delivery.value.evidenceOutput,
            ...(delivery.value.view === undefined
              ? {}
              : { view: delivery.value.view }),
          });
        }),
      ),
  });
};
