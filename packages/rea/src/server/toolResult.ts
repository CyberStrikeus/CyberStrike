import { isNativeObservationOperation } from "../domain/native/nativeObservation.js";
import { isNativeInventoryOperation } from "../domain/native/nativeInventory.js";
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import { ToolResultDelivery } from "./ToolResultDelivery.js";
import { INSPECT_ANALYSIS_VIEW_OPERATION } from "../domain/analysisView/analysisViewErrors.js";
import { inspectAnalysisViewInputSchema } from "../domain/analysisView/analysisView.js";
import type { Evidence } from "../domain/evidence.js";
import { jsonValueSchema, type JsonValue } from "../domain/jsonValue.js";

/** Compose native Evidence continuation with the selected, parsed response budget. */
export const createToolResultDelivery = (
  maximumResponseBytes: number | undefined,
): ToolResultDelivery =>
  new ToolResultDelivery(
    maximumResponseBytes ?? STDIO_DEFAULT_MAX_BUFFER_SIZE,
    retainedEvidenceContinuation,
  );

/** Offer a named, schema-validated source page only for retained native analysis. */
const retainedEvidenceContinuation = (
  evidence: Evidence,
): Readonly<Record<string, JsonValue>> => {
  const view =
    evidence.operation === "analyze_function"
      ? { kind: "native", facet: "pseudocode", offset: 0 }
      : isNativeInventoryOperation(evidence.operation)
        ? { kind: "native-inventory", offset: 0, limit: 64 }
        : isNativeObservationOperation(evidence.operation)
          ? { kind: "native-observation", offset: 0, limit: 64 }
          : undefined;
  if (view === undefined) return {};
  const input = inspectAnalysisViewInputSchema.safeParse({
    source: { kind: "retained-evidence", evidence_id: evidence.evidence_id },
    view,
  });
  if (!input.success) return {};
  return {
    continuation: {
      name: INSPECT_ANALYSIS_VIEW_OPERATION,
      arguments: jsonValueSchema.parse(input.data),
    },
  };
};
