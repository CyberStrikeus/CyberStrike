import { z } from "zod";

import { IDENTIFIER_PATTERN } from "./stringPatterns.js";
import { digestSchema, prefixedDigestSchema } from "./../domain/digests.js";
import { PROCESS_COMPARISON_DIMENSIONS } from "./process/processComparison.js";
import { functionComparisonDimensionNameSchema } from "./functionComparisonSchemas.js";

const evidenceIdSchema = prefixedDigestSchema("ev");
const unknownIdSchema = prefixedDigestSchema("unk");
const claimIdSchema = z.string().regex(IDENTIFIER_PATTERN);
const titleSchema = z.string().trim().min(1);
const verificationStatusSchema = z.enum(["pass", "fail", "unknown"]);
const commonClaim = {
  claim_id: claimIdSchema,
  title: titleSchema,
  comparison_evidence_id: evidenceIdSchema,
};

const behavioralClaimSchema = z.object({
  ...commonClaim,
  kind: z.literal("behavioral"),
  dimension: z.enum(["overall", ...PROCESS_COMPARISON_DIMENSIONS]),
});
const functionClaimSchema = z.object({
  ...commonClaim,
  kind: z.literal("structural-function"),
  dimension: z.enum([
    "overall",
    ...functionComparisonDimensionNameSchema.options,
  ]),
});
const artifactClaimSchema = z.object({
  ...commonClaim,
  kind: z.literal("structural-artifact"),
  dimension: z.literal("overall"),
});

const reconstructionClaimSchema = z.discriminatedUnion("kind", [
  behavioralClaimSchema,
  functionClaimSchema,
  artifactClaimSchema,
]);

/** Finite, typed behavioral and structural specification. */
export const reconstructionSpecificationSchema = z
  .object({
    name: z.string().trim().min(1),
    claims: z.array(reconstructionClaimSchema).min(1),
  })
  .superRefine((value, context) => {
    const ids = value.claims.map(({ claim_id: id }) => id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: "custom", message: "Claim IDs must be unique" });
    const selectors = value.claims.map(
      ({ kind, comparison_evidence_id: id, dimension }) =>
        `${kind}:${id}:${dimension}`,
    );
    if (new Set(selectors).size !== selectors.length)
      context.addIssue({
        code: "custom",
        message: "Claim comparison selectors must be unique",
      });
  });

/** Reconstruction-verification input. */
export const reconstructionVerificationInputSchema = z.strictObject({
  specification: reconstructionSpecificationSchema,
});

export const reconstructionClaimResultSchema = z.object({
  claim_id: claimIdSchema,
  kind: z.enum(["behavioral", "structural-function", "structural-artifact"]),
  dimension: z.string().min(1),
  status: verificationStatusSchema,
  observed_status: z.enum([
    "unchanged",
    "added",
    "removed",
    "changed",
    "truncated",
    "unknown",
    "contradiction",
  ]),
  comparison_evidence_id: evidenceIdSchema,
  left_evidence_ids: z.array(evidenceIdSchema).min(1),
  right_evidence_ids: z.array(evidenceIdSchema).min(1),
  evidence_links: z.array(evidenceIdSchema).min(2),
  unknown_ids: z.array(unknownIdSchema),
  limitations: z.array(z.string()),
});

/** Evidence-cited result over every declared claim. */
export const reconstructionVerificationResultSchema = z
  .object({
    status: verificationStatusSchema,
    specification_sha256: digestSchema,
    summary: z.object({
      total: z.int().min(1),
      passed: z.int().min(0),
      failed: z.int().min(0),
      unknown: z.int().min(0),
      behavioral: z.int().min(0),
      structural: z.int().min(0),
    }),
    claims: z.object({
      items: z.array(reconstructionClaimResultSchema),
    }),
    recommended_probes: z.array(
      z.object({
        operation: z.string().min(1),
        rationale: z.string().min(1),
        claim_ids: z.array(claimIdSchema).min(1),
        unknown_ids: z.array(unknownIdSchema),
      }),
    ),
    evidence_links: z.array(evidenceIdSchema).min(2),
    limitations: z.array(z.string()),
  })
  .superRefine((result, context) => {
    const { summary } = result;
    const expectedStatus =
      summary.failed > 0 ? "fail" : summary.unknown > 0 ? "unknown" : "pass";
    const issues = [
      [
        summary.total !== summary.passed + summary.failed + summary.unknown,
        "Claim status counts must equal the summary total",
        ["summary", "total"],
      ],
      [
        summary.total !== summary.behavioral + summary.structural,
        "Claim kind counts must equal the summary total",
        ["summary", "total"],
      ],
      [
        result.claims.items.length !== summary.total,
        "Retained claims must equal the summary total",
        ["claims", "items"],
      ],
      [
        result.status !== expectedStatus,
        "Verification status must summarize claim statuses",
        ["status"],
      ],
    ] as const;
    for (const [invalid, message, path] of issues)
      if (invalid)
        context.addIssue({ code: "custom", message, path: [...path] });
  });

export type ReconstructionClaim = z.infer<typeof reconstructionClaimSchema>;
export type ReconstructionClaimResult = z.infer<
  typeof reconstructionClaimResultSchema
>;
export type ReconstructionVerificationResult = z.infer<
  typeof reconstructionVerificationResultSchema
>;
export type ReconstructionObservedStatus =
  ReconstructionClaimResult["observed_status"];
