import { z } from "zod";

import type { AnalysisOperation } from "../application/AnalysisProvider.js";
import {
  MAX_GHIDRA_DISABLED_ANALYZER_NAME_LENGTH,
  MAX_GHIDRA_DISABLED_ANALYZER_NAMES,
} from "../config/ghidraDisabledAnalyzers.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";

/** Analyzer-options report format admitted by this adapter. */
const GHIDRA_DISABLED_ANALYZER_REPORT_FORMAT =
  "rea-ghidra-disabled-analyzers-v1";

/**
 * What the pre-analysis options script did with each configured name, in
 * configured order, as reported by the bridge handshake. `not_applicable`
 * names an installed analyzer Ghidra did not register for this program.
 */
export const ghidraDisabledAnalyzerReportSchema = z.strictObject({
  format: z.literal(GHIDRA_DISABLED_ANALYZER_REPORT_FORMAT),
  analyzers: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(MAX_GHIDRA_DISABLED_ANALYZER_NAME_LENGTH),
        status: z.enum(["disabled", "not_applicable"]),
      }),
    )
    .min(1)
    .max(MAX_GHIDRA_DISABLED_ANALYZER_NAMES),
});
export type GhidraDisabledAnalyzerReport = z.infer<
  typeof ghidraDisabledAnalyzerReportSchema
>;

/** The `analyzer_preset` value for a non-empty disabled-analyzer list. */
export const ghidraDisabledAnalyzerPreset = (
  entries: readonly string[],
): string => `ghidra-default+disabled:${entries.join(",")}`;

/** Fail closed when the session did not account for exactly the committed names. */
export const ghidraDisabledAnalyzerFailure = (
  committed: readonly string[] | undefined,
  report: GhidraDisabledAnalyzerReport | undefined,
  operation: AnalysisOperation,
): ProviderAdapterError | undefined => {
  if (committed === undefined && report === undefined) return undefined;
  const reason =
    committed === undefined
      ? "The Ghidra session reported REA_GHIDRA_DISABLED_ANALYZERS outcomes that the profile did not commit."
      : report === undefined
        ? "The Ghidra session did not report the outcome of the committed REA_GHIDRA_DISABLED_ANALYZERS."
        : report.analyzers.length !== committed.length ||
            report.analyzers.some(
              ({ name }, index) => name !== committed[index],
            )
          ? "The Ghidra session reported REA_GHIDRA_DISABLED_ANALYZERS outcomes for analyzers that differ from the committed profile."
          : undefined;
  return reason === undefined
    ? undefined
    : new ProviderAdapterError("ghidra", operation, {
        diagnostics: { reason },
      });
};

/** Name configured analyzers that Ghidra did not register for this program. */
export const ghidraDisabledAnalyzerLimitations = (
  report: GhidraDisabledAnalyzerReport | undefined,
): readonly string[] =>
  report?.analyzers.some(({ status }) => status === "not_applicable") === true
    ? [
        `Applied analyzer preset: ${ghidraDisabledAnalyzerPreset(
          report.analyzers.map(({ name, status }) =>
            status === "not_applicable" ? `${name}(n/a)` : name,
          ),
        )}. Ghidra did not register the (n/a) analyzers for this program, so REA_GHIDRA_DISABLED_ANALYZERS had nothing to disable for them; the analysis profile still commits every configured name.`,
      ]
    : [];
