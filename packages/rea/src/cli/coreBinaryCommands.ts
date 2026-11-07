import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { z } from "incur";
import { realpath, stat } from "node:fs/promises";
import { findAppBundleResourceRoot } from "../application/AppBundleExecutable.js";

import {
  addressOrProcedureGuidance,
  equalSelectorGuidance,
  requiredSelectorGuidance,
  resolveCliAnalysisSelector,
} from "./analysisSelector.js";
import type { DirectAnalysis } from "../composition/directAnalysis.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import type { Logger } from "pino";
import {
  directAnalysisOptionsFromCli,
  nativeOpenOptionFields,
  snapshotSelectionOption,
} from "./options.js";
import type { CliInstance } from "./types.js";
import {
  cliJavaScriptSourcePaths,
  runCliJavaScriptApplicationAnalysis,
} from "./javascriptApplicationAnalysis.js";
import { withCommandCancellation } from "./commandCancellation.js";
import {
  analysisEvidenceDeliveryOptions,
  cliEvidenceDeliveryInputError,
  publishCliAnalysisEvidence,
} from "./analysisEvidenceDelivery.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { javascriptApplicationOptions } from "../cliObservationOptions.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { localPathStringSchema } from "../domain/localPath.js";
import type { ExecutableFormatHint } from "../domain/dosCom.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { registerDecompileDirectoryCommand } from "./decompileDirectoryCommand.js";

const decompileSelectorGuidance = `${addressOrProcedureGuidance} Alternatively, use --file-offset alone.`;
const namedAddressGuidance = requiredSelectorGuidance(
  "the positional address or --address",
);
const querySelectorGuidance = requiredSelectorGuidance(
  "the positional query or --query",
);
const patternSelectorGuidance = requiredSelectorGuidance(
  "the positional pattern or --pattern",
);

/** Register provider-neutral binary overview and procedure CLI commands. */
export const registerCoreBinaryCommands = (
  cli: CliInstance,
  logger: Logger,
  runDirectAnalysis: DirectAnalysis["runDirectAnalysis"],
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  registerOverviewCommands(cli, logger, runDirectAnalysis, environment);
  registerDecompileCommand(cli, logger, runDirectAnalysis);
  registerDecompileDirectoryCommand(cli, logger, runDirectAnalysis);
  registerFunctionCommand(cli, logger, runDirectAnalysis);
  registerInstructionsCommand(cli, logger, runDirectAnalysis);
  registerSearchCommand(cli, logger, runDirectAnalysis);
  registerXrefsCommand(cli, logger, runDirectAnalysis);
  registerTraceCommand(cli, logger, runDirectAnalysis);
};

