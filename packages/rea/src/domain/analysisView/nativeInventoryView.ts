import { z } from "zod";
import { analysisStringSchema } from "../native/nativeString.js";
import { jsonValueSchema } from "../jsonValue.js";
import {
  addressedValueSchema,
  isNativeInventoryOperation,
  nativeInventoryRowsSchemas,
} from "../native/nativeInventory.js";
import { err, ok } from "../result.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  assertOwnedView,
  type AdmittedView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import { analysisViewInputError } from "./analysisViewErrors.js";
import { createAnalysisViewResultReader } from "./analysisViewParent.js";
import {
  boundedViewMessages,
  completeWithinViewCoverage,
  pageViewCoverage,
} from "./analysisViewCoverage.js";

/** Preserve all canonical native row metadata, including string decoding facts. */
const inventoryRecordSchema = addressedValueSchema.extend({
  provider_value: analysisStringSchema.shape.provider_value,
  decoding: analysisStringSchema.shape.decoding,
  string: z.union([
    analysisStringSchema.shape.string,
    addressedValueSchema.shape.string,
  ]),
});
type InventoryRecord = z.infer<typeof inventoryRecordSchema>;
const fieldSchema = inventoryRecordSchema.keyof();

export const nativeInventoryViewRequestSchema = z.strictObject({
  kind: z.literal("native-inventory"),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().default(64),
  fields: z
    .array(fieldSchema)
    .exactOptional()
    .describe(
      "Select record fields; address and source_index preserve identity. Selecting value also retains its string and decoding qualifications. Omit for every recorded field. Search tools filter before retention.",
    ),
});

/** Parent Evidence ID plus source_index identifies even same-address alternatives. */
export const nativeInventoryViewRowSchema = z.strictObject({
  source_index: z.number().int().nonnegative(),
  record: inventoryRecordSchema.partial().required({ address: true }),
});

export const nativeInventorySummarySchema = z.strictObject({
  collection: z.enum(["procedures", "strings", "names"]),
  row_count: z.number().int().nonnegative(),
  discovery_coverage: z.literal("unknown"),
  selectable_fields: z.array(fieldSchema),
});

const readNames = createAnalysisViewResultReader(
  nativeInventoryRowsSchemas.names,
);
const readStrings = createAnalysisViewResultReader(
  nativeInventoryRowsSchemas.strings,
);

/** Project already completed provider observations without another provider read or sort. */
export const projectNativeInventoryView = (
  parent: AnalysisViewParent,
  view: AdmittedView,
) => {
  if (
    !isNativeInventoryOperation(parent.operation) ||
    (view.kind !== "summary" && view.kind !== "native-inventory")
  )
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message:
            "Native inventory Evidence supports summary and native-inventory views.",
        },
      ]),
    );
  assertOwnedView<
    SummaryAnalysisView | z.output<typeof nativeInventoryViewRequestSchema>
  >(view, "summary", "native-inventory");
  const strings =
    parent.operation === "list_strings" ||
    parent.operation === "search_strings";
  const parsed = strings ? readStrings(parent) : readNames(parent);
  if (!parsed.ok) return parsed;
  const rows: readonly InventoryRecord[] = parsed.value;
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: parent.operation,
    parent_digest: parent.evidenceId.slice(3),
    artifact: parent.artifact ?? null,
    source_provider: parent.provider ?? null,
    source_analysis_profile_digest: parent.analysisProfile?.digest ?? null,
    source_parameters: jsonValueSchema.parse(parent.parameters ?? null),
    limitations: boundedViewMessages(
      parent.limitations,
      parent.evidenceId,
      "limitations",
    ),
    unknowns: [
      "Counts and paging describe the retained provider-reported rows, not complete discovery of every program object. Missing matches do not establish absence outside that observation.",
      ...(parent.artifact == null
        ? ["No artifact identity was bound to the source Evidence."]
        : []),
    ],
  };
  if (view.kind === "summary")
    return ok({
      ...shared,
      kind: "summary" as const,
      view,
      summary: {
        collection: strings
          ? ("strings" as const)
          : parent.operation === "list_names"
            ? ("names" as const)
            : ("procedures" as const),
        row_count: rows.length,
        discovery_coverage: "unknown" as const,
        selectable_fields: fieldSchema.options,
      },
      coverage: completeWithinViewCoverage(rows.length, rows.length),
    });
  // Normalize the selection once: repeated caller fields must not multiply
  // work or temporary entries for every retained row. Keep the original view.
  const fields =
    view.fields === undefined
      ? undefined
      : [...new Set(view.fields)].filter((field) => field !== "address");
  const selectingValue = fields?.includes("value") === true;
  const selected = rows.slice(view.offset, view.offset + view.limit);
  return ok({
    ...shared,
    kind: "native-inventory" as const,
    view,
    rows: selected.map((record, index) => ({
      source_index: view.offset + index,
      record:
        fields === undefined
          ? record
          : {
              address: record.address,
              ...(selectingValue && record.string !== undefined
                ? { string: record.string }
                : {}),
              ...(selectingValue && record.decoding !== undefined
                ? { decoding: record.decoding }
                : {}),
              ...Object.fromEntries(
                fields
                  .filter((field) => Object.hasOwn(record, field))
                  .map((field) => [field, record[field]]),
              ),
            },
    })),
    coverage: pageViewCoverage(view.offset, selected.length, rows.length),
  });
};
