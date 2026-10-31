import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { parseCliAnalysisEvidenceDelivery } from "./analysisEvidenceDelivery.js";
import { javaScriptRoutesDeliverySchema } from "../domain/analysisView/javascriptRoutesView.js";
import { isAbsolute, resolve, sep } from "node:path";

import { Cli, z } from "incur";

import { logCliCommand } from "../cliLogging.js";
import {
  inspectElectronPageInputSchema,
  listElectronTargetsInputSchema,
} from "../domain/javascript/electronObservation.js";
import { electronActiveObservationInputSchema } from "../domain/javascript/electronActiveObservation.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { projectInputIssues } from "../domain/inputIssueProjection.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { Logger } from "pino";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { createElectronFuseService } from "../composition/electronFuses.js";
import { parseCliJsonInput, resolveCliJsonPaths } from "../cliJsonInput.js";
import {
  electronPageInspectionOptions,
  javascriptApplicationOptions,
  selectedCommandTimeout,
} from "../cliObservationOptions.js";
import {
  cliJavaScriptSourcePaths,
  runCliJavaScriptApplicationAnalysis,
} from "./javascriptApplicationAnalysis.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";
import type { ElectronActiveObservationPort } from "../application/javascript/ElectronActiveObservationPort.js";
import {
  evidenceBundleOption,
  runEvidenceInputCommand,
} from "./evidenceInputCommand.js";

/** Register CLI equivalents of the Electron MCP tools. */
export const registerElectronCommands = (
  cli: ReturnType<typeof Cli.create>,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
  options: {
    readonly createActiveProvider?: (
      environment: Readonly<Record<string, string | undefined>>,
    ) => ElectronActiveObservationPort;
  } = {},
): void => {
  registerElectronObservationCommands(cli, logger, environment);
  registerElectronFuseCommand(cli, logger);
  registerElectronActiveCommand(cli, logger, environment, options);
  registerJavaScriptApplicationCommand(cli, logger, environment);
  registerJavaScriptRuntimeReconciliationCommand(cli, logger);
};

const registerElectronFuseCommand = (
  cli: ReturnType<typeof Cli.create>,
  logger: Logger,
): void => {
  cli.command(CLI_COMMANDS.inspectElectronFuses, {
    description:
      "Inspect packaged Electron fuse bytes without launching the application",
    args: z.object({
      path: z
        .string()
        .describe(
          "Local Electron .app, Electron Framework binary, PE executable, or ELF executable",
        ),
    }),
    run: ({ args }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.inspectElectronFuses, async () => {
          const service = createElectronFuseService();
          return finishAnalysisCommand(
            () =>
              service.inspect(
                { path: absoluteElectronFusePath(args.path) },
                { signal },
              ),
            service,
            service.provider.identity.id,
            "inspect_electron_fuses",
            signal,
          ).then(projectCliAnalysisResult);
        }),
      ),
  });
};

/** Anchor relative input without changing which file symlink/.. selects. */
const absoluteElectronFusePath = (path: string): string => {
  if (path === "") return path;
  // Win32 resolves dot components before directory links, including drive-relative paths.
  if (sep === "\\") return resolve(path);
  if (isAbsolute(path)) return path;
  const base = process.cwd();
  return `${base}${base.endsWith(sep) ? "" : sep}${path}`;
};