const registerOverviewCommands = (
  cli: CliInstance,
  logger: Logger,
  runDirectAnalysis: DirectAnalysis["runDirectAnalysis"],
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  const overviewOptions = z.object({
    snapshot: snapshotSelectionOption,
    ...nativeOpenOptionFields,
  });
  // `analyze` declares the JavaScript integrity policy for its JavaScript
  // lane. Preserve whether the caller supplied it until the target lane is
  // known, then apply the JavaScript default only in that lane. The owner
  // field fills an omission with that default, and an `.optional()` wrapper
  // keeps reporting it, so every binary target would look like an explicit
  // policy. Remove the owner's default before making the CLI option optional;
  // reapply its metadata so help and `--schema` keep describing the option.
  const ownerIntegrityPolicy =
    javascriptApplicationOptions.shape.integrityPolicy;
  const defaultIntegrityPolicy = ownerIntegrityPolicy.parse(undefined);
  const policyMetadata = ownerIntegrityPolicy.meta();
  const omittableIntegrityPolicy = ownerIntegrityPolicy
    .removeDefault()
    .optional();
  const laneIntegrityPolicy =
    policyMetadata === undefined
      ? omittableIntegrityPolicy
      : omittableIntegrityPolicy.meta(policyMetadata);
  cli.command(CLI_COMMANDS.analyze, {
    description: "Get an overview of an app",
    args: z.object({
      path: localPathStringSchema.describe(
        "App, program, or analysis database path",
      ),
    }),
    options: overviewOptions.extend({
      integrityPolicy: laneIntegrityPolicy,
      sourcePath: javascriptApplicationOptions.shape.sourcePath,
      sourcePathsJson: javascriptApplicationOptions.shape.sourcePathsJson,
    }),
    run: async ({ args, options }) => {
      // Route JavaScript targets exactly like analyze-javascript-application,
      // including typed cancellation; cancellation wraps logging so its exit
      // code is not replaced by the logged failure status.
      if (await routesToJavaScriptAnalysis(args.path, options))
        return withCommandCancellation((signal) =>
          logCliCommand(logger, "analyze", async () => {
            const sourcePaths = await cliJavaScriptSourcePaths(
              options.sourcePath,
              options.sourcePathsJson,
              signal,
            );
            if (!sourcePaths.ok) return sourcePaths.error;
            return runCliJavaScriptApplicationAnalysis(
              {
                input_path: absoluteCallerPath(args.path),
                integrity_policy:
                  options.integrityPolicy ?? defaultIntegrityPolicy,
                ...(sourcePaths.value === undefined
                  ? {}
                  : { source_paths: sourcePaths.value }),
              },
              environment,
              signal,
            );
          }),
        );
      return logCliCommand(logger, "analyze", () => {
        if (
          options.sourcePath !== undefined ||
          options.sourcePathsJson !== undefined
        )
          throw new AnalysisInputError(
            "analyze_javascript_application",
            undefined,
            [
              {
                path: ["source_paths"],
                reason: "invalid_value",
                message:
                  "Source selection requires the static JavaScript ASAR/directory analysis lane.",
              },
            ],
          );
        if (options.integrityPolicy !== undefined)
          throw new AnalysisInputError(
            "analyze_javascript_application",
            undefined,
            [
              {
                path: ["integrity_policy"],
                reason: "invalid_value",
                message:
                  "An integrity policy requires the static JavaScript ASAR/directory analysis lane; binary_overview accepts no input.",
              },
            ],
          );
        return runDirectAnalysis(
          args.path,
          "binary_overview",
          {},
          directAnalysisOptionsFromCli(logger, options),
        ).then(projectCliAnalysisResult);
      });
    },
  });
  cli.command(CLI_COMMANDS.inspect, {
    description: "Inspect an app overview with evidence",
    args: z.object({
      path: localPathStringSchema.describe(
        "App, program, or analysis database path",
      ),
    }),
    options: overviewOptions,
    run: ({ args, options }) =>
      logCliCommand(logger, "inspect", () =>
        runDirectAnalysis(
          args.path,
          "binary_overview",
          {},
          directAnalysisOptionsFromCli(logger, options),
        ).then(projectCliAnalysisResult),
      ),
  });
};

const registerDecompileCommand = (
  cli: CliInstance,
  logger: Logger,
  runDirectAnalysis: DirectAnalysis["runDirectAnalysis"],
): void => {
  cli.command(CLI_COMMANDS.decompile, {
    description: `Read one part of an app as code. ${decompileSelectorGuidance} Equal positional and --procedure values are accepted; conflicts fail.`,
    args: z.object({
      path: localPathStringSchema.describe("App or program path"),
      address: z
        .string()
        .min(1)
        .optional()
        .describe(`Procedure name or address. ${decompileSelectorGuidance}`),
    }),
    options: z.object({
      procedure: z
        .string()
        .min(1)
        .optional()
        .describe(
          `Procedure name or address; use --procedure=<value> for leading dashes. ${decompileSelectorGuidance}`,
        ),
      "file-offset": z
        .string()
        .regex(/^0x[0-9a-fA-F]+$/u)
        .optional()
        .describe(
          `Ghidra source-file byte offset; mapped internally to an analysis address. ${decompileSelectorGuidance}`,
        ),
      snapshot: snapshotSelectionOption,
      ...nativeOpenOptionFields,
    }),
    run: ({ args, options }) =>
      logCliCommand(logger, "decompile", () =>
        runDirectAnalysis(
          args.path,
          "procedure_pseudo_code",
          {
            procedure: resolveCliAnalysisSelector(
              args.address,
              options["file-offset"] === undefined
                ? options.procedure
                : resolveCliAnalysisSelector(
                    options.procedure,
                    `file-offset:${options["file-offset"]}`,
                    "file-offset",
                    "procedure_pseudo_code",
                  ),
              options["file-offset"] === undefined
                ? "procedure"
                : "file-offset",
              "procedure_pseudo_code",
            ),
          },
          directAnalysisOptionsFromCli(logger, options),
        ).then(projectCliAnalysisResult),
      ),
  });
};

