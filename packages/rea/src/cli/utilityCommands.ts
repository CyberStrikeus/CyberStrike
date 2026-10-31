import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { z } from "incur";
import { cliIntegerArgument } from "./options.js";

import type { DirectAnalysis } from "../composition/directAnalysis.js";
import type { ReferenceSourcePolicy } from "../domain/referenceSourcePolicy.js";
import { createHistoricalSourceSummary } from "../domain/referenceSourceSummary.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { importReferenceSource } from "../application/ReferenceSourceImport.js";
import { projectReferenceSourceImportError } from "../application/ReferenceSourceImportTypes.js";
import type { AnalysisCleanupObservation } from "../domain/analysisErrorBase.js";
import { parseConfig } from "../config/parseConfig.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { projectInputIssues } from "../domain/inputIssueProjection.js";
import { safeParseJson } from "../domain/safeJson.js";
import { nativeUiScenarioInputSchema } from "../domain/native/nativeUiObservation.js";
import {
  nativeCommandTimeoutField,
  nativeUiDeadlineField,
} from "../domain/native/nativeDeadlines.js";
import { PRODUCT_IDENTITY } from "../identity.js";
import { isCliOperationFailure, logCliCommand } from "../cliLogging.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { swiftSymbolsSchema } from "../contracts/native/nativeToolContracts.js";
import { localPathStringSchema } from "../domain/localPath.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { registerNativeCallCommands } from "./nativeCallCommands.js";

export const registerUtilityCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
  analysis: Pick<DirectAnalysis, "runProviderAnalysis" | "runSessionStatus">,
): void => {
  const { runProviderAnalysis } = analysis;
  registerCapabilityCommands(cli, logger, analysis);
  registerNativeCommands(cli, logger, runProviderAnalysis);
  registerNativeCallCommands(cli, logger, runProviderAnalysis);
  registerNativeUiCommands(cli, logger, runProviderAnalysis);
  registerReferenceSourceCommand(cli, logger, environment);
};

const nativeUiScopeOptions = {
  pid: z.number().int().positive().describe("Existing application PID"),
  windowId: z
    .number()
    .int()
    .positive()
    .describe("Exact selected application window ID"),
  screenshot: z
    .boolean()
    .default(true)
    .describe("Capture only the selected window"),
  accessibility: z
    .boolean()
    .default(true)
    .describe("Read the selected window accessibility tree"),
  maxNodes: z
    .number()
    .int()
    .positive()
    .safe()
    .default(500)
    .describe("Maximum accessibility nodes per capture"),
  nativeUiDeadlineMs: nativeUiDeadlineField,
};

const nativeUiScope = (options: {
  readonly pid: number;
  readonly windowId: number;
  readonly screenshot: boolean;
  readonly accessibility: boolean;
  readonly maxNodes: number;
  readonly nativeUiDeadlineMs?: number | undefined;
}) => ({
  pid: options.pid,
  window_id: options.windowId,
  screenshot: options.screenshot,
  accessibility: options.accessibility,
  max_nodes: options.maxNodes,
  ...(options.nativeUiDeadlineMs === undefined
    ? {}
    : { native_ui_deadline_ms: options.nativeUiDeadlineMs }),
});

/**
 * Passive observation and active scenarios have different input contracts.
 * Only the scenario command accepts steps, so passive observation rejects
 * them as an unknown flag instead of silently dropping them.
 */
const registerNativeUiCommands = (
  cli: CliInstance,
  logger: Logger,
  runProviderAnalysis: DirectAnalysis["runProviderAnalysis"],
): void => {
  const pathArgument = z.object({
    path: localPathStringSchema.describe("Local native executable or app path"),
  });
  cli.command(CLI_COMMANDS.observeNativeUi, {
    description:
      "Observe one already-running native application window by PID and window ID",
    args: pathArgument,
    options: z.object(nativeUiScopeOptions),
    run: ({ args, options }) =>
      logCliCommand(logger, CLI_COMMANDS.observeNativeUi, () =>
        runProviderAnalysis(
          args.path,
          "observe_native_ui",
          nativeUiScope(options),
          logger,
        ).then(projectCliAnalysisResult),
      ),
  });
  const operation = "capture_native_ui_scenario";
  cli.command(CLI_COMMANDS.captureNativeUiScenario, {
    description:
      "Run declarative AX actions or waits in one exact native application window",
    args: pathArgument,
    options: z.object({
      ...nativeUiScopeOptions,
      steps: z
        .string()
        .describe(
          "Required JSON array of one or more declarative AX actions or waits",
        ),
    }),
    run: ({ args, options }) =>
      logCliCommand(logger, CLI_COMMANDS.captureNativeUiScenario, async () => {
        const parameters = nativeUiScope(options);
        const decoded = safeParseJson(options.steps);
        if (!decoded.ok)
          return invalidNativeUiScenarioInput(operation, [
            { path: ["steps"], reason: "invalid_format", expected: "JSON" },
          ]);
        const parsed = nativeUiScenarioInputSchema.safeParse({
          ...parameters,
          steps: decoded.value,
        });
        if (!parsed.success)
          return invalidNativeUiScenarioInput(
            operation,
            projectInputIssues(parsed.error.issues, {
              ...parameters,
              steps: decoded.value,
            }),
          );
        const { native_ui_deadline_ms: deadline, ...scenario } = parsed.data;
        return runProviderAnalysis(
          args.path,
          operation,
          deadline === undefined
            ? scenario
            : { ...scenario, native_ui_deadline_ms: deadline },
          logger,
        ).then(projectCliAnalysisResult);
      }),
  });
};

