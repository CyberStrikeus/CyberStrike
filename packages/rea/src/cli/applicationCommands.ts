import { Cli, z } from "incur";

import { CLI_COMMANDS } from "../cliCommandNames.js";
import { parseCliJsonInput } from "../cliJsonInput.js";
import { logCliCommand } from "../cliLogging.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { Logger } from "pino";
import { registerSourceToBundleCommand } from "./sourceToBundleCommand.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import type { Evidence } from "../domain/evidence.js";
import type { Result } from "../domain/result.js";
import {
  evidenceBundleOption,
  runEvidenceInputCommand,
} from "./evidenceInputCommand.js";
import { withCommandCancellation } from "./commandCancellation.js";

type CliInstance = ReturnType<typeof Cli.create>;

/** Register CLI equivalents of provider-neutral application graph workflows. */
export const registerApplicationCommands = (
  cli: ReturnType<typeof Cli.create>,
  logger: Logger,
): void => {
  registerEvidenceJsonCommand({
    cli,
    logger,
    name: CLI_COMMANDS.traceApplicationFeature,
    operation: "trace_application_feature",
    description:
      "Trace a typed seed through authenticated application Evidence JSON",
    workflow: async (input, lookup, signal) => {
      const { traceApplicationFeatureEvidence } =
        await import("../application/javascript/JavaScriptApplicationWorkflowService.js");
      const result = traceApplicationFeatureEvidence(input, lookup, { signal });
      return result.ok ? { ok: true, value: result.value.evidence } : result;
    },
  });
  registerEvidenceJsonCommand({
    cli,
    logger,
    name: CLI_COMMANDS.traceJavaScriptSemantics,
    operation: "trace_javascript_semantics",
    description:
      "Trace bounded static semantic relations through authenticated application Evidence",
    workflow: async (input, lookup, signal) => {
      const { traceJavaScriptSemanticsEvidence } =
        await import("../application/javascript/JavaScriptSemanticTraceService.js");
      const result = traceJavaScriptSemanticsEvidence(input, lookup, {
        signal,
      });
      return result.ok ? { ok: true, value: result.value.evidence } : result;
    },
  });
  registerEvidenceJsonCommand({
    cli,
    logger,
    name: CLI_COMMANDS.compareApplicationVersions,
    operation: "compare_application_versions",
    description:
      "Compare two authenticated JavaScript Application Graph versions",
    workflow: async (input, lookup, signal) => {
      const { compareApplicationVersionsEvidence } =
        await import("../application/javascript/JavaScriptApplicationWorkflowService.js");
      const result = compareApplicationVersionsEvidence(input, lookup, {
        signal,
      });
      return result.ok ? { ok: true, value: result.value.evidence } : result;
    },
  });
  registerSourceToBundleCommand(cli, logger);
  registerEvidenceJsonCommand({
    cli,
    logger,
    name: CLI_COMMANDS.compareJavaScriptExportShapes,
    operation: "compare_javascript_export_shapes",
    description:
      "Compare exact static JavaScript export return shapes without execution",
    workflow: async (input, lookup, signal) => {
      const { compareJavaScriptExportShapesEvidence } =
        await import("../application/javascript/JavaScriptApplicationWorkflowService.js");
      const result = compareJavaScriptExportShapesEvidence(input, lookup, {
        signal,
      });
      return result.ok ? { ok: true, value: result.value.evidence } : result;
    },
  });
  registerObligationLedgerCommand(cli, logger);
  registerCoverageCommand(cli, logger);
  registerEvidenceJsonCommand({
    cli,
    logger,
    name: CLI_COMMANDS.projectAndroidApplicationGraph,
    operation: "project_android_application_graph",
    description:
      "Project authenticated APK inventory Evidence into an Android application graph",
    workflow: async (input, lookup, signal) => {
      const { projectAndroidApplicationEvidence } =
        await import("../application/android/AndroidApplicationService.js");
      const result = projectAndroidApplicationEvidence(input, lookup, {
        signal,
      });
      return result.ok ? { ok: true, value: result.value.evidence } : result;
    },
  });
  registerEvidenceJsonCommand({
    cli,
    logger,
    name: CLI_COMMANDS.projectAppleApplicationGraph,
    operation: "project_apple_application_graph",
    description:
      "Project authenticated IPA or macOS app inventory Evidence into an Apple application graph",
    workflow: async (input, lookup, signal) => {
      const { projectAppleApplicationEvidence } =
        await import("../application/apple/AppleApplicationService.js");
      const result = projectAppleApplicationEvidence(input, lookup, { signal });
      return result.ok ? { ok: true, value: result.value.evidence } : result;
    },
  });
  registerEvidenceJsonCommand({
    cli,
    logger,
    name: CLI_COMMANDS.projectHarmonyApplicationGraph,
    operation: "project_harmony_application_graph",
    description:
      "Project authenticated HarmonyOS HAP, HSP, or App Pack inventory Evidence into an application graph",
    workflow: async (input, lookup, signal) => {
      const { projectHarmonyApplicationEvidence } =
        await import("../application/harmony/HarmonyApplicationService.js");
      const result = projectHarmonyApplicationEvidence(input, lookup, {
        signal,
      });
      return result.ok ? { ok: true, value: result.value.evidence } : result;
    },
  });
};

