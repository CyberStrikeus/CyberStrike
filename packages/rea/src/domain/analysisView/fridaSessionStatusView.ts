import { z } from "zod";
import { providerSchema } from "../evidence.js";
import { fridaSessionStatusSchema } from "../fridaSessionStatus.js";
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

export const fridaSessionStatusSummarySchema = fridaSessionStatusSchema
  .omit({ messages: true })
  .extend({ messages_retained: z.number().int().nonnegative() });

export const fridaSessionStatusViewContext = {
  source_provider: providerSchema.nullable(),
  source_parameters: z.strictObject({ session_id: z.string().uuid() }),
};

/** Summarize captured facts without interpreting caller-authored message payloads. */
export const projectFridaSessionStatusView = (
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
          message: "Frida session status supports summary views.",
        },
      ]),
    );
  const report = parseAnalysisViewResult(fridaSessionStatusSchema, parent);
  if (!report.ok) return report;
  const parameters = fridaSessionStatusViewContext.source_parameters.safeParse(
    parent.parameters,
  );
  if (
    !parameters.success ||
    parameters.data.session_id !== report.value.session_id
  )
    return err(
      analysisViewInputError([
        {
          path: ["source", "parameters", "session_id"],
          reason: "invalid_value",
          message:
            "The Frida status must identify the session selected by its source parameters.",
        },
      ]),
    );
  const { messages, ...status } = report.value;
  return ok({
    kind: "summary" as const,
    view,
    parent_evidence_id: parent.evidenceId,
    parent_digest: parent.evidenceId.slice(3),
    parent_operation: "frida_session_status" as const,
    artifact: null,
    source_provider: parent.provider ?? null,
    source_parameters: parameters.data,
    summary: { ...status, messages_retained: messages.length },
    coverage: completeWithinViewCoverage(1, 1),
    limitations: boundedViewMessages(
      [
        ...parent.limitations,
        `Message payloads remain in complete parent Evidence ${parent.evidenceId}; export_evidence_bundle preserves them.`,
      ],
      parent.evidenceId,
      "limitations",
    ),
    unknowns: [
      "This is a captured session observation; querying retained Evidence does not refresh live state or establish target process identity after exit or reuse.",
      "messages_retained counts queued messages, not all target events. messages_truncated preserves the provider's capture limitation; payload meanings and global event coverage are unknown.",
    ],
  });
};
