import {
  NATIVE_OBSERVATION_OPERATIONS,
  containingProcedureResolutionSchema,
} from "../native/nativeObservation.js";
import { z } from "zod";
import { digestSchema } from "../digests.js";
import { evidenceSchema } from "../evidence.js";
import {
  completeRelationshipCoverageSchema,
  partialRelationshipCoverageSchema,
  unknownRelationshipCoverageSchema,
} from "../relationshipCoverage.js";
import { analysisErrorProjectionSchema } from "../../contracts/errorSchemas.js";

export const nativeObservationOperationSchema = z.enum(
  NATIVE_OBSERVATION_OPERATIONS,
);
const paging = {
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
};
export const nativeObservationViewRequestSchema = z.strictObject({
  kind: z.literal("native-observation"),
  ...paging,
});
export const nativeContextViewRequestSchema = z.strictObject({
  kind: z.literal("native-context"),
  facet: z
    .enum(["overview", "analysis-profile", "limitations", "result-limitations"])
    .default("overview"),
  ...paging,
});
export const nativeSourceContextSchema = z.strictObject({
  subject: evidenceSchema.shape.subject,
  provider: evidenceSchema.shape.provider,
  analysis_profile: evidenceSchema.shape.analysis_profile,
  authority: evidenceSchema.shape.authority,
  environment: evidenceSchema.shape.environment,
  limitations: evidenceSchema.shape.limitations,
  result_limitations: z.array(z.string()).nullable(),
});
export type NativeSourceContext = z.infer<typeof nativeSourceContextSchema>;
export const nativeSourceContextReferenceSchema = z.strictObject({
  materialization: z.literal("reference"),
  digest: digestSchema,
  evidence_limitation_count: z.int().nonnegative(),
  result_limitation_count: z.int().nonnegative().nullable(),
});

const sourceIndex = z.int().nonnegative();
const ids = z.array(sourceIndex);
const diagnostics = ids.min(1).exactOptional();
export const referencedRelationshipCoverageSchema = z.discriminatedUnion(
  "status",
  [
    completeRelationshipCoverageSchema
      .omit({ diagnostics: true })
      .extend({ diagnostic_ids: diagnostics }),
    partialRelationshipCoverageSchema
      .omit({ diagnostics: true, limitations: true })
      .extend({ limitation_ids: ids.min(1), diagnostic_ids: diagnostics }),
    unknownRelationshipCoverageSchema
      .omit({ diagnostics: true, reason: true })
      .extend({ reason_id: sourceIndex, diagnostic_ids: diagnostics }),
  ],
);
const graphRowBase = {
  level: z.string(),
  source_index: sourceIndex,
  address: z.string(),
};
const graphRowsSchema = z.array(
  z.discriminatedUnion("status", [
    z.strictObject({
      level: z.string(),
      source_index: z.null(),
      status: z.literal("empty-level"),
    }),
    z.strictObject({
      ...graphRowBase,
      status: z.literal("ok"),
      calls: z.array(z.string()),
      relationship_coverage: referencedRelationshipCoverageSchema,
      limitation_ids: ids.exactOptional(),
    }),
    z.strictObject({
      ...graphRowBase,
      status: z.literal("error"),
      error: analysisErrorProjectionSchema,
    }),
  ]),
);
export const nativeGraphViewItemsSchema = z
  .strictObject({
    type: z.literal("graph-nodes"),
    messages: z.array(z.string()),
    rows: graphRowsSchema,
  })
  .superRefine((items, context) => {
    const valid = (value: number, path: PropertyKey[]) => {
      if (value >= items.messages.length)
        context.addIssue({
          code: "custom",
          path,
          message: "Message reference is outside this page's dictionary",
        });
    };
    items.rows.forEach((row, index) => {
      if (row.status !== "ok") return;
      row.limitation_ids?.forEach((value, i) =>
        valid(value, ["rows", index, "limitation_ids", i]),
      );
      const coverage = row.relationship_coverage;
      coverage.diagnostic_ids?.forEach((value, i) =>
        valid(value, [
          "rows",
          index,
          "relationship_coverage",
          "diagnostic_ids",
          i,
        ]),
      );
      if (coverage.status === "partial")
        coverage.limitation_ids.forEach((value, i) =>
          valid(value, [
            "rows",
            index,
            "relationship_coverage",
            "limitation_ids",
            i,
          ]),
        );
      if (coverage.status === "unknown")
        valid(coverage.reason_id, [
          "rows",
          index,
          "relationship_coverage",
          "reason_id",
        ]);
    });
  });
const addresses = z.strictObject({
  type: z.literal("addresses"),
  rows: z.array(
    z.strictObject({ source_index: sourceIndex, address: z.string() }),
  ),
});
const resolutions = z.strictObject({
  type: z.literal("resolutions"),
  rows: z.array(
    z.strictObject({
      source_index: sourceIndex,
      record: containingProcedureResolutionSchema,
    }),
  ),
});
export const nativeObservationItemsSchemas = {
  procedure_address: addresses,
  procedure_callees: addresses,
  procedure_callers: addresses,
  resolve_containing_procedure: resolutions,
  get_call_graph: nativeGraphViewItemsSchema,
};
export const nativeContextItemsSchemas = {
  overview: z.strictObject({
    type: z.literal("overview"),
    rows: z.array(
      z.strictObject({
        source_index: sourceIndex,
        record: nativeSourceContextSchema
          .omit({
            analysis_profile: true,
            limitations: true,
            result_limitations: true,
          })
          .extend({ analysis_profile_digest: digestSchema.nullable() }),
      }),
    ),
  }),
  "analysis-profile": z.strictObject({
    type: z.literal("analysis-profile"),
    rows: z.array(
      z.strictObject({
        source_index: sourceIndex,
        record: evidenceSchema.shape.analysis_profile,
      }),
    ),
  }),
  limitations: z.strictObject({
    type: z.literal("limitations"),
    rows: z.array(
      z.strictObject({ source_index: sourceIndex, text: z.string() }),
    ),
  }),
  "result-limitations": z.strictObject({
    type: z.literal("result-limitations"),
    rows: z
      .array(z.strictObject({ source_index: sourceIndex, text: z.string() }))
      .nullable(),
  }),
};