const registerObligationLedgerCommand = (
  cli: CliInstance,
  logger: Logger,
): void =>
  registerJsonCommand({
    cli,
    logger,
    name: CLI_COMMANDS.buildReconstructionObligationLedger,
    description:
      "Generate a deterministic Evidence-backed reconstruction obligation ledger page",
    inputSchema: z.unknown(),
    workflow: async (input) => {
      const { buildReconstructionObligationLedgerEvidence } =
        await import("../application/ReconstructionObligationLedgerService.js");
      return buildReconstructionObligationLedgerEvidence(input);
    },
  });

const registerCoverageCommand = (cli: CliInstance, logger: Logger): void =>
  registerJsonCommand({
    cli,
    logger,
    name: CLI_COMMANDS.evaluateReconstructionCoverage,
    description: "Evaluate inline fail-closed reconstruction coverage",
    inputSchema: z.unknown(),
    workflow: async (input) => {
      const { evaluateReconstructionCoverage } =
        await import("../application/ReconstructionCoverageService.js");
      return evaluateReconstructionCoverage(input);
    },
  });

interface JsonCommandOptions<Schema extends z.ZodType> {
  readonly cli: CliInstance;
  readonly logger: Logger;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema;
  readonly workflow: (
    input: z.output<Schema>,
  ) => Promise<
    | { readonly ok: true; readonly value: JsonValue }
    | { readonly ok: false; readonly error: AnalysisError }
  >;
}

const registerJsonCommand = <Schema extends z.ZodType>({
  cli,
  logger,
  name,
  description,
  inputSchema,
  workflow,
}: JsonCommandOptions<Schema>): void => {
  cli.command(name, {
    description,
    args: z.object({
      inputJson: z.string().describe("Inline workflow JSON or JSON file path"),
    }),
    run: ({ args }) =>
      logCliCommand(logger, name, async () => {
        const input = await parseCliJsonInput(args.inputJson, name);
        if (!input.ok) return input.error;
        const parsed = inputSchema.safeParse(input.value);
        if (!parsed.success)
          return {
            error: "Application workflow failed",
            ...projectAnalysisError(
              analysisInputErrorFromIssues(
                name,
                parsed.error.issues,
                input.value,
              ),
            ),
          };
        const result = await workflow(parsed.data);
        return result.ok
          ? result.value
          : {
              error: "Application workflow failed",
              ...projectAnalysisError(result.error),
            };
      }),
  });
};

/** Evidence consumers share one explicit portable source and cancellation lifetime. */
const registerEvidenceJsonCommand = ({
  cli,
  logger,
  name,
  operation,
  description,
  workflow,
}: {
  readonly cli: CliInstance;
  readonly logger: Logger;
  readonly name: string;
  readonly operation: string;
  readonly description: string;
  readonly workflow: (
    input: unknown,
    lookup: EvidenceLookup | undefined,
    signal: AbortSignal,
  ) => Promise<Result<Evidence, AnalysisError>>;
}): void => {
  cli.command(name, {
    description,
    args: z.object({
      inputJson: z.string().describe("Inline workflow JSON or JSON file path"),
    }),
    options: z.object({ evidenceBundle: evidenceBundleOption }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, name, async () => {
          const input = await parseCliJsonInput(args.inputJson, name, signal);
          if (!input.ok) return input.error;
          const result = await runEvidenceInputCommand(
            operation,
            options.evidenceBundle,
            signal,
            (lookup) => workflow(input.value, lookup, signal),
          );
          return result.ok
            ? result.value
            : {
                error: "Application workflow failed",
                ...result.error,
              };
        }),
      ),
  });
};
