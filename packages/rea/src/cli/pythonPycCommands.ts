import { z } from "incur";
import { localPathStringSchema } from "../domain/localPath.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { createPythonPycService } from "../composition/pythonPyc.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { inspectPythonPycInputSchema } from "../domain/python/pythonPyc.js";
import {
  analysisEvidenceDeliveryOptions,
  deliverCliAnalysisEvidence,
  parseCliAnalysisEvidenceDelivery,
} from "./analysisEvidenceDelivery.js";
import { pythonPycDeliverySchema } from "../domain/analysisView/pythonPycView.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";

/** Inspect operator-selected pyc files through the same shared workflow as MCP. */
export const registerPythonPycCommands = (
  cli: CliInstance,
  logger: Logger,
): void => {
  cli.command(CLI_COMMANDS.inspectPythonPyc, {
    description:
      "Inspect a supported CPython 3.7–3.13 pyc header and marshal code objects without executing bytecode",
    args: z.object({
      path: localPathStringSchema.describe("Local CPython .pyc file"),
    }),
    options: z.object({
      maxFileBytes: inspectPythonPycInputSchema.shape.max_file_bytes,
      maxObjects: inspectPythonPycInputSchema.shape.max_objects,
      maxDepth: inspectPythonPycInputSchema.shape.max_depth,
      maxStringBytes: inspectPythonPycInputSchema.shape.max_string_bytes,
      ...analysisEvidenceDeliveryOptions,
      view: z
        .string()
        .optional()
        .describe(
          "JSON python-pyc view; requires --detail summary and --evidence_output",
        ),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.inspectPythonPyc, async () => {
          const delivery = parseCliAnalysisEvidenceDelivery(
            "inspect_python_pyc",
            options,
            pythonPycDeliverySchema,
          );
          if (!delivery.ok) return projectAnalysisError(delivery.error);
          const service = createPythonPycService();
          return deliverCliAnalysisEvidence({
            callerInputPath: args.path,
            run: () =>
              service.inspect(
                {
                  path: absoluteCallerPath(args.path),
                  max_file_bytes: options.maxFileBytes,
                  max_objects: options.maxObjects,
                  max_depth: options.maxDepth,
                  max_string_bytes: options.maxStringBytes,
                },
                { signal },
              ),
            service,
            providerId: "rea-python-pyc",
            operation: "inspect_python_pyc",
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
