import { z } from "incur";
import type { Logger } from "pino";
import { matchNativeFunctionsFromBundles } from "../application/native/NativeFunctionMatchingService.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { matchNativeFunctionsInputSchema } from "../contracts/native/functionMatchingContracts.js";
import { FUNCTION_COMPARISON_PROVIDER } from "../domain/comparisonEvidenceIdentity.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { parseCliJsonInput } from "../cliJsonInput.js";
import { logCliCommand } from "../cliLogging.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { Evidence } from "../domain/evidence.js";
import { withCommandCancellation } from "./commandCancellation.js";
import {
  cliEvidenceDeliveryInputError,
  publishCliAnalysisEvidence,
} from "./analysisEvidenceDelivery.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";
import type { CliInstance } from "./types.js";
import { parseNativeMatchingAllowance } from "../config/nativeMatchingAllowance.js";

/** Resolve portable input bundles, then use the same read-only matching service as MCP. */
export const registerNativeFunctionMatchingCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<NodeJS.ProcessEnv>,
): void => {
  cli.command(CLI_COMMANDS.matchNativeFunctions, {
    description:
      "Match two observed native function inventories without executing targets",
    args: z.object({
      input: z
        .string()
        .describe(
          "JSON or JSON file: left/right inventories, optional observations and detail",
        ),
    }),
    options: z.object({
      source_bundle: z
        .array(z.string())
        .default([])
        .describe(
          "Canonical source Evidence bundle for retained references; repeat for each input",
        ),
      evidence_output: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Save full matching Evidence and selected sources; required for default summary; never overwrites",
        ),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.matchNativeFunctions, async () => {
          const input = await parseCliJsonInput(
            args.input,
            "match_native_functions",
            signal,
          );
          if (!input.ok) return input.error;
          const parsed = matchNativeFunctionsInputSchema.safeParse(input.value);
          if (!parsed.success)
            return projectAnalysisError(
              analysisInputErrorFromIssues(
                "match_native_functions",
                parsed.error.issues,
                input.value,
              ),
            );
          const delivery = {
            providerId: FUNCTION_COMPARISON_PROVIDER.id,
            operation: "match_native_functions",
            signal,
            detail: parsed.data.detail,
            evidenceOutput: options.evidence_output,
          };
          const invalid = cliEvidenceDeliveryInputError(delivery);
          if (invalid !== undefined) return projectAnalysisError(invalid);
          const allowance = parseNativeMatchingAllowance(environment);
          if (!allowance.ok) return projectAnalysisError(allowance.error);
          const resources = new ArtifactResourceScope();
          let sources: readonly Evidence[] = [];
          const complete = await finishAnalysisCommand(
            async () => {
              const result = await matchNativeFunctionsFromBundles(
                parsed.data,
                options.source_bundle,
                resources,
                { signal, representationAllowance: allowance.value },
              );
              if (!result.ok) return result;
              sources = result.value.sources;
              return { ok: true as const, value: result.value.evidence };
            },
            resources,
            delivery.providerId,
            delivery.operation,
            signal,
          );
          return publishCliAnalysisEvidence(complete, {
            ...delivery,
            sourceEvidence: sources,
          });
        }),
      ),
  });
};
