import {
  espFlashAddressSchema,
  parseEspFlashAddress,
} from "../domain/firmware/espFlashSelection.js";
import type { ArtifactTargetSelection } from "../application/DirectAnalysis.js";
import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import {
  analysisEvidenceDeliveryOptions,
  cliEvidenceDeliveryInputError,
  publishCliAnalysisEvidence,
} from "./analysisEvidenceDelivery.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { ARTIFACT_GRAPH_PROVIDER } from "../domain/investigationProviders.js";
import { keyedArchiveInputSchema } from "../domain/apple/keyedArchive.js";
import { z } from "incur";

import type { DirectAnalysis } from "../composition/directAnalysis.js";
import { createArtifactExtractionDestination } from "../application/artifacts/ArtifactExtractionDestination.js";
import { registerArtifactComparisonCommand } from "./artifactComparisonCommand.js";
import { logCliCommand } from "../cliLogging.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";

const keyedArchiveInputBinding = {
  operation: "inspect_keyed_archive",
  fields: { path: "archive" },
} as const;

export const registerArtifactCommands = (
  cli: CliInstance,
  logger: Logger,
  runProviderAnalysis: DirectAnalysis["runProviderAnalysis"],
): void => {
  registerInspectionCommand(cli, logger, runProviderAnalysis);
  registerExtractionCommand(cli, logger, runProviderAnalysis);
  registerArtifactComparisonCommand(cli, logger);
  registerInterfaceBuilderCommand(cli, logger, runProviderAnalysis);
  registerAssetCatalogCommand(cli, logger, runProviderAnalysis);
  registerDylibResolutionCommand(cli, logger, runProviderAnalysis);
  cli.command(CLI_COMMANDS.inspectKeyedArchive, {
    description:
      "Inspect a Foundation keyed archive as an object-reference graph",
    args: z.object({
      path: z.string().describe("Foundation plist archive or Apple app bundle"),
      archive: keyedArchiveInputSchema.shape.path.describe(
        "Relative archive path when the target is a bundle",
      ),
    }),
    options: z.object({
      root: keyedArchiveInputSchema.shape.root.describe(
        "Named $top archive root",
      ),
      offset: keyedArchiveInputSchema.shape.offset.describe(
        "First original object-table index",
      ),
      limit: keyedArchiveInputSchema.shape.limit.describe(
        "Maximum object-table entries to return",
      ),
    }),
    run: ({ args, options }) =>
      logCliCommand(logger, CLI_COMMANDS.inspectKeyedArchive, () =>
        runProviderAnalysis(
          args.path,
          keyedArchiveInputBinding.operation,
          {
            path: args.archive,
            offset: options.offset,
            limit: options.limit,
            ...(options.root === undefined ? {} : { root: options.root }),
          },
          logger,
        ).then((result) =>
          projectCliAnalysisResult(result, keyedArchiveInputBinding),
        ),
      ),
  });
};

const registerDylibResolutionCommand = (
  cli: CliInstance,
  logger: Logger,
  runProviderAnalysis: DirectAnalysis["runProviderAnalysis"],
): void => {
  cli.command(CLI_COMMANDS.traceDylibResolution, {
    description:
      "Trace dyld load-path resolution for a Mach-O or every executable in an app bundle",
    args: z.object({
      path: z.string().describe("Mach-O file or Apple .app bundle path"),
    }),
    options: z.object({
      root: z
        .array(z.string())
        .optional()
        .describe(
          "Process root relative to the bundle or the Mach-O's directory (repeatable)",
        ),
      architecture: z
        .enum(["arm64", "arm64e", "x86_64"])
        .optional()
        .describe("Trace only this slice of each root"),
    }),
    run: ({ args, options }) =>
      logCliCommand(logger, CLI_COMMANDS.traceDylibResolution, () =>
        runProviderAnalysis(
          args.path,
          "trace_dylib_resolution",
          {
            ...(options.root === undefined ? {} : { roots: options.root }),
            ...(options.architecture === undefined
              ? {}
              : { architecture: options.architecture }),
          },
          logger,
        ).then(projectCliAnalysisResult),
      ),
  });
};

const registerAssetCatalogCommand = (
  cli: CliInstance,
  logger: Logger,
  runProviderAnalysis: DirectAnalysis["runProviderAnalysis"],
): void => {
  cli.command(CLI_COMMANDS.inspectAssetCatalog, {
    description: "Inspect compiled Apple asset catalog metadata",
    args: z.object({ path: z.string().describe("Apple .app bundle path") }),
    options: z.object({
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("First metadata record"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10_000)
        .default(1_000)
        .describe("Maximum records to return"),
    }),
    run: ({ args, options }) =>
      logCliCommand(logger, CLI_COMMANDS.inspectAssetCatalog, () =>
        runProviderAnalysis(
          args.path,
          "inspect_asset_catalog",
          { offset: options.offset, limit: options.limit },
          logger,
        ).then(projectCliAnalysisResult),
      ),
  });
};