const registerElectronActiveCommand = (
  cli: ReturnType<typeof Cli.create>,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
  options: {
    readonly createActiveProvider?: (
      environment: Readonly<Record<string, string | undefined>>,
    ) => ElectronActiveObservationPort;
  },
): void => {
  cli.command(CLI_COMMANDS.captureElectronScenario, {
    description: "Run one owned Electron scenario with cancellable actions",
    args: z.object({
      inputJson: z
        .string()
        .describe(
          "Inline JSON or a JSON file matching capture_electron_scenario",
        ),
    }),
    run: ({ args }) =>
      withCommandCancellation((signal) =>
        logCliCommand(
          logger,
          CLI_COMMANDS.captureElectronScenario,
          async () => {
            const input = await parseCliJsonInput(
              args.inputJson,
              "capture_electron_scenario",
              signal,
            );
            if (!input.ok) return input.error;
            const parsed = electronActiveObservationInputSchema.safeParse(
              resolveCliJsonPaths(input.value, [
                ["executable_path"],
                ["application_path"],
                ["application_root"],
              ]),
            );
            if (!parsed.success)
              return inputError(
                "capture_electron_scenario",
                parsed.error.issues,
                input.value,
              );
            const { captureElectronScenario } =
              await import("../application/javascript/ElectronActiveObservationService.js");
            const provider =
              options.createActiveProvider === undefined
                ? await import("../composition/electronScenario.js").then(
                    ({ createElectronScenarioProvider }) =>
                      createElectronScenarioProvider(environment),
                  )
                : options.createActiveProvider(environment);
            const result = await finishAnalysisCommand(
              () => captureElectronScenario(provider, parsed.data, { signal }),
              {
                close: async () => {
                  await provider.close?.();
                },
              },
              provider.identity().id,
              "capture_electron_scenario",
              signal,
            );
            return result.ok
              ? result.value
              : { error: "Electron analysis failed", ...result.error };
          },
        ),
      ),
  });
};

const registerJavaScriptRuntimeReconciliationCommand = (
  cli: ReturnType<typeof Cli.create>,
  logger: Logger,
): void => {
  cli.command(CLI_COMMANDS.reconcileJavaScriptRuntime, {
    description:
      "Reconcile static application and passive runtime Evidence JSON",
    args: z.object({
      inputJson: z
        .string()
        .describe(
          "Inline JSON or a JSON file path matching reconcile_javascript_runtime",
        ),
    }),
    options: z.object({ evidenceBundle: evidenceBundleOption }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(
          logger,
          CLI_COMMANDS.reconcileJavaScriptRuntime,
          async () => {
            const input = await parseCliJsonInput(
              args.inputJson,
              "reconcile_javascript_runtime",
              signal,
            );
            if (!input.ok) return input.error;
            const { reconcileJavaScriptRuntimeEvidence } =
              await import("../application/javascript/JavaScriptRuntimeReconciliationService.js");
            const result = await runEvidenceInputCommand(
              "reconcile_javascript_runtime",
              options.evidenceBundle,
              signal,
              async (lookup) => {
                const reconciled = reconcileJavaScriptRuntimeEvidence(
                  input.value,
                  lookup,
                  { signal },
                );
                return reconciled.ok
                  ? { ok: true, value: reconciled.value.evidence }
                  : reconciled;
              },
            );
            return result.ok
              ? result.value
              : { error: "Application workflow failed", ...result.error };
          },
        ),
      ),
  });
};

const registerElectronObservationCommands = (
  cli: ReturnType<typeof Cli.create>,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  registerElectronTargetList(cli, logger, environment);
  registerElectronPageInspection(cli, logger, environment);
};

const registerElectronTargetList = (
  cli: ReturnType<typeof Cli.create>,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  cli.command(CLI_COMMANDS.listElectronTargets, {
    description:
      "List local file pages exposed by the selected Electron CDP endpoint",
    args: z.object({
      endpoint: z.string().describe("Literal-loopback Electron CDP endpoint"),
    }),
    run: ({ args }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, "list-electron-targets", async () => {
          const provider =
            await createCliElectronObservationProvider(environment);
          const input = {
            cdp_endpoint: args.endpoint,
          };
          const parsed = listElectronTargetsInputSchema.safeParse(input);
          if (!parsed.success)
            return inputError(
              "list_electron_targets",
              parsed.error.issues,
              input,
            );
          const { listElectronTargets } =
            await import("../application/javascript/ElectronObservationService.js");
          return await finishAnalysisCommand(
            () => listElectronTargets(provider, parsed.data, { signal }),
            {
              close: async () => {
                await provider.close?.();
              },
            },
            provider.identity().id,
            "list_electron_targets",
            signal,
          ).then(projectCliAnalysisResult);
        }),
      ),
  });
};