/** Select static JavaScript analysis only when no binary-analysis option applies. */
const routesToJavaScriptAnalysis = async (
  path: string,
  options: {
    readonly snapshot?: string | undefined;
    readonly "target-format"?: ExecutableFormatHint | undefined;
    readonly architecture?: string | undefined;
    readonly "entry-point"?: string | undefined;
    readonly provider?: string | undefined;
  },
): Promise<boolean> =>
  options.provider === undefined &&
  options.snapshot === undefined &&
  options["target-format"] === undefined &&
  options.architecture === undefined &&
  options["entry-point"] === undefined &&
  (await isJavaScriptApplicationPath(path));

const isJavaScriptApplicationPath = async (path: string): Promise<boolean> => {
  try {
    const canonical = await realpath(path);
    if (canonical.toLowerCase().endsWith(".asar")) return true;
    if (!(await stat(canonical)).isDirectory()) return false;
    const bundle = await findAppBundleResourceRoot(canonical);
    // Unresolved native metadata must reach native admission's typed failure.
    return bundle.ok && bundle.value === undefined;
  } catch (cause: unknown) {
    void cause;
    return false;
  }
};

const registerXrefsCommand = (
  cli: CliInstance,
  logger: Logger,
  runDirectAnalysis: DirectAnalysis["runDirectAnalysis"],
): void => {
  cli.command(CLI_COMMANDS.xrefs, {
    description: `List bounded references to an analyzed address. ${namedAddressGuidance} ${equalSelectorGuidance}`,
    args: z.object({
      path: localPathStringSchema.describe("App or program path"),
      address: z
        .string()
        .min(1)
        .optional()
        .describe(`Address or symbol name. ${namedAddressGuidance}`),
    }),
    options: z.object({
      address: z
        .string()
        .min(1)
        .optional()
        .describe(
          `Address or symbol name; use --address=<value> for leading dashes. ${namedAddressGuidance}`,
        ),
      snapshot: snapshotSelectionOption,
      ...nativeOpenOptionFields,
    }),
    run: ({ args, options }) =>
      logCliCommand(logger, "xrefs", () =>
        runDirectAnalysis(
          args.path,
          "xrefs",
          {
            address: resolveCliAnalysisSelector(
              args.address,
              options.address,
              "address",
              "xrefs",
            ),
          },
          directAnalysisOptionsFromCli(logger, options),
        ).then(projectCliAnalysisResult),
      ),
  });
};

const registerTraceCommand = (
  cli: CliInstance,
  logger: Logger,
  runDirectAnalysis: DirectAnalysis["runDirectAnalysis"],
): void => {
  cli.command(CLI_COMMANDS.trace, {
    description: `Trace a literal feature through analyzed references. ${querySelectorGuidance} ${equalSelectorGuidance}`,
    args: z.object({
      path: localPathStringSchema.describe("App or program path"),
      query: z
        .string()
        .min(1)
        .optional()
        .describe(`Literal feature query. ${querySelectorGuidance}`),
    }),
    options: z.object({
      query: z
        .string()
        .min(1)
        .optional()
        .describe(
          `Complete literal feature query; use --query=<value> for leading dashes. ${querySelectorGuidance}`,
        ),
      caseSensitive: z
        .boolean()
        .default(false)
        .describe("Match the query with exact letter case"),
      snapshot: snapshotSelectionOption,
      ...nativeOpenOptionFields,
    }),
    run: ({ args, options }) =>
      logCliCommand(logger, "trace", () =>
        runDirectAnalysis(
          args.path,
          "trace_feature",
          {
            query: resolveCliAnalysisSelector(
              args.query,
              options.query,
              "query",
              "trace_feature",
            ),
            case_sensitive: options.caseSensitive,
          },
          directAnalysisOptionsFromCli(logger, options),
        ).then(projectCliAnalysisResult),
      ),
  });
};

