import { z } from "zod";

import { digestCanonicalValue } from "../canonicalDigest.js";
import { emptyArraySchema } from "../emptyArraySchema.js";
import { evidenceSchema } from "../evidence.js";
import { evidenceInputSchema } from "../evidenceReference.js";
import {
  cliMetadataGuidSchema,
  managedMetadataTokenSchema,
  type ManagedMemberInspection,
} from "./managedArtifact.js";
import {
  buildComparisonCoverage,
  hasCompleteMethodRows,
  managedComparisonScope,
  buildComparisonMatching,
  buildComparisonSummary,
  comparisonLimitations,
  sideManifest,
} from "./managedMemberComparisonCoverage.js";
import {
  buildFieldItems,
  buildMethodItems,
} from "./managedMemberComparisonItems.js";
import { keyMembers } from "./managedMemberComparisonMatch.js";
import { hasSignatureResolution } from "./managedMemberSignatureIdentity.js";
import { digestSchema, prefixedDigestSchema } from "../digests.js";

const evidenceIdSchema = prefixedDigestSchema("ev");
const boundedTextSchema = z.string().min(1);

const memberComparisonShape = <Source extends z.ZodType>(source: Source) => ({
  left: source,
  right: source,
});

const distinctMemberSources = (
  input: {
    readonly left: { readonly evidence_id: string };
    readonly right: { readonly evidence_id: string };
  },
  context: z.RefinementCtx,
): void => {
  if (
    typeof input.left?.evidence_id === "string" &&
    input.left.evidence_id === input.right?.evidence_id
  )
    context.addIssue({
      code: "custom",
      path: ["right"],
      message: "Managed member Evidence must be distinct",
    });
};

/** Two complete managed member observations for semantic consumers. */
export const compareManagedMembersInputSchema = z
  .strictObject(memberComparisonShape(evidenceSchema))
  .superRefine(distinctMemberSources);

/** Public member comparison selects records inline or by exact retained identity. */
export const compareManagedMembersRequestSchema = z
  .strictObject(memberComparisonShape(evidenceInputSchema))
  .superRefine(distinctMemberSources);

const concreteMatchBasisSchema = z.enum([
  "exact-il-signature",
  "exact-signature",
  "structural-method-shape",
  "field-signature",
]);
const candidateTokensSchema = z.array(managedMetadataTokenSchema).min(1);
const matchedComparisonSchema = z.strictObject({
  status: z.literal("matched"),
  basis: concreteMatchBasisSchema,
  confidence: z.enum(["exact", "high"]),
  candidate_left_tokens: emptyArraySchema,
  candidate_right_tokens: emptyArraySchema,
});
const unmatchedComparisonSchema = z.strictObject({
  status: z.literal("unmatched"),
  basis: z.literal("none"),
  confidence: z.literal("unknown"),
  candidate_left_tokens: emptyArraySchema,
  candidate_right_tokens: emptyArraySchema,
});
const ambiguousComparisonSchema = z.strictObject({
  status: z.literal("ambiguous"),
  basis: concreteMatchBasisSchema,
  confidence: z.literal("unknown"),
  candidate_left_tokens: candidateTokensSchema,
  candidate_right_tokens: candidateTokensSchema,
});
const memberIdentitySchema = z.strictObject({
  token: managedMetadataTokenSchema,
  declaring_type: z.string().nullable(),
  name: z.string(),
  signature_sha256: digestSchema,
  normalized_il_sha256: digestSchema.nullable(),
});

const comparisonItemSchema = <
  Identity extends z.ZodType,
  Base extends Record<string, z.ZodType>,
>(
  base: Base,
  identity: Identity,
) =>
  z.union([
    z.strictObject({
      ...base,
      status: z.enum(["unchanged", "changed", "unknown"]),
      left: identity,
      right: identity,
      match: matchedComparisonSchema,
    }),
    z.strictObject({
      ...base,
      status: z.enum(["removed", "unknown"]),
      left: identity,
      right: z.null(),
      match: unmatchedComparisonSchema,
    }),
    z.strictObject({
      ...base,
      status: z.enum(["added", "unknown"]),
      left: z.null(),
      right: identity,
      match: unmatchedComparisonSchema,
    }),
    z.strictObject({
      ...base,
      status: z.literal("unknown"),
      left: z.null(),
      right: z.null(),
      match: ambiguousComparisonSchema,
    }),
  ]);

const comparisonItemContextShape = {
  evidence_links: z.array(evidenceIdSchema).length(2),
  limitations: z.array(boundedTextSchema),
};

const methodComparisonItemSchema = comparisonItemSchema(
  {
    ...comparisonItemContextShape,
    item_id: prefixedDigestSchema("mmc_method"),
    dimensions: z.array(
      z.enum([
        "metadata",
        "signature",
        "cil",
        "opcode-shape",
        "call-shape",
        "call-target",
        "field-shape",
        "field-target",
        "exception-shape",
        "exception-target",
        "availability",
        "body-coverage",
      ]),
    ),
  },
  memberIdentitySchema,
);

const fieldComparisonItemSchema = comparisonItemSchema(
  {
    ...comparisonItemContextShape,
    item_id: prefixedDigestSchema("mmc_field"),
  },
  memberIdentitySchema.omit({ normalized_il_sha256: true }),
);

