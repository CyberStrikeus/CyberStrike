import { z } from "zod";

import { digestCanonicalValue } from "./canonicalDigest.js";
import { IDENTIFIER_PATTERN } from "./stringPatterns.js";
import { prefixedDigestSchema } from "./../domain/digests.js";
import {
  compareAsciiStrings,
  isSortedUniqueAscii,
} from "./canonicalOrdering.js";

const evidenceIdSchema = prefixedDigestSchema("ev");
const claimIdSchema = z.string().regex(IDENTIFIER_PATTERN);

/** Terminal outcome recorded for one verifier claim. */
export const evidenceCompletionStatusSchema = z.enum([
  "pass",
  "fail",
  "unsupported",
  "truncated",
  "unknown",
]);

/** Strict evidence-linked result for one verifier claim. */
export const evidenceCompletionRecordSchema = z.strictObject({
  claim_id: claimIdSchema,
  status: evidenceCompletionStatusSchema,
  evidence_ids: z.array(evidenceIdSchema).min(1),
});

const completionSummarySchema = z.strictObject({
  total: z.int().min(1),
  pass: z.int().nonnegative(),
  fail: z.int().nonnegative(),
  unsupported: z.int().nonnegative(),
  truncated: z.int().nonnegative(),
  unknown: z.int().nonnegative(),
  complete: z.boolean(),
});

const completionLedgerObjectSchema = z.strictObject({
  ledger_id: prefixedDigestSchema("ecl"),
  records: z.array(evidenceCompletionRecordSchema).min(1),
  summary: completionSummarySchema,
});

export type EvidenceCompletionStatus = z.infer<
  typeof evidenceCompletionStatusSchema
>;
/** Readonly verifier result accepted by the canonical ledger builder. */
export interface EvidenceCompletionRecordInput {
  readonly claim_id: string;
  readonly status: EvidenceCompletionStatus;
  readonly evidence_ids: readonly string[];
}
export type EvidenceCompletionRecord = z.infer<
  typeof evidenceCompletionRecordSchema
>;
type EvidenceCompletionLedgerValue = z.infer<
  typeof completionLedgerObjectSchema
>;

const summarize = (
  records: readonly EvidenceCompletionRecord[],
): EvidenceCompletionLedger["summary"] => {
  const counts: Record<EvidenceCompletionStatus, number> = {
    pass: 0,
    fail: 0,
    unsupported: 0,
    truncated: 0,
    unknown: 0,
  };
  for (const record of records) counts[record.status] += 1;
  return {
    total: records.length,
    ...counts,
    complete: counts.pass === records.length,
  };
};

const computeLedgerId = (
  records: readonly EvidenceCompletionRecord[],
): string => `ecl_${digestCanonicalValue({ records }, "Completion ledger")}`;

const ledgerIssues = (
  ledger: EvidenceCompletionLedgerValue,
  context: z.RefinementCtx,
): void => {
  if (!isSortedUniqueAscii(ledger.records.map((record) => record.claim_id)))
    context.addIssue({
      code: "custom",
      path: ["records"],
      message: "Completion records must be sorted by unique claim ID",
    });
  for (const [index, record] of ledger.records.entries())
    if (!isSortedUniqueAscii(record.evidence_ids))
      context.addIssue({
        code: "custom",
        path: ["records", index, "evidence_ids"],
        message: "Evidence IDs must be sorted and unique",
      });
  if (
    JSON.stringify(summarize(ledger.records)) !== JSON.stringify(ledger.summary)
  )
    context.addIssue({
      code: "custom",
      path: ["summary"],
      message: "Completion summary does not match its records",
    });
  if (computeLedgerId(ledger.records) !== ledger.ledger_id)
    context.addIssue({
      code: "custom",
      path: ["ledger_id"],
      message: "Completion ledger identifier does not match its records",
    });
};

/** Strict path-free Evidence completion ledger. */
export const evidenceCompletionLedgerSchema =
  completionLedgerObjectSchema.superRefine(ledgerIssues);

export type EvidenceCompletionLedger = z.infer<
  typeof evidenceCompletionLedgerSchema
>;

/** Build a canonical path-independent ledger from verifier claim outcomes. */
export const createEvidenceCompletionLedger = (
  input: readonly EvidenceCompletionRecordInput[],
): EvidenceCompletionLedger => {
  const records = input
    .map((record) => evidenceCompletionRecordSchema.parse(record))
    .map((record) => ({
      ...record,
      evidence_ids: [...record.evidence_ids].sort(compareAsciiStrings),
    }))
    .sort((left, right) => compareAsciiStrings(left.claim_id, right.claim_id));
  if (!isSortedUniqueAscii(records.map((record) => record.claim_id)))
    throw new TypeError("Completion claim IDs must be unique");
  for (const record of records)
    if (!isSortedUniqueAscii(record.evidence_ids))
      throw new TypeError("Completion Evidence IDs must be unique per claim");
  return evidenceCompletionLedgerSchema.parse({
    ledger_id: computeLedgerId(records),
    records,
    summary: summarize(records),
  });
};
