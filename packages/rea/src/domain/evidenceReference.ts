import { z } from "zod";
import { prefixedDigestSchema } from "./digests.js";
import { absoluteLocalPathStringSchema } from "./localPath.js";
import {
  declareBorrowedEvidenceInput,
  declareEvidenceInput,
} from "./evidenceInputContract.js";

/** Exact reference to Evidence already retained by the current session. */
export const retainedEvidenceReferenceSchema = z.strictObject({
  kind: z.literal("retained-evidence"),
  evidence_id: prefixedDigestSchema("ev"),
});

/** One completed Evidence record read from a local Evidence file or bundle. */
export const evidenceFileReferenceSchema = z.strictObject({
  kind: z.literal("evidence-file"),
  path: absoluteLocalPathStringSchema.describe(
    "Absolute local path of one completed Evidence JSON file, or of an Evidence bundle written by --evidence_output or export_evidence_bundle. REA reads and authenticates it, then uses it like retained Evidence, so large records are not charged as inline input.",
  ),
  evidence_id: prefixedDigestSchema("ev")
    .exactOptional()
    .describe(
      "The record to select when the file is an Evidence bundle, such as a summary's normalized_result.parent_evidence_id. A bundle holding exactly one record needs no selection.",
    ),
});

import { evidenceSchema } from "./evidence.js";

/** Portable observation or exact retained identity; semantic authentication follows admission. */
export const evidenceInputSchema = declareEvidenceInput(
  z.union([evidenceSchema, retainedEvidenceReferenceSchema]),
);
export type EvidenceInput = z.output<typeof evidenceInputSchema>;

/** Borrow a selected inline record until its resource and format owner admits it. */
export const borrowEvidenceInput = () => {
  const input = z.unknown().nonoptional();
  input._zod.processJSONSchema = evidenceInputSchema._zod.processJSONSchema;
  return declareBorrowedEvidenceInput(input, evidenceInputSchema);
};

/** Borrow array width too; its service must admit capacity before resolution. */
export const borrowEvidenceArray = () => {
  const declaration = z.array(evidenceInputSchema);
  const input = z.custom<unknown[]>(Array.isArray);
  input._zod.processJSONSchema = declaration._zod.processJSONSchema;
  return declareBorrowedEvidenceInput(input, declaration);
};

/** Evidence input, or one record read from a local Evidence file or bundle. */
export const evidenceSourceInputSchema = z.union([
  ...evidenceInputSchema.options,
  evidenceFileReferenceSchema,
]);
export type EvidenceSourceInput = z.output<typeof evidenceSourceInputSchema>;
