import { z } from "zod";

import { digestSchema, prefixedDigestSchema } from "./digests.js";
import { evidenceSchema, type Evidence } from "./evidence.js";
import type { EvidenceBundle } from "./evidenceBundle.js";
import { nativeValueFlowMetadataSchema } from "./native/nativeValueFlow.js";

/** Exact retained-record selectors; selection never resolves a provider address. */
export const evidenceRecordFiltersSchema = z.strictObject({
  evidence_id: prefixedDigestSchema("ev").optional(),
  operation: z.string().min(1).optional(),
  target_sha256: digestSchema.optional(),
  analysis_profile_digest: digestSchema.optional(),
  procedure_address: z.string().min(1).optional(),
});
export type EvidenceRecordFilters = z.infer<typeof evidenceRecordFiltersSchema>;

const countSchema = z.int().nonnegative();
const nativeMetadataSchema = z.object({
  procedure: z.object({ address: z.string(), name: z.string().nullish() }),
  native_value_flow: z.unknown().optional(),
});

const nativeSummarySchema = z.discriminatedUnion("available", [
  z.strictObject({
    available: z.literal(true),
    procedure_address: z.string(),
    procedure_name: z.string().nullable(),
    value_flow: z.discriminatedUnion("status", [
      z.strictObject({
        status: z.literal("observed"),
        truncated: z.boolean(),
        omitted_operations_lower_bound: countSchema.nullable(),
        known_omitted_inputs: countSchema.nullable(),
        known_omitted_edges: countSchema.nullable(),
      }),
      z.strictObject({ status: z.literal("unavailable"), reason: z.string() }),
      z.strictObject({ status: z.literal("not-recorded") }),
      z.strictObject({ status: z.literal("unknown"), reason: z.string() }),
    ]),
  }),
  z.strictObject({
    available: z.literal(false),
    reason: z.enum(["different-operation", "not-recorded-or-incompatible"]),
  }),
]);

/** Metadata for complete retained records, independent of analysis completeness. */
export const evidenceBundleSummarySchema = z.strictObject({
  kind: z.literal("evidence-bundle-summary"),
  filters: z.record(z.string(), z.string()),
  total_retained_records: countSchema,
  matching_records: countSchema,
  unknown_revisions: countSchema,
  records: z.array(
    z.strictObject({
      evidence_id: evidenceSchema.shape.evidence_id,
      subject: evidenceSchema.shape.subject,
      provider: evidenceSchema.shape.provider,
      operation: evidenceSchema.shape.operation,
      confidence: evidenceSchema.shape.confidence,
      authority: evidenceSchema.shape.authority,
      analysis_profile_digest: digestSchema.nullable(),
      retention: z.literal("complete-record"),
      limitation_count: countSchema,
      native_dossier: nativeSummarySchema,
    }),
  ),
});
export type EvidenceBundleSummary = z.infer<typeof evidenceBundleSummarySchema>;

const nativeSummary = (
  evidence: Evidence,
): z.infer<typeof nativeSummarySchema> => {
  if (evidence.operation !== "analyze_function")
    return { available: false, reason: "different-operation" };
  // Read only producer metadata. Parsing the full dossier would allocate every
  // large collection merely to discover its already authenticated parent ID.
  const parsed = nativeMetadataSchema.safeParse(evidence.normalized_result);
  if (!parsed.success)
    return { available: false, reason: "not-recorded-or-incompatible" };
  const flow = nativeValueFlowMetadataSchema.safeParse(
    parsed.data.native_value_flow,
  );
  return {
    available: true,
    procedure_address: parsed.data.procedure.address,
    procedure_name: parsed.data.procedure.name ?? null,
    value_flow:
      parsed.data.native_value_flow == null
        ? { status: "not-recorded" }
        : !flow.success
          ? {
              status: "unknown",
              reason: "Value-flow metadata has an incompatible representation.",
            }
          : flow.data.available
            ? {
                status: "observed",
                truncated: flow.data.truncated,
                omitted_operations_lower_bound:
                  flow.data.omitted_operations_lower_bound ?? null,
                known_omitted_inputs: flow.data.known_omitted_inputs ?? null,
                known_omitted_edges: flow.data.known_omitted_edges ?? null,
              }
            : { status: "unavailable", reason: flow.data.reason },
  };
};

/** Discover retained Evidence without reading or copying its complete payloads. */
export const summarizeEvidenceBundle = (
  bundle: EvidenceBundle,
  filters: EvidenceRecordFilters = {},
): EvidenceBundleSummary => {
  const selectedFilters: Record<string, string> = {};
  for (const [field, value] of Object.entries(filters))
    if (value !== undefined) selectedFilters[field] = value;
  const records: EvidenceBundleSummary["records"] = [];
  for (const evidence of bundle.records) {
    if (
      (filters.evidence_id !== undefined &&
        filters.evidence_id !== evidence.evidence_id) ||
      (filters.operation !== undefined &&
        filters.operation !== evidence.operation) ||
      (filters.target_sha256 !== undefined &&
        filters.target_sha256 !== evidence.subject?.digest.sha256) ||
      (filters.analysis_profile_digest !== undefined &&
        filters.analysis_profile_digest !== evidence.analysis_profile?.digest)
    )
      continue;
    const native = nativeSummary(evidence);
    if (
      filters.procedure_address !== undefined &&
      (!native.available ||
        filters.procedure_address !== native.procedure_address)
    )
      continue;
    records.push({
      evidence_id: evidence.evidence_id,
      subject: evidence.subject,
      provider: evidence.provider,
      operation: evidence.operation,
      confidence: evidence.confidence,
      authority: evidence.authority,
      analysis_profile_digest: evidence.analysis_profile?.digest ?? null,
      retention: "complete-record",
      limitation_count: evidence.limitations.length,
      native_dossier: native,
    });
  }
  return {
    kind: "evidence-bundle-summary",
    filters: selectedFilters,
    total_retained_records: bundle.records.length,
    matching_records: records.length,
    unknown_revisions: bundle.unknowns.length,
    records,
  };
};