const invalidNativeUiScenarioInput = (
  operation: string,
  issues: ConstructorParameters<typeof AnalysisInputError>[2],
) => ({
  error: "Application workflow failed",
  ...projectAnalysisError(new AnalysisInputError(operation, undefined, issues)),
});

const registerCapabilityCommands = (
  cli: CliInstance,
  logger: Logger,
  { runSessionStatus }: Pick<DirectAnalysis, "runSessionStatus">,
): void => {
  for (const command of [
    CLI_COMMANDS.capabilities,
    CLI_COMMANDS.providers,
  ] as const) {
    cli.command(command, {
      description:
        command === "capabilities"
          ? "List provider capabilities and side effects"
          : "List configured analysis providers",
      run: () => logCliCommand(logger, command, () => runSessionStatus(logger)),
    });
  }
};

const registerNativeCommands = (
  cli: CliInstance,
  logger: Logger,
  runProviderAnalysis: DirectAnalysis["runProviderAnalysis"],
): void => {
  for (const [command, tool] of [
    [CLI_COMMANDS.inspectMacho, "inspect_macho"],
    [CLI_COMMANDS.inspectSignature, "inspect_signature"],
    [CLI_COMMANDS.listArchitectures, "list_architectures"],
  ] as const) {
    cli.command(command, {
      description: `Run ${tool} without launching Hopper`,
      args: z.object({
        path: localPathStringSchema.describe("Mach-O or app path"),
      }),
      options: z.object({
        nativeCommandTimeoutMs: nativeCommandTimeoutField,
      }),
      run: ({ args, options }) =>
        logCliCommand(logger, command, () =>
          runProviderAnalysis(
            args.path,
            tool,
            options.nativeCommandTimeoutMs === undefined
              ? {}
              : { native_command_timeout_ms: options.nativeCommandTimeoutMs },
            logger,
          ).then(projectCliAnalysisResult),
        ),
    });
  }
  cli.command(CLI_COMMANDS.inspectPlist, {
    description: "Parse app plist metadata without launching Hopper",
    args: z.object({
      path: localPathStringSchema.describe("App or Mach-O path"),
    }),
    options: z.object({
      relativePath: z
        .string()
        .optional()
        .describe(
          "Plist path relative to the app root, or an absolute path (default: the bundle's Info.plist)",
        ),
      nativeCommandTimeoutMs: nativeCommandTimeoutField,
    }),
    run: ({ args, options }) =>
      logCliCommand(logger, "inspect-plist", () =>
        runProviderAnalysis(
          args.path,
          "inspect_plist",
          {
            ...(options.relativePath === undefined
              ? {}
              : { path: options.relativePath }),
            ...(options.nativeCommandTimeoutMs === undefined
              ? {}
              : { native_command_timeout_ms: options.nativeCommandTimeoutMs }),
          },
          logger,
        ).then(projectCliAnalysisResult),
      ),
  });
  cli.command(CLI_COMMANDS.demangleSwift, {
    description: "Demangle Swift symbols without Hopper",
    args: z.object({
      path: localPathStringSchema.describe(
        "Artifact path used for evidence identity",
      ),
      symbols: swiftSymbolsSchema.describe("Swift mangled symbols to demangle"),
    }),
    options: z.object({
      nativeCommandTimeoutMs: nativeCommandTimeoutField,
    }),
    run: ({ args, options }) =>
      logCliCommand(logger, "demangle-swift", () =>
        runProviderAnalysis(
          args.path,
          "demangle_swift",
          {
            symbols: args.symbols,
            ...(options.nativeCommandTimeoutMs === undefined
              ? {}
              : { native_command_timeout_ms: options.nativeCommandTimeoutMs }),
          },
          logger,
        ).then(projectCliAnalysisResult),
      ),
  });
};