/** Obfuscation-resistant, execution-free managed member comparison. */
export const managedMemberComparisonResultSchema = z.strictObject({
  comparison_id: prefixedDigestSchema("mmc"),
  algorithm: z.strictObject({
    name: z.literal("rea-managed-member-comparison"),
    token_identity: z.literal("build-local"),
    name_matching: z.literal("exact-signature-fallback"),
  }),
  left: z.strictObject({
    evidence_id: evidenceIdSchema,
    artifact_sha256: digestSchema,
    mvid: cliMetadataGuidSchema.nullable(),
    module_name: z.string().nullable(),
    metadata_status: z.enum(["absent", "complete", "partial", "malformed"]),
    methods_total: z.int().min(0),
    fields_total: z.int().min(0),
  }),
  right: z.strictObject({
    evidence_id: evidenceIdSchema,
    artifact_sha256: digestSchema,
    mvid: cliMetadataGuidSchema.nullable(),
    module_name: z.string().nullable(),
    metadata_status: z.enum(["absent", "complete", "partial", "malformed"]),
    methods_total: z.int().min(0),
    fields_total: z.int().min(0),
  }),
  summary: z.strictObject({
    unchanged: z.int().min(0),
    changed: z.int().min(0),
    added: z.int().min(0),
    removed: z.int().min(0),
    unknown: z.int().min(0),
  }),
  matching: z.strictObject({
    exact_il_signature: z.int().min(0),
    exact_signature: z.int().min(0),
    structural_method_shape: z.int().min(0),
    field_signature: z.int().min(0),
    ambiguous: z.int().min(0),
    unmatched: z.int().min(0),
  }),
  methods: z.array(methodComparisonItemSchema),
  fields: z.array(fieldComparisonItemSchema),
  coverage: z.strictObject({
    status: z.enum(["complete-within-inputs", "partial"]),
    left_status: z.enum(["complete", "partial", "unavailable"]),
    right_status: z.enum(["complete", "partial", "unavailable"]),
  }),
  evidence_links: z.array(evidenceIdSchema).length(2),
  limitations: z.array(boundedTextSchema),
});

export type ManagedMemberComparisonResult = z.infer<
  typeof managedMemberComparisonResultSchema
>;

/** One authenticated side of a managed member comparison. */
export interface ManagedMemberComparisonSide {
  readonly evidenceId: string;
  readonly result: ManagedMemberInspection;
}

const callEdgesByCaller = (
  result: ManagedMemberInspection,
): ReadonlyMap<
  string,
  readonly ManagedMemberInspection["call_edges"][number][]
> => {
  const edges = new Map<
    string,
    ManagedMemberInspection["call_edges"][number][]
  >();
  for (const edge of result.call_edges) {
    const callerEdges = edges.get(edge.caller_token);
    if (callerEdges === undefined) edges.set(edge.caller_token, [edge]);
    else callerEdges.push(edge);
  }
  return edges;
};

const fieldAccessesByCaller = (
  result: ManagedMemberInspection,
): ReadonlyMap<
  string,
  readonly ManagedMemberInspection["field_accesses"][number][]
> => {
  const accesses = new Map<
    string,
    ManagedMemberInspection["field_accesses"][number][]
  >();
  for (const access of result.field_accesses) {
    const callerAccesses = accesses.get(access.method_token);
    if (callerAccesses === undefined)
      accesses.set(access.method_token, [access]);
    else callerAccesses.push(access);
  }
  return accesses;
};

/** Compare managed members with constrained exact and structural identities. */
export const compareManagedMembers = (
  left: ManagedMemberComparisonSide,
  right: ManagedMemberComparisonSide,
): ManagedMemberComparisonResult => {
  const scope = managedComparisonScope(left.result, right.result);
  const { methodMatches, fieldMatches } = keyMembers(left, right, scope);
  const itemContext = {
    leftEvidenceId: left.evidenceId,
    rightEvidenceId: right.evidenceId,
    leftComplete: left.result.metadata.status === "complete",
    rightComplete: right.result.metadata.status === "complete",
    leftMethodsComplete:
      left.result.metadata.status === "complete" &&
      hasCompleteMethodRows(left.result),
    rightMethodsComplete:
      right.result.metadata.status === "complete" &&
      hasCompleteMethodRows(right.result),
    scope,
    signatureResolutionExamined:
      hasSignatureResolution(left.result) &&
      hasSignatureResolution(right.result),
    sameArtifact: left.result.artifact.sha256 === right.result.artifact.sha256,
    leftAssembly: left.result.assembly,
    rightAssembly: right.result.assembly,
    leftCallEdgesByCaller: callEdgesByCaller(left.result),
    rightCallEdgesByCaller: callEdgesByCaller(right.result),
    leftFieldAccessesByCaller: fieldAccessesByCaller(left.result),
    rightFieldAccessesByCaller: fieldAccessesByCaller(right.result),
  };
  const methodItems = buildMethodItems(methodMatches, itemContext);
  const fieldItems = buildFieldItems(fieldMatches, itemContext);
  const allItems = [...methodItems, ...fieldItems];
  const summary = buildComparisonSummary(allItems);
  const matching = buildComparisonMatching(methodItems, fieldItems);
  const selectionAgreement = scope.agreement;
  const coverage = buildComparisonCoverage({
    left: left.result,
    right: right.result,
    selectionAgreement,
  });
  const limitations = comparisonLimitations(
    left.result,
    right.result,
    selectionAgreement,
  );
  const result = {
    comparison_id: `mmc_${digestCanonicalValue(
      {
        left: left.evidenceId,
        right: right.evidenceId,
        methods: [...methodItems],
        fields: [...fieldItems],
      },
      "Managed comparison",
    )}`,
    algorithm: {
      name: "rea-managed-member-comparison" as const,
      token_identity: "build-local" as const,
      name_matching: "exact-signature-fallback" as const,
    },
    left: sideManifest(left),
    right: sideManifest(right),
    summary,
    matching,
    methods: methodItems,
    fields: fieldItems,
    coverage,
    evidence_links: [left.evidenceId, right.evidenceId],
    limitations,
  } satisfies ManagedMemberComparisonResult;
  return managedMemberComparisonResultSchema.parse(result);
};
