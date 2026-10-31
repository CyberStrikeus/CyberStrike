import { Cli } from "incur";
import { z } from "zod";

import { captureBrowserScenario } from "./application/BrowserScenarioCaptureService.js";
import { finishAnalysisCommand } from "./cli/finishAnalysisCommand.js";
import { withCommandCancellation } from "./cli/commandCancellation.js";
import {
  analysisEvidenceDeliveryOptions,
  cliEvidenceDeliveryInputError,
  publishCliAnalysisEvidence,
} from "./cli/analysisEvidenceDelivery.js";
import { CLI_COMMANDS } from "./cliCommandNames.js";
import { parseCliJsonInput, resolveCliJsonPaths } from "./cliJsonInput.js";
import { logCliCommand } from "./cliLogging.js";
import { projectAnalysisError } from "./domain/analysisErrorProjection.js";
import { analysisInputErrorFromIssues } from "./domain/inputIssueProjection.js";
import {
  browserScenarioSchema,
  type BrowserScenario,
} from "./domain/browserScenario.js";
import { err, ok, type Result } from "./domain/result.js";
import type { BrowserScenarioCapturePort } from "./application/BrowserScenarioCapturePort.js";
import type { JsonValue } from "./domain/jsonValue.js";
import type { Logger } from "pino";

const OPERATION = "capture_browser_scenario";

/** Register controlled browser execution and offline validation commands. */
export const registerBrowserScenarioCommands = (
  cli: ReturnType<typeof Cli.create>,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
  options: {
    readonly createProvider?: (
      environment: Readonly<Record<string, string | undefined>>,
    ) => BrowserScenarioCapturePort;
  } = {},
): void => {
  cli.command(CLI_COMMANDS.captureBrowserScenario, {
    description:
      "Run one bounded Playwright browser scenario and return Evidence",
    args: z.object({
      inputJson: z
        .string()
        .describe(
          "Inline browser scenario JSON, JSON file path, or '-' for stdin",
        ),
    }),
    options: z.object(analysisEvidenceDeliveryOptions),
    run: ({ args, options: delivery }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.captureBrowserScenario, async () => {
          const deliveryError = cliEvidenceDeliveryInputError({
            detail: delivery.detail,
            evidenceOutput: delivery.evidence_output,
            operation: OPERATION,
          });
          if (deliveryError !== undefined) return cliError(deliveryError);
          const scenario = await parseBrowserScenarioInput(
            args.inputJson,
            signal,
            "Browser scenario capture failed",
          );
          if (!scenario.ok) return scenario.error;
          // Load Playwright only for this command, not during CLI startup.
          const provider =
            options.createProvider === undefined
              ? await import("./composition/browserScenario.js").then(
                  ({ createBrowserScenarioProvider }) =>
                    createBrowserScenarioProvider(environment),
                )
              : options.createProvider(environment);
          const result = await finishAnalysisCommand(
            () => captureBrowserScenario(provider, scenario.value, { signal }),
            {
              close: async () => {
                await provider?.close?.();
              },
            },
            "rea-playwright-browser-scenario",
            OPERATION,
            signal,
            undefined,
            { failureProjection: "initial" },
          );
          if (!result.ok)
            return {
              error: "Browser scenario capture failed",
              ...result.error,
            };
          return publishCliAnalysisEvidence(result, {
            providerId: "rea-playwright-browser-scenario",
            operation: OPERATION,
            signal,
            detail: delivery.detail,
            evidenceOutput: delivery.evidence_output,
          });
        }),
      ),
  });
  registerBrowserScenarioValidationCommand(cli, logger);
};

/** Validate the execution contract without provider or environment access. */
const registerBrowserScenarioValidationCommand = (
  cli: ReturnType<typeof Cli.create>,
  logger: Logger,
): void => {
  cli.command(CLI_COMMANDS.validateBrowserScenario, {
    description:
      "Validate one browser scenario without launching or attaching to a browser",
    args: z.object({
      inputJson: z
        .string()
        .describe(
          "Inline browser scenario JSON, JSON file path, or '-' for stdin",
        ),
    }),
    run: ({ args }) =>
      withCommandCancellation((signal) =>
        logCliCommand(
          logger,
          CLI_COMMANDS.validateBrowserScenario,
          async () => {
            const scenario = await parseBrowserScenarioInput(
              args.inputJson,
              signal,
              "Browser scenario validation failed",
            );
            if (!scenario.ok) return scenario.error;
            return {
              valid: true,
              actions: scenario.value.actions.length,
              secrets: scenario.value.secrets.length,
            };
          },
        ),
      ),
  });
};

/** Keep caller-path normalization and canonical diagnostics identical for both commands. */
const parseBrowserScenarioInput = async (
  inputJson: string,
  signal: AbortSignal,
  headline: string,
): Promise<Result<BrowserScenario, JsonValue>> => {
  const input = await parseCliJsonInput(inputJson, OPERATION, signal);
  if (!input.ok) return input;
  const scenario = browserScenarioSchema.safeParse(
    resolveCliJsonPaths(input.value, [["browser", "executable_path"]]),
  );
  return scenario.success
    ? ok(scenario.data)
    : err(
        cliError(
          analysisInputErrorFromIssues(
            OPERATION,
            scenario.error.issues,
            input.value,
            { cause: scenario.error },
          ),
          headline,
        ),
      );
};

const cliError = (
  error: Parameters<typeof projectAnalysisError>[0],
  headline = "Browser scenario capture failed",
): JsonValue => ({
  error: headline,
  ...projectAnalysisError(error),
});
