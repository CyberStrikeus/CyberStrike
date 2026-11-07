import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { Cli, z } from "incur";

import {
  listJavaScriptRuntimeTargets,
  observeJavaScriptRuntime,
} from "../application/javascript/JavaScriptRuntimeObservationService.js";
import { createJavaScriptRuntimeObservationProvider } from "../composition/javascriptRuntimeObservation.js";
import { V8InspectorAdmission } from "../inspector/V8InspectorProvider.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import {
  javascriptRuntimeKindSchema,
  listJavaScriptRuntimeTargetsInputSchema,
  observeJavaScriptRuntimeInputSchema,
} from "../domain/javascript/javascriptRuntimeObservation.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { Logger } from "pino";
import { withCommandCancellation } from "./commandCancellation.js";

const observeOptionsSchema = z.object({
  runtimeKind: javascriptRuntimeKindSchema
    .optional()
    .describe(
      "Declared target role; Inspector cannot authenticate the Electron role",
    ),
  observationMs: z
    .number()
    .int()
    .min(0)
    .default(100)
    .describe("Observation window in milliseconds"),
});

/** Register CLI equivalents of passive V8 Inspector tools. */
export const registerJavaScriptRuntimeObservationCommands = (
  cli: ReturnType<typeof Cli.create>,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  const admission = new V8InspectorAdmission();
  const providerForCommand = () =>
    createJavaScriptRuntimeObservationProvider(
      environment,
      undefined,
      admission,
    );
  cli.command(CLI_COMMANDS.listJavaScriptRuntimeTargets, {
    description: "List Node/Electron V8 Inspector targets",
    args: z.object({
      endpoint: z.string().describe("Literal-loopback Inspector endpoint"),
    }),
    run: ({ args }) =>
      withCommandCancellation((signal) =>
        logCliCommand(
          logger,
          CLI_COMMANDS.listJavaScriptRuntimeTargets,
          async () => {
            const provider = providerForCommand();
            const input = {
              inspector_endpoint: args.endpoint,
            };
            const parsed =
              listJavaScriptRuntimeTargetsInputSchema.safeParse(input);
            if (!parsed.success)
              return cliError(
                analysisInputErrorFromIssues(
                  "list_javascript_runtime_targets",
                  parsed.error.issues,
                  input,
                ),
              );
            return await finishAnalysisCommand(
              () =>
                listJavaScriptRuntimeTargets(provider, parsed.data, {
                  signal,
                }),
              { close: () => provider.close?.() ?? Promise.resolve() },
              provider.identity().id,
              "list_javascript_runtime_targets",
              signal,
              "V8 Inspector resources",
            ).then(projectCliAnalysisResult);
          },
        ),
      ),
  });

  cli.command(CLI_COMMANDS.observeJavaScriptRuntime, {
    description: "Passively observe one exact Node/Electron Inspector target",
    args: z.object({
      endpoint: z.string().describe("Literal-loopback Inspector endpoint"),
      targetId: z
        .string()
        .describe("Target from list-javascript-runtime-targets"),
    }),
    options: observeOptionsSchema,
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(
          logger,
          CLI_COMMANDS.observeJavaScriptRuntime,
          async () => {
            const provider = providerForCommand();
            const input = {
              inspector_endpoint: args.endpoint,
              target_id: args.targetId,
              runtime_kind: options.runtimeKind,
              observation_ms: options.observationMs,
            };
            const parsed = observeJavaScriptRuntimeInputSchema.safeParse(input);
            if (!parsed.success)
              return cliError(
                analysisInputErrorFromIssues(
                  "observe_javascript_runtime",
                  parsed.error.issues,
                  input,
                ),
              );
            return await finishAnalysisCommand(
              () =>
                observeJavaScriptRuntime(provider, parsed.data, {
                  signal,
                }),
              { close: () => provider.close?.() ?? Promise.resolve() },
              provider.identity().id,
              "observe_javascript_runtime",
              signal,
              "V8 Inspector resources",
            ).then(projectCliAnalysisResult);
          },
        ),
      ),
  });
};

const cliError = (
  error: Parameters<typeof projectAnalysisError>[0],
): JsonValue => ({
  error: "JavaScript runtime observation failed",
  ...projectAnalysisError(error),
});