const registerElectronPageInspection = (
  cli: ReturnType<typeof Cli.create>,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  cli.command(CLI_COMMANDS.inspectElectronPage, {
    description: "Passively inspect one Electron file page",
    args: z.object({
      endpoint: z.string().describe("Literal-loopback Electron CDP endpoint"),
      targetId: z.string().describe("Target ID from list-electron-targets"),
    }),
    options: electronPageInspectionOptions,
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, "inspect-electron-page", async () => {
          const provider =
            await createCliElectronObservationProvider(environment);
          const input = {
            cdp_endpoint: args.endpoint,
            target_id: args.targetId,
            observation_ms: options.observationMs,
            include_script_sources: options.includeScriptSources,
            ...selectedCommandTimeout(options.commandTimeoutMs),
          };
          const parsed = inspectElectronPageInputSchema.safeParse(input);
          if (!parsed.success)
            return inputError(
              "inspect_electron_page",
              parsed.error.issues,
              input,
            );
          const { inspectElectronPage } =
            await import("../application/javascript/ElectronObservationService.js");
          return await finishAnalysisCommand(
            () => inspectElectronPage(provider, parsed.data, { signal }),
            {
              close: async () => {
                await provider.close?.();
              },
            },
            provider.identity().id,
            "inspect_electron_page",
            signal,
          ).then(projectCliAnalysisResult);
        }),
      ),
  });
};

const registerJavaScriptApplicationCommand = (
  cli: ReturnType<typeof Cli.create>,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  cli.command(CLI_COMMANDS.analyzeJavaScriptApplication, {
    description:
      "Statically reconstruct a local JavaScript/Electron application",
    args: z.object({
      path: z.string().describe("ASAR or extracted application path"),
    }),
    options: javascriptApplicationOptions,
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(
          logger,
          CLI_COMMANDS.analyzeJavaScriptApplication,
          async () => {
            const delivery = parseCliAnalysisEvidenceDelivery(
              "analyze_javascript_application",
              options,
              javaScriptRoutesDeliverySchema,
            );
            if (!delivery.ok) return projectAnalysisError(delivery.error);
            const sourcePaths = await cliJavaScriptSourcePaths(
              options.sourcePath,
              options.sourcePathsJson,
              signal,
            );
            if (!sourcePaths.ok) return sourcePaths.error;
            return runCliJavaScriptApplicationAnalysis(
              {
                // An empty path names no file; leave it for input validation.
                input_path:
                  args.path === "" ? args.path : absoluteCallerPath(args.path),
                format: options.artifactFormat,
                integrity_policy: options.integrityPolicy,
                ...(options.maxSemanticNodes === undefined
                  ? {}
                  : { max_semantic_nodes: options.maxSemanticNodes }),
                ...(options.maxSemanticNodesPerFile === undefined
                  ? {}
                  : {
                      max_semantic_nodes_per_file:
                        options.maxSemanticNodesPerFile,
                    }),
                ...(options.maxSemanticUnknowns === undefined
                  ? {}
                  : { max_semantic_unknowns: options.maxSemanticUnknowns }),
                ...(options.maxSemanticUnknownsPerFile === undefined
                  ? {}
                  : {
                      max_semantic_unknowns_per_file:
                        options.maxSemanticUnknownsPerFile,
                    }),
                ...(sourcePaths.value === undefined
                  ? {}
                  : { source_paths: sourcePaths.value }),
                ...(options.maxHeapMb === undefined
                  ? {}
                  : { max_heap_mb: options.maxHeapMb }),
                ...(options.analysisTimeoutMs === undefined
                  ? {}
                  : { analysis_timeout_ms: options.analysisTimeoutMs }),
              },
              environment,
              signal,
              delivery.value,
            );
          },
        ),
      ),
  });
};

const createCliElectronObservationProvider = async (
  environment: Readonly<Record<string, string | undefined>>,
) => {
  const { createElectronObservationProvider } =
    await import("../composition/electronObservation.js");
  return createElectronObservationProvider(environment);
};

const inputError = (
  operation: string,
  issues?: Parameters<typeof projectInputIssues>[0],
  input?: unknown,
): JsonValue =>
  cliError(
    new AnalysisInputError(
      operation,
      undefined,
      issues === undefined ? [] : projectInputIssues(issues, input),
    ),
  );

const cliError = (
  error: Parameters<typeof projectAnalysisError>[0],
  label = "Electron analysis failed",
): JsonValue => ({
  error: label,
  ...projectAnalysisError(error),
});
