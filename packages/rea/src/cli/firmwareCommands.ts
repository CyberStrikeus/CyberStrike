import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { z } from "incur";
import { FirmwareAnalysisService } from "../application/firmware/FirmwareAnalysisService.js";
import { createFirmwareAnalysisProvider } from "../composition/firmware.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import { firmwareInputSchemas } from "../domain/firmware/firmwareAnalysis.js";
import { localPathStringSchema } from "../domain/localPath.js";
import type { FirmwareOperation } from "../domain/firmware/firmwareAnalysis.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { finishCliEvidenceCommand } from "./cliEvidenceCallerPath.js";

/** One-shot firmware CLI commands backed by the same workflows as MCP. */
export const registerFirmwareCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  const service = new FirmwareAnalysisService(
    createFirmwareAnalysisProvider(environment),
  );
  const extractInput = firmwareInputSchemas.extract_firmware.shape;
  const range = extractInput.range.unwrap().shape;
  const execute = (
    name: string,
    operation: FirmwareOperation,
    input: unknown,
    callerPath: string,
  ) =>
    withCommandCancellation((signal) =>
      logCliCommand(logger, name, () =>
        finishCliEvidenceCommand(
          callerPath,
          () => service.execute(operation, input, { signal }),
          service,
          operation === "inspect_firmware_regions" ? "binwalk" : "unblob",
          operation,
          signal,
        ).then(projectCliAnalysisResult),
      ),
    );
  const path = localPathStringSchema.describe(
    "Local firmware path; never executed",
  );
  cli.command(CLI_COMMANDS.inspectFirmwareRegions, {
    description:
      "Inspect firmware signature candidates without extracting them",
    args: z.object({ path }),
    options: z.object({ analysisTimeoutMs: extractInput.analysis_timeout_ms }),
    run: ({ args, options }) =>
      execute(
        CLI_COMMANDS.inspectFirmwareRegions,
        "inspect_firmware_regions",
        // CLI paths are operator-relative; resolve before shared validation.
        {
          path: absoluteCallerPath(args.path),
          ...(options.analysisTimeoutMs === undefined
            ? {}
            : { analysis_timeout_ms: options.analysisTimeoutMs }),
        },
        args.path,
      ),
  });
  cli.command(CLI_COMMANDS.extractFirmware, {
    description:
      "Extract selected firmware bytes and return verified files and provenance",
    args: z.object({
      path,
      outputDirectory: localPathStringSchema.describe(
        "Absent output directory; parent must exist",
      ),
    }),
    options: z.object({
      offset: range.offset
        .optional()
        .describe("Selected byte offset; requires length"),
      length: range.length
        .optional()
        .describe("Selected byte length; requires offset"),
      maxDepth: extractInput.max_depth,
      maxOutputBytes: extractInput.max_output_bytes,
      maxOutputFiles: extractInput.max_output_files,
      publicationTimeoutMs: extractInput.publication_timeout_ms,
      analysisTimeoutMs: extractInput.analysis_timeout_ms,
    }),
    run: ({ args, options }) =>
      execute(
        CLI_COMMANDS.extractFirmware,
        "extract_firmware",
        {
          path: absoluteCallerPath(args.path),
          output_directory: absoluteCallerPath(args.outputDirectory),
          ...(options.offset === undefined && options.length === undefined
            ? {}
            : { range: { offset: options.offset, length: options.length } }),
          max_depth: options.maxDepth,
          max_output_bytes: options.maxOutputBytes,
          max_output_files: options.maxOutputFiles,
          publication_timeout_ms: options.publicationTimeoutMs,
          ...(options.analysisTimeoutMs === undefined
            ? {}
            : { analysis_timeout_ms: options.analysisTimeoutMs }),
        },
        args.path,
      ),
  });
};