const registerFunctionCommand = (
  cli: CliInstance,
  logger: Logger,
  runDirectAnalysis: DirectAnalysis["runDirectAnalysis"],
): void => {
  cli.command(CLI_COMMANDS.function, {
    description: `Analyze one complete function with evidence. ${addressOrProcedureGuidance} ${equalSelectorGuidance}`,
    args: z.object({
      path: localPathStringSchema.describe("App or program path"),
      address: z
        .string()
        .min(1)
        .optional()
        .describe(`Procedure name or address. ${addressOrProcedureGuidance}`),
    }),
    options: z.object({
      procedure: z
        .string()
        .min(1)
        .optional()
        .describe(
          `Procedure name or address; use --procedure=<value> for leading dashes. ${addressOrProcedureGuidance}`,
        ),
      snapshot: snapshotSelectionOption,
      ...analysisEvidenceDeliveryOptions,
      ...nativeOpenOptionFields,
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, "function", async () => {
          const delivery = {
            providerId: "auto",
            operation: "analyze_function",
            signal,
            detail: options.detail,
            evidenceOutput: options.evidence_output,
          };
          // Fail before analysis when summary delivery lacks its Evidence bundle sink.
          const inputError = cliEvidenceDeliveryInputError(delivery);
          if (inputError !== undefined) return projectAnalysisError(inputError);
          const complete = await runDirectAnalysis(
            args.path,
            "analyze_function",
            {
              procedure: resolveCliAnalysisSelector(
                args.address,
                options.procedure,
                "procedure",
                "analyze_function",
              ),
            },
            { ...directAnalysisOptionsFromCli(logger, options), signal },
          );
          return publishCliAnalysisEvidence(complete, delivery);
        }),
      ),
  });
};

const registerInstructionsCommand = (
  cli: CliInstance,
  logger: Logger,
  runDirectAnalysis: DirectAnalysis["runDirectAnalysis"],
): void => {
  cli.command(CLI_COMMANDS.instructions, {
    description: `Read every raw instruction without decompiling. ${addressOrProcedureGuidance} ${equalSelectorGuidance}`,
    args: z.object({
      path: localPathStringSchema.describe("App or program path"),
      address: z
        .string()
        .min(1)
        .optional()
        .describe(`Procedure name or address. ${addressOrProcedureGuidance}`),
    }),
    options: z.object({
      procedure: z
        .string()
        .min(1)
        .optional()
        .describe(
          `Procedure name or address; use --procedure=<value> for leading dashes. ${addressOrProcedureGuidance}`,
        ),
      snapshot: snapshotSelectionOption,
      ...nativeOpenOptionFields,
    }),
    run: ({ args, options }) =>
      logCliCommand(logger, CLI_COMMANDS.instructions, () =>
        runDirectAnalysis(
          args.path,
          "read_function_instructions",
          {
            procedure: resolveCliAnalysisSelector(
              args.address,
              options.procedure,
              "procedure",
              "read_function_instructions",
            ),
          },
          directAnalysisOptionsFromCli(logger, options),
        ).then(projectCliAnalysisResult),
      ),
  });
};

const registerSearchCommand = (
  cli: CliInstance,
  logger: Logger,
  runDirectAnalysis: DirectAnalysis["runDirectAnalysis"],
): void => {
  cli.command(CLI_COMMANDS.search, {
    description: `Search every analyzed string or procedure name. ${patternSelectorGuidance} ${equalSelectorGuidance}`,
    args: z.object({
      path: localPathStringSchema.describe("App or program path"),
      pattern: z
        .string()
        .min(1)
        .optional()
        .describe(`Literal text or regex pattern. ${patternSelectorGuidance}`),
    }),
    options: z.object({
      pattern: z
        .string()
        .min(1)
        .optional()
        .describe(
          `Complete literal text or regex pattern; use --pattern=<value> for leading dashes. ${patternSelectorGuidance}`,
        ),
      kind: z
        .enum(["strings", "procedures"])
        .default("strings")
        .describe("Analyzed item kind to search"),
      mode: z
        .enum(["literal", "regex"])
        .default("literal")
        .describe("Interpret the pattern as literal text or a regex"),
      caseSensitive: z
        .boolean()
        .default(false)
        .describe("Match the pattern with exact letter case"),
      snapshot: snapshotSelectionOption,
      ...nativeOpenOptionFields,
    }),
    run: ({ args, options }) =>
      logCliCommand(logger, "search", () =>
        runDirectAnalysis(
          args.path,
          options.kind === "strings" ? "search_strings" : "search_procedures",
          {
            pattern: resolveCliAnalysisSelector(
              args.pattern,
              options.pattern,
              "pattern",
              options.kind === "strings"
                ? "search_strings"
                : "search_procedures",
            ),
            mode: options.mode,
            case_sensitive: options.caseSensitive,
          },
          directAnalysisOptionsFromCli(logger, options),
        ).then(projectCliAnalysisResult),
      ),
  });
};
