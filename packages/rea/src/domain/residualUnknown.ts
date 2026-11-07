import { uniqueSorted } from "./canonicalOrdering.js";
import { z } from "zod";
import { digestCanonicalValue } from "./canonicalDigest.js";
import {
  compareUnicodeCodePoints,
  compositeKey,
} from "./unicodeCodePointOrder.js";
import { prefixedDigestSchema } from "./../domain/digests.js";
import { functionComparisonDimensionNameSchema } from "./functionComparisonSchemas.js";

const evidenceIdSchema = prefixedDigestSchema("ev");
const unknownIdSchema = prefixedDigestSchema("unk");
const text = z.string().trim().min(1);
const environmentRequirementSchema = z.strictObject({
  id: z.string().min(1).nullable(),
  platform: z.string().min(1).nullable(),
  architecture: z.string().min(1).nullable(),
  isolation: z
    .enum(["none", "process", "container", "virtual-machine"])
    .nullable(),
});
const stableUnknownId = (
  question: string,
  domain: string,
  scopeDigest: string | null,
  comparisonConclusionScope?: z.infer<typeof comparisonConclusionScopeSchema>,
): string =>
  `unk_${digestCanonicalValue(
    {
      domain: domain.trim(),
      question: question.replace(/\s+/gu, " ").trim(),
      scope_digest: scopeDigest,
      ...(comparisonConclusionScope === undefined
        ? {}
        : { comparison_conclusion_scope: comparisonConclusionScope }),
    },
    "Unknown identity",
  )}`;

const probeSchema = z.strictObject({
  operation: z.string().min(1),
  rationale: text,
});
const comparisonConclusionScopeSchema = z
  .object({
    comparison_evidence_id: evidenceIdSchema,
    dimensions: z
      .array(
        z.union([z.literal("overall"), functionComparisonDimensionNameSchema]),
      )
      .min(1),
  })
  .strict()
  .superRefine(({ dimensions }, context) => {
    if (!sameOrderedValues(dimensions, uniqueSorted(dimensions)))
      context.addIssue({
        code: "custom",
        message: "Comparison dimensions must be sorted and unique",
      });
  });
const relationshipSchema = z.strictObject({
  type: z.enum(["depends-on", "related-to", "contradicts"]),
  unknown_id: unknownIdSchema,
});
const resolutionSchema = z.discriminatedUnion("disposition", [
  z.strictObject({
    disposition: z.literal("verified"),
    rationale: text,
    evidence_ids: z.array(evidenceIdSchema).min(1),
  }),
  z.strictObject({
    disposition: z.enum(["withdrawn", "out-of-scope"]),
    rationale: text,
    evidence_ids: z.array(evidenceIdSchema),
  }),
]);