const registerReferenceSourceCommand = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  cli.command(CLI_COMMANDS.importReferenceSource, {
    description: "Import a source tree as historical reference only",
    args: z.object({
      root: z
        .string()
        .describe("Local source directory to import as historical reference"),
    }),
    options: z.object({
      detail: z
        .enum(["full", "summary"])
        .default("full")
        .describe(
          "Complete committed graph or compact historical-source summary",
        ),
      outlineDepth: cliIntegerArgument(0)
        .optional()
        .describe(
          "Summary outline path depth (default: 2; 0 omits entries); requires --detail summary",
        ),
    }),
    run: ({ args, options }) =>
      logCliCommand(
        logger,
        "import-reference-source",
        async () => {
          if (
            options.outlineDepth !== undefined &&
            options.detail !== "summary"
          )
            return {
              error: "Import failed",
              ...projectAnalysisError(
                new AnalysisInputError(
                  "import-reference-source",
                  { userMessage: "--outline-depth requires --detail summary" },
                  [
                    {
                      path: ["outlineDepth"],
                      reason: "invalid_value",
                      message: "--outline-depth requires --detail summary",
                    },
                  ],
                ),
              ),
            };
          const config = parseConfig(environment);
          if (!config.ok)
            return {
              error: "Import failed",
              ...projectAnalysisError(config.error),
            };
          return runReferenceSourceImport(
            args.root,
            config.value.referenceSourcePolicy,
            options.detail === "summary"
              ? (options.outlineDepth ?? 2)
              : undefined,
          );
        },
        isCliOperationFailure,
      ),
  });
};

const runReferenceSourceImport = async (
  root: string,
  policy: ReferenceSourcePolicy,
  outlineDepth: number | undefined,
): Promise<unknown> => {
  const resources = new ArtifactResourceScope();
  let outcome:
    | {
        readonly kind: "result";
        readonly imported: Awaited<ReturnType<typeof importReferenceSource>>;
      }
    | { readonly kind: "thrown"; readonly cause: unknown };
  try {
    outcome = {
      kind: "result",
      imported: await importReferenceSource(
        {
          root,
          caller: "rea-cli",
          policy,
          importer: PRODUCT_IDENTITY.packageName,
          importerVersion: PRODUCT_IDENTITY.packageVersion,
        },
        resources,
      ),
    };
  } catch (cause: unknown) {
    outcome = { kind: "thrown", cause };
  }

  let closeOutcome:
    | { readonly kind: "closed" }
    | { readonly kind: "failed"; readonly cause: unknown };
  try {
    await resources.close();
    closeOutcome = { kind: "closed" };
  } catch (cause: unknown) {
    closeOutcome = { kind: "failed", cause };
  }

  if (outcome.kind === "thrown") {
    if (closeOutcome.kind === "failed")
      throw new AggregateError(
        [outcome.cause, closeOutcome.cause],
        "Reference source import and cleanup both failed",
        { cause: outcome.cause },
      );
    throw outcome.cause;
  }

  const imported = outcome.imported;
  if (!imported.ok) {
    const cleanup =
      closeOutcome.kind === "closed"
        ? imported.error.cleanup
        : mergeReferenceSourceCleanup(
            imported.error.cleanup,
            ArtifactReaderFailure.cleanupObservation(
              closeOutcome.cause,
              "reference source",
            ),
          );
    return {
      error: "Import failed",
      ...projectReferenceSourceImportError({
        ...imported.error,
        ...(cleanup === undefined ? {} : { cleanup }),
      }),
    };
  }

  if (closeOutcome.kind === "failed")
    return {
      error: "Import failed",
      ...projectReferenceSourceImportError({
        tag: "reference-source-import",
        code: "io",
        message: "Reference source cleanup failed after import",
        cleanup: ArtifactReaderFailure.cleanupObservation(
          closeOutcome.cause,
          "reference source",
        ),
        cause: closeOutcome.cause,
      }),
    };
  return outlineDepth === undefined
    ? imported.value
    : createHistoricalSourceSummary(imported.value, outlineDepth);
};

const mergeReferenceSourceCleanup = (
  first: AnalysisCleanupObservation | undefined,
  second: AnalysisCleanupObservation,
): AnalysisCleanupObservation =>
  first === undefined
    ? second
    : {
        reason: `${first.reason}; ${second.reason}`,
        resources: [...new Set([...first.resources, ...second.resources])],
      };