const registerInterfaceBuilderCommand = (
  cli: CliInstance,
  logger: Logger,
  runProviderAnalysis: DirectAnalysis["runProviderAnalysis"],
): void => {
  cli.command(CLI_COMMANDS.decodeInterfaceBuilder, {
    description:
      "Decode compiled storyboard and nib archives from an app bundle",
    args: z.object({
      path: z.string().describe("Apple .app bundle path"),
    }),
    options: z.object({
      maxDocuments: z
        .number()
        .int()
        .min(1)
        .max(64)
        .default(64)
        .describe("Maximum archives to decode"),
      maxObjects: z
        .number()
        .int()
        .min(1)
        .max(20_000)
        .default(20_000)
        .describe("Maximum graph objects"),
      maxConnections: z
        .number()
        .int()
        .min(1)
        .max(40_000)
        .default(40_000)
        .describe("Maximum decoded connections"),
    }),
    run: ({ args, options }) =>
      logCliCommand(logger, "decode-interface-builder", () =>
        runProviderAnalysis(
          args.path,
          "decode_interface_builder",
          {
            max_documents: options.maxDocuments,
            max_objects: options.maxObjects,
            max_connections: options.maxConnections,
          },
          logger,
        ).then(projectCliAnalysisResult),
      ),
  });
};

/** Options that read a dump as an ESP flash image with caller inputs. */
const espFlashSelectionOptions = {
  targetFormat: z
    .enum(["esp-flash-image"])
    .optional()
    .describe(
      "Read the target as an ESP flash dump; required with --flash-offset or --partition-table-offset",
    ),
  flashOffset: espFlashAddressSchema
    .optional()
    .describe("Flash address (0xhex) of the dump's first byte"),
  partitionTableOffset: espFlashAddressSchema
    .optional()
    .describe(
      "Flash address (0xhex, a multiple of 0x1000) of the partition table; disables the table scan",
    ),
};

const espFlashTargetSelection = (options: {
  readonly targetFormat?: "esp-flash-image" | undefined;
  readonly flashOffset?: string | undefined;
  readonly partitionTableOffset?: string | undefined;
}): ArtifactTargetSelection => ({
  ...(options.targetFormat === undefined
    ? {}
    : { formatHint: options.targetFormat }),
  ...(options.flashOffset === undefined &&
  options.partitionTableOffset === undefined
    ? {}
    : {
        espFlash: {
          ...(options.flashOffset === undefined
            ? {}
            : { flashOffset: parseEspFlashAddress(options.flashOffset) }),
          ...(options.partitionTableOffset === undefined
            ? {}
            : {
                partitionTableOffset: parseEspFlashAddress(
                  options.partitionTableOffset,
                ),
              }),
        },
      }),
});

const registerExtractionCommand = (
  cli: CliInstance,
  logger: Logger,
  runProviderAnalysis: DirectAnalysis["runProviderAnalysis"],
): void => {
  cli.command(CLI_COMMANDS.extractArtifact, {
    description:
      "Extract regular contents of supported artifacts; DMG extraction is unavailable",
    args: z.object({
      path: z.string().describe("Application or package path"),
    }),
    options: z.object({
      integrityPolicy: z
        .enum(["fail", "record-and-continue"])
        .default("fail")
        .describe("Behavior when declared artifact integrity does not match"),
      ...espFlashSelectionOptions,
    }),
    run: ({ args, options }) =>
      logCliCommand(logger, "extract-artifact", () =>
        runProviderAnalysis(
          args.path,
          "extract_artifact",
          {
            integrity_policy: options.integrityPolicy,
            output_root: createArtifactExtractionDestination(),
          },
          logger,
          undefined,
          undefined,
          espFlashTargetSelection(options),
        ).then(projectCliAnalysisResult),
      ),
  });
};

const registerInspectionCommand = (
  cli: CliInstance,
  logger: Logger,
  runProviderAnalysis: DirectAnalysis["runProviderAnalysis"],
): void => {
  cli.command(CLI_COMMANDS.inspectArtifact, {
    description:
      "Inspect one artifact and return all available observations and next probes",
    args: z.object({
      path: z.string().min(1).describe("Application or package path"),
    }),
    options: z.object({
      ...analysisEvidenceDeliveryOptions,
      integrityPolicy: z
        .enum(["fail", "record-and-continue"])
        .default("fail")
        .describe("Behavior when declared artifact integrity does not match"),
      ...espFlashSelectionOptions,
    }),
    run: ({ args, options }) =>
      logCliCommand(logger, "inspect-artifact", () =>
        withCommandCancellation(async (signal) => {
          const delivery = {
            providerId: ARTIFACT_GRAPH_PROVIDER.id,
            operation: "inspect_artifact",
            signal,
            detail: options.detail,
            evidenceOutput: options.evidence_output,
          };
          const inputError = cliEvidenceDeliveryInputError(delivery);
          if (inputError !== undefined) return projectAnalysisError(inputError);
          const complete = await runProviderAnalysis(
            args.path,
            "inspect_artifact",
            { integrity_policy: options.integrityPolicy },
            logger,
            signal,
            undefined,
            espFlashTargetSelection(options),
          );
          return publishCliAnalysisEvidence(complete, delivery);
        }),
      ),
  });
};
