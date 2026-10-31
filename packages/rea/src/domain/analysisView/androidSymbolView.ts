import { AnalysisResourceConstraintError } from "../analysisErrorCore.js";
import { androidResultSchemas } from "../android/androidAnalysis.js";
import type { JsonValue } from "../jsonValue.js";
import { jsonValueByteLength } from "../jsonValueByteLength.js";
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
import { createAnalysisViewResultReader } from "./analysisViewParent.js";

/** Exact requested facts; only the parent Evidence's raw protocol calls are omitted. */
export const androidClassSummarySchema =
  androidResultSchemas.inspect_android_class;
export const androidMethodSummarySchema =
  androidResultSchemas.inspect_android_method;
const readClass = createAnalysisViewResultReader(androidClassSummarySchema);
const readMethod = createAnalysisViewResultReader(androidMethodSummarySchema);
const PAGE_BYTES = 1024 * 1024;
const DIGEST_BYTES = jsonValueByteLength({ view_digest: "0".repeat(64) }) - 1;
const PROJECTION_BYTES = PAGE_BYTES - DIGEST_BYTES;

const boundedSummary = <View extends { readonly parent_evidence_id: string }>(
  result: View,
) =>
  jsonValueByteLength(result as unknown as JsonValue, PROJECTION_BYTES) >
  PROJECTION_BYTES
    ? err(
        new AnalysisResourceConstraintError(
          "inspect_analysis_view",
          "transport",
          "The complete Android symbol summary exceeds the analysis-view byte budget. Read complete parent Evidence, or select one method when inspecting a class.",
          {
            parent_evidence_id: result.parent_evidence_id,
            limit_bytes: PAGE_BYTES,
          },
          {
            retryable: false,
            remediationAction:
              "Select complete detail, or inspect a single method rather than the entire class.",
          },
        ),
      )
    : ok(result);

/** Reuse authenticated Android facts without reopening the APK, mapping or engine. */
export const projectAndroidSymbolSummary = (
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
          message: "Android class and method Evidence supports summary views.",
        },
      ]),
    );
  if (
    parent.operation !== "inspect_android_class" &&
    parent.operation !== "inspect_android_method"
  )
    return err(
      analysisViewInputError([
        {
          path: ["source", "operation"],
          reason: "invalid_value",
          message:
            "Android symbol summaries require class or method inspection Evidence.",
        },
      ]),
    );
  // The engine artifact digest is the JAR; it cannot identify the APK.
  if (parent.subject == null)
    return err(
      analysisViewInputError([
        {
          path: ["source", "subject"],
          reason: "invalid_value",
          message:
            "Android symbol summaries require the recorded APK subject identity.",
        },
      ]),
    );
  const shared = {
    kind: "summary" as const,
    view,
    parent_evidence_id: parent.evidenceId,
    parent_digest: parent.evidenceId.slice(3),
    artifact: {
      path: parent.subject.local_path,
      sha256: parent.subject.digest.sha256,
    },
    coverage: completeWithinViewCoverage(1, 1),
    limitations: boundedViewMessages(
      parent.limitations,
      parent.evidenceId,
      "limitations",
    ),
    unknowns: [
      "Static class and method analysis does not establish runtime behavior or APK authenticity.",
    ],
  };
  if (parent.operation === "inspect_android_class") {
    const parsed = readClass(parent);
    if (!parsed.ok) return parsed;
    return boundedSummary({
      ...shared,
      parent_operation: "inspect_android_class" as const,
      summary: parsed.value,
    });
  }
  const parsed = readMethod(parent);
  if (!parsed.ok) return parsed;
  return boundedSummary({
    ...shared,
    parent_operation: "inspect_android_method" as const,
    summary: parsed.value,
    unknowns: [
      ...shared.unknowns,
      ...(parsed.value.source.status === "partial"
        ? [
            "The selected method source is partial; retained text does not establish a complete method body.",
          ]
        : []),
    ],
  });
};
