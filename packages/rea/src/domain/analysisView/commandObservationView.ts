import { z } from "zod";
import {
  commandObservationSchema,
  gdbCommandResultSchema,
} from "../commandObservation.js";
import { digestSchema } from "../digests.js";
import { providerSchema } from "../evidence.js";
import { analysisInputErrorFromIssues } from "../inputIssueProjection.js";
import { jsonValueSchema } from "../jsonValue.js";
import { err, ok } from "../result.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  ownedView,
  type AdmittedView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import {
  boundedViewMessages,
  completeWithinViewCoverage,
} from "./analysisViewCoverage.js";
import { analysisViewInputError } from "./analysisViewErrors.js";
import { parseAnalysisViewResult } from "./analysisViewParent.js";

export const commandSummaryContext = {
  source_provider: providerSchema.nullable(),
  source_analysis_profile_digest: digestSchema.nullable(),
  source_parameters: jsonValueSchema,
};

/** Keep every ordered record, including asynchronous and unrecognized records. */
export const gdbCommandSummarySchema = gdbCommandResultSchema
  .omit({ console: true, target: true, log: true })
  .extend({
    available_counts: z.strictObject({
      records: z.number().int().nonnegative(),
      console_utf16_units: z.number().int().nonnegative(),
      target_utf16_units: z.number().int().nonnegative(),
      log_utf16_units: z.number().int().nonnegative(),
    }),
  });

/** Select existing owner facts without parsing a command or its output protocol. */
export const projectCommandObservationView = (
  parent: AnalysisViewParent,
  admitted: AdmittedView,
) => {
  const view = ownedView<SummaryAnalysisView>(admitted, "summary");
  if (view === undefined)
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message: "Command observations support summary views.",
        },
      ]),
    );
  if (
    parent.operation !== "gdb_console" &&
    parent.operation !== "inspect_with_objdump"
  )
    return err(
      analysisViewInputError([
        {
          path: ["source", "operation"],
          reason: "invalid_value",
          message: "Unsupported command-observation operation.",
        },
      ]),
    );
  const parameters = jsonValueSchema.safeParse(parent.parameters ?? null);
  if (!parameters.success)
    return err(
      analysisInputErrorFromIssues(
        "inspect_analysis_view",
        parameters.error.issues.map((issue) => ({
          ...issue,
          path: ["source", "parameters", ...issue.path],
        })),
        { source: { parameters: parent.parameters } },
        { cause: parameters.error },
      ),
    );
  const artifact =
    parent.subject === null
      ? null
      : parent.subject === undefined
        ? (parent.artifact ?? null)
        : {
            path: parent.subject.local_path,
            sha256: parent.subject.digest.sha256,
          };
  const shared = {
    kind: "summary" as const,
    view,
    parent_evidence_id: parent.evidenceId,
    parent_digest: parent.evidenceId.slice(3),
    artifact,
    source_provider: parent.provider ?? null,
    source_analysis_profile_digest: parent.analysisProfile?.digest ?? null,
    source_parameters: parameters.data,
    coverage: completeWithinViewCoverage(1, 1),
    limitations: boundedViewMessages(
      parent.limitations,
      parent.evidenceId,
      "limitations",
    ),
    unknowns: boundedViewMessages(
      [
        "This retained command observation does not establish current target state or global analysis coverage.",
      ],
      parent.evidenceId,
      "unknowns",
    ),
  };
  if (parent.operation === "gdb_console") {
    const parsed = parseAnalysisViewResult(gdbCommandResultSchema, parent);
    if (!parsed.ok) return parsed;
    const selection = parameters.data;
    if (
      typeof selection === "object" &&
      selection !== null &&
      !Array.isArray(selection) &&
      typeof selection.command === "string" &&
      selection.command !== parsed.value.command
    )
      return err(
        analysisViewInputError([
          {
            path: ["source", "parameters", "command"],
            reason: "invalid_value",
            message:
              "The captured command conflicts with its source parameters.",
          },
        ]),
      );
    const { console, target, log, ...records } = parsed.value;
    return ok({
      ...shared,
      parent_operation: "gdb_console" as const,
      summary: {
        ...records,
        available_counts: {
          records: records.records.length,
          console_utf16_units: console.length,
          target_utf16_units: target.length,
          log_utf16_units: log.length,
        },
      },
    });
  }
  const parsed = parseAnalysisViewResult(commandObservationSchema, parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  if (
    artifact !== null &&
    report.artifact_sha256_after !== null &&
    report.artifact_changed !== null &&
    report.artifact_changed !==
      (artifact.sha256 !== report.artifact_sha256_after)
  )
    return err(
      analysisViewInputError([
        {
          path: ["source", "normalized_result", "artifact_changed"],
          reason: "invalid_value",
          message:
            "The recorded artifact-change flag conflicts with the observed digests.",
        },
      ]),
    );
  return ok({
    ...shared,
    parent_operation: "inspect_with_objdump" as const,
    summary: report,
  });
};