/** Strict durable record for one unresolved or evidence-qualified question. */
const residualUnknownObjectSchema = z.strictObject({
  unknown_id: unknownIdSchema,
  revision: z.int().min(1),
  previous_revision_digest: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  revision_digest: z.string().regex(/^[a-f0-9]{64}$/u),
  scope_digest: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  question: text,
  status: z.enum([
    "open",
    "investigating",
    "blocked",
    "contradicted",
    "resolved",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  domain: text,
  comparison_conclusion_scope: comparisonConclusionScopeSchema.exactOptional(),
  supporting_evidence_ids: z.array(evidenceIdSchema),
  contradicting_evidence_ids: z.array(evidenceIdSchema),
  required_authority: z
    .enum([
      "shipped-artifact",
      "controlled-replay",
      "historical-reference",
      "external-service",
      "analyst-inference",
    ])
    .nullable(),
  required_confidence: z.enum(["observed", "derived", "inferred"]),
  required_environment: environmentRequirementSchema.nullable(),
  recommended_probes: z.array(probeSchema),
  relationships: z.array(relationshipSchema),
  resolution: resolutionSchema.nullable(),
  mutation_evidence_ids: z.array(evidenceIdSchema).min(1),
});

export type ResidualUnknown = z.infer<typeof residualUnknownSchema>;

type UnknownRevision = Omit<
  z.infer<typeof residualUnknownObjectSchema>,
  "revision_digest"
>;

const refineRevision = (value: UnknownRevision, context: z.RefinementCtx) => {
  if (
    value.unknown_id !==
    stableUnknownId(
      value.question,
      value.domain,
      value.scope_digest,
      value.comparison_conclusion_scope,
    )
  )
    context.addIssue({
      code: "custom",
      message: "Residual unknown ID does not match its immutable identity",
      path: ["unknown_id"],
    });
  if ((value.revision === 1) !== (value.previous_revision_digest === null))
    context.addIssue({
      code: "custom",
      message: "Only the first revision has no predecessor",
      path: ["previous_revision_digest"],
    });
  if ((value.status === "resolved") !== (value.resolution !== null))
    context.addIssue({
      code: "custom",
      message: "Only resolved unknowns carry a resolution",
      path: ["resolution"],
    });
  if (
    value.status === "contradicted" &&
    value.contradicting_evidence_ids.length === 0
  )
    context.addIssue({
      code: "custom",
      message: "Contradicted status requires contradicting evidence",
      path: ["contradicting_evidence_ids"],
    });
  if (
    value.relationships.some(
      (relationship) => relationship.unknown_id === value.unknown_id,
    )
  )
    context.addIssue({
      code: "custom",
      message: "An unknown cannot relate to itself",
      path: ["relationships"],
    });
  for (const ids of [
    value.supporting_evidence_ids,
    value.contradicting_evidence_ids,
    value.mutation_evidence_ids,
  ])
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "Evidence IDs must be unique",
      });
  if (
    value.comparison_conclusion_scope !== undefined &&
    ![
      ...value.supporting_evidence_ids,
      ...value.contradicting_evidence_ids,
    ].includes(value.comparison_conclusion_scope.comparison_evidence_id)
  )
    context.addIssue({
      code: "custom",
      message:
        "Scoped comparison Evidence must support or contradict the unknown",
      path: ["comparison_conclusion_scope"],
    });
  if (
    value.comparison_conclusion_scope !== undefined &&
    value.domain !== "function-comparison"
  )
    context.addIssue({
      code: "custom",
      message:
        "Comparison conclusion scope requires function-comparison domain",
      path: ["comparison_conclusion_scope"],
    });
  const contradictingEvidence = new Set(value.contradicting_evidence_ids);
  if (value.supporting_evidence_ids.some((id) => contradictingEvidence.has(id)))
    context.addIssue({
      code: "custom",
      message: "Evidence cannot simultaneously support and contradict",
    });
  const relationships = value.relationships.map(
    (relationship) => `${relationship.type}:${relationship.unknown_id}`,
  );
  if (new Set(relationships).size !== relationships.length)
    context.addIssue({
      code: "custom",
      message: "Relationships must be unique",
      path: ["relationships"],
    });
};

export const residualUnknownSchema = residualUnknownObjectSchema.superRefine(
  (value, context) => {
    if (computeRevisionDigest(value) !== value.revision_digest)
      context.addIssue({
        code: "custom",
        message: "Residual unknown revision digest does not match",
        path: ["revision_digest"],
      });
    refineRevision(value, context);
  },
);

const generatedRevisionSchema = residualUnknownObjectSchema
  .omit({ revision_digest: true })
  .superRefine(refineRevision);

export type UnknownStatus = ResidualUnknown["status"];

/** Input for deterministic creation of one residual unknown. */
export const recordUnknownInputSchema = residualUnknownObjectSchema
  .omit({
    unknown_id: true,
    revision: true,
    previous_revision_digest: true,
    revision_digest: true,
    scope_digest: true,
    status: true,
    supporting_evidence_ids: true,
    contradicting_evidence_ids: true,
    resolution: true,
    mutation_evidence_ids: true,
  })
  .extend({
    supporting_evidence_ids: z.array(evidenceIdSchema).default([]),
    contradicting_evidence_ids: z.array(evidenceIdSchema).default([]),
  })
  .strict();

export type RecordUnknownInput = z.infer<typeof recordUnknownInputSchema>;

/** Explicit optimistic-concurrency update command for one unknown. */
export const updateUnknownInputSchema = z.strictObject({
  unknown_id: unknownIdSchema,
  expected_revision: z.int().min(1),
  status: residualUnknownObjectSchema.shape.status,
  severity: residualUnknownObjectSchema.shape.severity,
  supporting_evidence_ids: z.array(evidenceIdSchema),
  contradicting_evidence_ids: z.array(evidenceIdSchema),
  required_authority: residualUnknownObjectSchema.shape.required_authority,
  required_confidence: residualUnknownObjectSchema.shape.required_confidence,
  required_environment: environmentRequirementSchema.nullable(),
  recommended_probes: z.array(probeSchema),
  relationships: z.array(relationshipSchema),
  resolution: resolutionSchema.nullable(),
});

