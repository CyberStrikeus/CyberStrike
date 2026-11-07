import { inspectModelArtifactInputSchema } from "../domain/model/modelArtifactQuery.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { safeParseJson } from "../domain/safeJson.js";
import { z } from "incur";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { localPathStringSchema } from "../domain/localPath.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { createModelArtifactService } from "../composition/model.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import { withCommandCancellation } from "./commandCancellation.js";
import {
  analysisEvidenceDeliveryOptions,
  deliverCliAnalysisEvidence,
} from "./analysisEvidenceDelivery.js";

/** One-shot summaries export the same complete observations used by MCP retained pages. */
export const registerModelCommands = (
  cli: CliInstance,
  logger: Logger,
): void => {
  cli.command(CLI_COMMANDS.inspectModelArtifact, {
    description:
      "Inspect GGUF or safetensors headers without loading model weights",
    args: z.object({
      path: localPathStringSchema.describe(
        "Local model file, detected by content",
      ),
    }),
    options: z.object({
      ...analysisEvidenceDeliveryOptions,
      view: z
        .string()
        .optional()
        .describe(
          "JSON model page selection; requires --detail summary and --evidence_output",
        ),
      hash: z
        .enum(["header", "full"])
        .default("header")
        .describe(
          "header reads declarations only; full additionally streams all bytes for SHA-256",
        ),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.inspectModelArtifact, async () => {
          const decoded =
            options.view === undefined
              ? { ok: true as const, value: undefined }
              : safeParseJson(options.view);
          if (!decoded.ok) {
            return projectAnalysisError(
              new AnalysisInputError(
                "inspect_model_artifact",
                { cause: decoded.cause },
                [
                  {
                    path: ["view"],
                    reason: "invalid_format",
                    message: "view must be a JSON model page selection",
                  },
                ],
              ),
            );
          }
          const view = decoded.value;
          const selected = inspectModelArtifactInputSchema.safeParse({
            path: absoluteCallerPath(args.path),
            hash: options.hash,
            detail: options.detail,
            ...(view === undefined ? {} : { view }),
          });
          if (!selected.success)
            return projectAnalysisError(
              analysisInputErrorFromIssues(
                "inspect_model_artifact",
                selected.error.issues,
                { view },
              ),
            );
          const service = createModelArtifactService();
          return deliverCliAnalysisEvidence({
            callerInputPath: args.path,
            run: () =>
              service.inspect(
                {
                  path: selected.data.path,
                  hash: selected.data.hash,
                  detail: "complete",
                },
                { signal },
              ),
            service,
            providerId: "model-artifact",
            operation: "inspect_model_artifact",
            signal,
            detail: options.detail,
            evidenceOutput: options.evidence_output,
            ...(selected.data.view === undefined
              ? {}
              : {
                  view: {
                    kind: "model-artifact" as const,
                    ...selected.data.view,
                  },
                }),
          });
        }),
      ),
  });
};
