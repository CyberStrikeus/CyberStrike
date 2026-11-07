import { withCommandCancellation } from "./cli/commandCancellation.js";
import { safeParseJson } from "./domain/safeJson.js";
import { AnalysisInputError } from "./domain/analysisErrorCore.js";
import { analysisInputErrorFromIssues } from "./domain/inputIssueProjection.js";
import { bundleComparisonInputSchema } from "./domain/bundleComparison.js";
import { Cli, z } from "incur";

import {
  compareEvidenceBundlesCommand,
  exportEvidenceBundleCommand,
  importEvidenceBundleCommand,
} from "./application/EvidenceBundleCommands.js";
import { logCliCommand } from "./cliLogging.js";
import type { Logger } from "pino";
import { CLI_COMMANDS } from "./cliCommandNames.js";
import type { JsonValue } from "./domain/jsonValue.js";
import { projectAnalysisError } from "./domain/analysisErrorProjection.js";
import type { AnalysisError } from "./domain/analysisErrorBase.js";
import { localPathStringSchema } from "./domain/localPath.js";

/** Register caller-path Evidence commands. */
export const registerEvidenceCommands = (
  cli: ReturnType<typeof Cli.create>,
  logger: Logger,
): void => {
  cli.command(CLI_COMMANDS.evidenceImport, {
    description: "Validate and import a bounded local Evidence bundle",
    args: z.object({
      path: localPathStringSchema.describe("Evidence bundle JSON path"),
    }),
    run: ({ args }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, "evidence-import", async () => {
          const imported = await importEvidenceBundleCommand(args.path, signal);
          return imported.ok ? imported.value : cliError(imported.error);
        }),
      ),
  });
  cli.command(CLI_COMMANDS.evidenceExport, {
    description: "Validate and atomically export canonical Evidence JSON",
    args: z.object({
      source: localPathStringSchema.describe(
        "Existing evidence bundle JSON path",
      ),
      output: localPathStringSchema.describe("Canonical output JSON path"),
    }),
    options: z.object({
      overwrite: z.boolean().default(false).describe("Replace output file"),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, "evidence-export", async () => {
          const exported = await exportEvidenceBundleCommand(
            args.source,
            args.output,
            options.overwrite,
            signal,
          );
          return exported.ok ? exported.value : cliError(exported.error);
        }),
      ),
  });
  cli.command(CLI_COMMANDS.compare, {
    description:
      "Compare two canonical Evidence bundles by record identity; use compare-artifacts for artifact inventory contents",
    args: z.object({
      left: localPathStringSchema.describe("Left Evidence bundle JSON path"),
      right: localPathStringSchema.describe("Right Evidence bundle JSON path"),
    }),
    options: z.object({
      record_pairs: z
        .string()
        .optional()
        .describe(
          "JSON array of explicit left_evidence_id/right_evidence_id observation pairs",
        ),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, "compare", async () => {
          const decoded =
            options.record_pairs === undefined
              ? { ok: true as const, value: [] }
              : safeParseJson(options.record_pairs);
          if (!decoded.ok)
            return cliError(
              new AnalysisInputError(
                "compare_bundles",
                { cause: decoded.cause },
                [
                  {
                    path: ["record_pairs"],
                    reason: "invalid_format",
                    expected: "JSON array",
                  },
                ],
              ),
            );
          const input = { record_pairs: decoded.value };
          const selected = bundleComparisonInputSchema
            .pick({ record_pairs: true })
            .safeParse(input);
          if (!selected.success)
            return cliError(
              analysisInputErrorFromIssues(
                "compare_bundles",
                selected.error.issues,
                input,
              ),
            );
          const compared = await compareEvidenceBundlesCommand({
            leftPath: args.left,
            rightPath: args.right,
            recordPairs: selected.data.record_pairs,
            signal,
          });
          return compared.ok ? compared.value : cliError(compared.error);
        }),
      ),
  });
};

const cliError = (error: AnalysisError): JsonValue => ({
  error: "Analysis failed",
  ...projectAnalysisError(error),
});