export type UpdateUnknownInput = z.infer<typeof updateUnknownInputSchema>;

/** Create stable identity from immutable question and domain fields. */
export const createResidualUnknown = (
  input: RecordUnknownInput,
  mutationEvidenceId: string,
  scopeDigest: string | null,
): ResidualUnknown => {
  const question = input.question.replace(/\s+/gu, " ").trim();
  const domain = input.domain.trim();
  const comparisonConclusionScope =
    input.comparison_conclusion_scope === undefined
      ? undefined
      : {
          comparison_evidence_id:
            input.comparison_conclusion_scope.comparison_evidence_id,
          dimensions: input.comparison_conclusion_scope.dimensions,
        };
  const revision = {
    unknown_id: stableUnknownId(
      question,
      domain,
      scopeDigest,
      comparisonConclusionScope,
    ),
    revision: 1,
    previous_revision_digest: null,
    scope_digest: scopeDigest,
    question,
    status:
      input.contradicting_evidence_ids.length > 0 ? "contradicted" : "open",
    domain,
    ...(comparisonConclusionScope === undefined
      ? {}
      : { comparison_conclusion_scope: comparisonConclusionScope }),
    ...projectRevisionDetails(input),
    resolution: null,
    mutation_evidence_ids: [mutationEvidenceId],
  } satisfies Omit<ResidualUnknown, "revision_digest">;
  return createRevision(revision);
};

/** Apply a complete, revision-guarded replacement while preserving identity. */
export const updateResidualUnknown = (
  current: ResidualUnknown,
  input: UpdateUnknownInput,
  mutationEvidenceId: string,
): ResidualUnknown => {
  const revision = {
    unknown_id: current.unknown_id,
    revision: current.revision + 1,
    previous_revision_digest: current.revision_digest,
    scope_digest: current.scope_digest,
    question: current.question,
    status: input.status,
    domain: current.domain,
    ...(current.comparison_conclusion_scope === undefined
      ? {}
      : { comparison_conclusion_scope: current.comparison_conclusion_scope }),
    ...projectRevisionDetails(input),
    resolution: input.resolution,
    mutation_evidence_ids: uniqueSorted([
      ...current.mutation_evidence_ids,
      mutationEvidenceId,
    ]),
  } satisfies Omit<ResidualUnknown, "revision_digest">;
  return createRevision(revision);
};

/** Validate and normalize owned revision fields before computing their digest. */
const createRevision = (value: UnknownRevision): ResidualUnknown => {
  const revision = generatedRevisionSchema.parse(value);
  return { ...revision, revision_digest: computeRevisionDigest(revision) };
};

type RevisionDetailsInput = Pick<
  ResidualUnknown,
  | "severity"
  | "supporting_evidence_ids"
  | "contradicting_evidence_ids"
  | "required_authority"
  | "required_confidence"
  | "required_environment"
  | "recommended_probes"
  | "relationships"
>;

const projectRevisionDetails = (input: RevisionDetailsInput) => ({
  severity: input.severity,
  supporting_evidence_ids: uniqueSorted(input.supporting_evidence_ids),
  contradicting_evidence_ids: uniqueSorted(input.contradicting_evidence_ids),
  required_authority: input.required_authority,
  required_confidence: input.required_confidence,
  required_environment: input.required_environment,
  recommended_probes: [...input.recommended_probes],
  relationships: sortedRelationships(input.relationships),
});

const computeRevisionDigest = (
  value: UnknownRevision | ResidualUnknown,
): string => {
  const { revision_digest: _revisionDigest, ...semantic } =
    "revision_digest" in value ? value : { ...value, revision_digest: "" };
  void _revisionDigest;
  return digestCanonicalValue(semantic, "Unknown identity");
};

const sameOrderedValues = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const sortedRelationships = (
  values: readonly z.infer<typeof relationshipSchema>[],
): z.infer<typeof relationshipSchema>[] =>
  [...values].sort((left, right) =>
    compareUnicodeCodePoints(
      compositeKey([left.type, left.unknown_id]),
      compositeKey([right.type, right.unknown_id]),
    ),
  );
