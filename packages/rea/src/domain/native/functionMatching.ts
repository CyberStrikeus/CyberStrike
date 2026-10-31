import { digestCanonicalValue } from "../canonicalDigest.js";
import { z } from "zod";
import { digestSchema, prefixedDigestSchema } from "../digests.js";
import { retainedEvidenceReferenceSchema } from "../evidenceReference.js";

const evidenceId = prefixedDigestSchema("ev");
export const nativeMatchStateSchema = z.enum([
  "matched",
  "only_left",
  "only_right",
  "unresolved",
]);
export const nativeFunctionMatchMemberSchema = z.strictObject({
  function_id: z.string().min(1),
  inventory_evidence_id: evidenceId,
  source_index: z.number().int().nonnegative(),
  address: z.string(),
  name: z.string(),
  body_sha256: digestSchema.nullable(),
  structural_candidate_sha256: digestSchema.nullable(),
  body_bytes: z.number().int().nonnegative().nullable(),
  dossier_evidence_id: evidenceId.nullable(),
  evidence_links: z.array(evidenceId).min(1),
  limitations: z.array(z.string()),
});
export const nativeFunctionMatchSchema = z.strictObject({
  match_id: prefixedDigestSchema("match"),
  state: nativeMatchStateSchema,
  basis: z.enum(["exact-symbol", "identical-bytes"]).nullable(),
  left: z.array(nativeFunctionMatchMemberSchema),
  right: z.array(nativeFunctionMatchMemberSchema),
  reason: z.string(),
  compare_functions_input: z
    .strictObject({
      left: retainedEvidenceReferenceSchema,
      right: retainedEvidenceReferenceSchema,
    })
    .nullable(),
});
export const nativeFunctionMatchingSummarySchema = z.strictObject({
  matched: z.number().int().nonnegative(),
  only_left: z.number().int().nonnegative(),
  only_right: z.number().int().nonnegative(),
  unresolved: z.number().int().nonnegative(),
});
export const nativeFunctionMatchingContextSchema = z.strictObject({
  left: z.strictObject({
    evidence_id: evidenceId,
    sha256: digestSchema,
    functions: z.number().int().nonnegative(),
  }),
  right: z.strictObject({
    evidence_id: evidenceId,
    sha256: digestSchema,
    functions: z.number().int().nonnegative(),
  }),
  scope: z.literal("provider-observed-inputs"),
  source_coverage: z.strictObject({
    status: z.enum(["complete-within-inputs", "partial"]),
    left_inventory_completeness: z.literal("unknown"),
    right_inventory_completeness: z.literal("unknown"),
    left_byte_fingerprints: z.number().int().nonnegative(),
    right_byte_fingerprints: z.number().int().nonnegative(),
    left_structural_candidates: z.number().int().nonnegative(),
    right_structural_candidates: z.number().int().nonnegative(),
  }),
  summary: nativeFunctionMatchingSummarySchema,
});
export const nativeFunctionMatchingSchema = nativeFunctionMatchingContextSchema
  .extend({
    matches: z.array(nativeFunctionMatchSchema),
    limitations: z.array(z.string()),
  })
  .superRefine((report, context) => {
    const seen = new Set<string>();
    const members = { left: new Set<string>(), right: new Set<string>() };
    const fingerprints = { left: 0, right: 0 };
    const candidates = { left: 0, right: 0 };
    const counts = { matched: 0, only_left: 0, only_right: 0, unresolved: 0 };
    let left = 0,
      right = 0;
    for (const match of report.matches) {
      counts[match.state]++;
      left += match.left.length;
      right += match.right.length;
      if (seen.has(match.match_id))
        context.addIssue({
          code: "custom",
          message: "Repeated match identity",
        });
      seen.add(match.match_id);
      if (
        match.match_id !==
        `match_${digestCanonicalValue({ state: match.state, basis: match.basis, left: match.left.map((x) => x.function_id), right: match.right.map((x) => x.function_id) })}`
      )
        context.addIssue({
          code: "custom",
          message:
            "Match identity does not bind its selected occurrences and basis",
        });
      for (const side of ["left", "right"] as const)
        for (const member of match[side]) {
          if (
            member.inventory_evidence_id !== report[side].evidence_id ||
            member.source_index >= report[side].functions ||
            member.function_id !==
              `${report[side].evidence_id}/${member.source_index}` ||
            members[side].has(member.function_id) ||
            !member.evidence_links.includes(member.inventory_evidence_id) ||
            (member.dossier_evidence_id !== null &&
              !member.evidence_links.includes(member.dossier_evidence_id))
          )
            context.addIssue({
              code: "custom",
              message:
                "Function occurrence identity, provenance or uniqueness disagrees with its selected inventory",
            });
          members[side].add(member.function_id);
          if (member.body_sha256 !== null) fingerprints[side]++;
          if (member.structural_candidate_sha256 !== null) candidates[side]++;
        }
      if (
        match.left.length + match.right.length === 0 ||
        (match.state !== "matched" &&
          (match.basis !== null || match.compare_functions_input !== null))
      )
        context.addIssue({
          code: "custom",
          message:
            "Unresolved/unpaired group cannot contain a definitive basis or comparison input",
        });
      if (
        match.basis === "identical-bytes" &&
        (match.left[0]?.body_sha256 == null ||
          match.left[0]?.body_sha256 !== match.right[0]?.body_sha256 ||
          match.left[0]?.body_bytes !== match.right[0]?.body_bytes)
      )
        context.addIssue({
          code: "custom",
          message:
            "Identical-byte match disagrees with its complete body digests and sizes",
        });
      if (
        match.compare_functions_input !== null &&
        (match.compare_functions_input.left.evidence_id !==
          match.left[0]?.dossier_evidence_id ||
          match.compare_functions_input.right.evidence_id !==
            match.right[0]?.dossier_evidence_id)
      )
        context.addIssue({
          code: "custom",
          message: "Comparison input does not identify this pair's dossiers",
        });

      if (
        (match.state === "matched" &&
          (match.left.length !== 1 ||
            match.right.length !== 1 ||
            match.basis === null)) ||
        (match.state === "only_left" &&
          (match.left.length !== 1 || match.right.length !== 0)) ||
        (match.state === "only_right" &&
          (match.right.length !== 1 || match.left.length !== 0))
      )
        context.addIssue({
          code: "custom",
          message: "Match state contradicts its occurrences",
        });
    }
    if (
      report.source_coverage.status !==
        (counts.only_left + counts.only_right + counts.unresolved > 0
          ? "partial"
          : "complete-within-inputs") ||
      report.source_coverage.left_byte_fingerprints !== fingerprints.left ||
      report.source_coverage.right_byte_fingerprints !== fingerprints.right ||
      report.source_coverage.left_structural_candidates !== candidates.left ||
      report.source_coverage.right_structural_candidates !== candidates.right
    )
      context.addIssue({
        code: "custom",
        message: "Source/matching coverage contradicts examined facts",
      });
    if (
      left !== report.left.functions ||
      right !== report.right.functions ||
      Object.keys(counts).some(
        (key) =>
          counts[key as keyof typeof counts] !==
          report.summary[key as keyof typeof counts],
      )
    )
      context.addIssue({
        code: "custom",
        message: "Matching summary or examined inventory coverage disagrees",
      });
  });
export type NativeFunctionMatch = z.infer<typeof nativeFunctionMatchSchema>;
export type NativeFunctionMatchMember = z.infer<
  typeof nativeFunctionMatchMemberSchema
>;
export type NativeFunctionMatching = z.infer<
  typeof nativeFunctionMatchingSchema
>;
