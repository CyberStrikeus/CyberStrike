import { z } from "zod";
import { javascriptSourceRangeSchema } from "./javascriptSourceCoordinates.js";
import { digestSchema, prefixedDigestSchema } from "../digests.js";

const boundedTextSchema = z.string().min(1);
const boundedKeySchema = z.string().min(1);
const unsafePathSegments = new Set(["", ".", ".."]);
const isSafeRelativePath = (path: string): boolean => {
  if (path.startsWith("/")) return false;
  return path.split("/").every((part) => !unsafePathSegments.has(part));
};
const relativePathSchema = z
  .string()
  .min(1)
  .refine(
    isSafeRelativePath,
    "Expected a normalized relative POSIX path without traversal",
  );

/** Authority that produced one node observation or relationship. */
const applicationEvidenceAuthoritySchema = z.enum([
  "artifact-bytes",
  "ast-static-analysis",
  "static-relationship-inference",
  "passive-cdp-runtime",
  "cross-layer-reconciliation",
  "cross-version-comparison",
  "controlled-replay",
  "native-analysis-provider",
  "managed-static-analysis",
  "historical-reference",
  "user-assertion",
  "unknown",
]);

/** Epistemic state kept separate from the evidence source. */
const applicationFactStateSchema = z.enum([
  "observed",
  "inferred",
  "unknown",
  "unavailable",
]);

/** Confidence assigned without promoting inference into observation. */
const applicationConfidenceSchema = z.enum([
  "exact",
  "high",
  "medium",
  "low",
  "unknown",
]);

/** Why an artifact or source location was not available to an extractor. */
const applicationUnavailableReasonSchema = z.enum([
  "not-applicable",
  "not-observed",
  "truncated",
  "provider-unavailable",
  "unresolved",
  "unknown",
]);

const unavailableFactSchema = z.strictObject({
  available: z.literal(false),
  reason: applicationUnavailableReasonSchema,
  detail: boundedTextSchema,
});

const availableArtifactSchema = z
  .strictObject({
    available: z.literal(true),
    artifact_id: prefixedDigestSchema("art"),
    sha256: digestSchema,
  })
  .superRefine((artifact, context) => {
    if (artifact.artifact_id !== `art_${artifact.sha256}`)
      context.addIssue({
        code: "custom",
        path: ["artifact_id"],
        message: "Artifact identifier must commit the same SHA-256 digest",
      });
  });

/** Explicit content-addressed artifact availability for one graph fact. */
const applicationArtifactReferenceSchema = z.discriminatedUnion("available", [
  availableArtifactSchema,
  unavailableFactSchema,
]);

const sourceRangeSchema = javascriptSourceRangeSchema.safeExtend({
  kind: z.literal("source-range"),
  source: boundedTextSchema,
});

const fileOffsetRangeSchema = z
  .strictObject({
    kind: z.literal("file-offset-range"),
    start: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
    end: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .superRefine((location, context) => {
    if (location.end < location.start)
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "File offset range end must not precede its start",
      });
  });

/** A deterministic artifact, source, runtime, package, or native location. */
const applicationLocationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("artifact-path"),
    path: relativePathSchema,
  }),
  sourceRangeSchema,
  fileOffsetRangeSchema,
  z.strictObject({
    kind: z.literal("url"),
    url: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("runtime"),
    capture_sha256: digestSchema,
    target_key: boundedKeySchema,
    frame_key: boundedKeySchema.nullable(),
    script_key: boundedKeySchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("native-address"),
    address: boundedKeySchema,
    symbol: boundedTextSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("package-export"),
    package_name: boundedKeySchema,
    export_path: boundedTextSchema,
  }),
]);

/** Source-location availability and coordinates retained on each graph fact. */
export const applicationGraphEvidenceLocationSchema = z.discriminatedUnion(
  "available",
  [
    z.strictObject({
      available: z.literal(true),
      value: applicationLocationSchema,
    }),
    unavailableFactSchema,
  ],
);

/** Versioned extractor coordinates attached to every graph fact. */
const applicationExtractorSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  operation: z.string().min(1),
  executable_sha256: digestSchema.nullable(),
});

const applicationLimitSchema = z.strictObject({
  name: z.string().min(1),
  value: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  unit: z.enum([
    "items",
    "bytes",
    "milliseconds",
    "depth",
    "characters",
    "instructions",
    "other",
  ]),
});

/** Bounded collection coverage without treating omission as absence. */
const coverageLimitsSchema = z.array(applicationLimitSchema);
const omittedCountSchema = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

export const applicationCoverageSchema = z.union([
  z.strictObject({
    status: z.literal("complete"),
    truncated: z.literal(false),
    omitted_count: z.literal(0),
    limits: coverageLimitsSchema,
  }),
  z.strictObject({
    status: z.literal("partial"),
    truncated: z.literal(false),
    omitted_count: omittedCountSchema.nullable(),
    limits: coverageLimitsSchema,
  }),
  z.strictObject({
    status: z.literal("partial"),
    truncated: z.literal(true),
    omitted_count: z.union([omittedCountSchema.positive(), z.null()]),
    limits: z.array(applicationLimitSchema).min(1),
  }),
  z.strictObject({
    status: z.enum(["unknown", "unavailable"]),
    truncated: z.literal(false),
    omitted_count: z.null(),
    limits: coverageLimitsSchema,
  }),
]);
export type ApplicationCoverage = z.infer<typeof applicationCoverageSchema>;

/** Construct complete bounded coverage under the stated configured limits. */
export const completeApplicationCoverage = (
  limits: ApplicationCoverage["limits"] = [],
): ApplicationCoverage =>
  applicationCoverageSchema.parse({
    status: "complete",
    truncated: false,
    omitted_count: 0,
    limits,
  });

/** Construct partial non-truncated coverage without inventing omissions. */
export const partialApplicationCoverage = (
  limits: ApplicationCoverage["limits"],
  omittedCount: number | null,
): ApplicationCoverage =>
  applicationCoverageSchema.parse({
    status: "partial",
    truncated: false,
    omitted_count: omittedCount,
    limits,
  });

/** Construct limit-truncated coverage with a named bound. */
export const truncatedApplicationCoverage = (
  limits: ApplicationCoverage["limits"],
  omittedCount: number | null,
): ApplicationCoverage =>
  applicationCoverageSchema.parse({
    status: "partial",
    truncated: true,
    omitted_count: omittedCount,
    limits,
  });

const applicationGraphEvidenceBaseSchema = z.strictObject({
  authority: applicationEvidenceAuthoritySchema,
  state: applicationFactStateSchema,
  confidence: applicationConfidenceSchema,
  artifact: applicationArtifactReferenceSchema,
  location: applicationGraphEvidenceLocationSchema,
  extractor: applicationExtractorSchema,
  coverage: applicationCoverageSchema,
  limitations: z.array(boundedTextSchema),
  evidence_ids: z.array(prefixedDigestSchema("ev")),
});

/** Shared provenance fields apart from the fact-specific evidence location. */
export const applicationGraphEvidenceContextSchema =
  applicationGraphEvidenceBaseSchema.omit({ location: true });

type EvidenceValue = z.infer<typeof applicationGraphEvidenceBaseSchema>;

const checkAuthorityState = (
  evidence: EvidenceValue,
  context: z.RefinementCtx,
): void => {
  if (
    evidence.authority === "static-relationship-inference" &&
    evidence.state !== "inferred"
  )
    context.addIssue({
      code: "custom",
      path: ["state"],
      message: "Static relationship authority must remain inferred",
    });
  if (
    evidence.authority === "cross-layer-reconciliation" &&
    evidence.state !== "inferred"
  )
    context.addIssue({
      code: "custom",
      path: ["state"],
      message: "Cross-layer reconciliation authority must remain inferred",
    });
  if (
    evidence.authority === "cross-version-comparison" &&
    evidence.state !== "inferred"
  )
    context.addIssue({
      code: "custom",
      path: ["state"],
      message: "Cross-version comparison authority must remain inferred",
    });
  if (
    evidence.authority === "unknown" &&
    !["unknown", "unavailable"].includes(evidence.state)
  )
    context.addIssue({
      code: "custom",
      path: ["state"],
      message: "Unknown authority cannot claim an observed fact",
    });
};

const checkStateConfidence = (
  evidence: EvidenceValue,
  context: z.RefinementCtx,
): void => {
  if (
    ["unknown", "unavailable"].includes(evidence.state) &&
    (evidence.confidence !== "unknown" || evidence.limitations.length === 0)
  )
    context.addIssue({
      code: "custom",
      message:
        "Unknown and unavailable facts require unknown confidence and an explicit limitation",
    });
  if (evidence.state === "observed" && evidence.confidence === "unknown")
    context.addIssue({
      code: "custom",
      path: ["confidence"],
      message: "Observed facts require a bounded non-unknown confidence",
    });
  if (
    evidence.state === "inferred" &&
    !["high", "medium", "low"].includes(evidence.confidence)
  )
    context.addIssue({
      code: "custom",
      path: ["confidence"],
      message: "Inferred facts require high, medium, or low confidence",
    });
  if (evidence.confidence === "exact" && evidence.state !== "observed")
    context.addIssue({
      code: "custom",
      path: ["confidence"],
      message: "Exact confidence is reserved for observed facts",
    });
};

const checkTraceability = (
  evidence: EvidenceValue,
  context: z.RefinementCtx,
): void => {
  if (evidence.state === "observed" && !evidence.location.available)
    context.addIssue({
      code: "custom",
      path: ["location"],
      message: "Observed facts require an actionable location",
    });
  if (evidence.state === "inferred" && evidence.limitations.length === 0)
    context.addIssue({
      code: "custom",
      path: ["limitations"],
      message: "Inferred facts require an explicit limitation",
    });
  if (
    evidence.coverage.status !== "complete" &&
    evidence.limitations.length === 0
  )
    context.addIssue({
      code: "custom",
      path: ["limitations"],
      message: "Non-complete coverage requires an explicit limitation",
    });
};

const checkArtifactBacking = (
  evidence: EvidenceValue,
  context: z.RefinementCtx,
): void => {
  const artifactBacked = [
    "artifact-bytes",
    "ast-static-analysis",
    "controlled-replay",
    "native-analysis-provider",
    "managed-static-analysis",
  ].includes(evidence.authority);
  if (
    artifactBacked &&
    evidence.state !== "unavailable" &&
    !evidence.artifact.available
  )
    context.addIssue({
      code: "custom",
      path: ["artifact"],
      message: "Artifact-backed facts require a content digest",
    });
};

/** Provenance, authority, uncertainty, and bounds for one graph fact. */
export const applicationGraphEvidenceSchema =
  applicationGraphEvidenceBaseSchema.superRefine((evidence, context) => {
    checkAuthorityState(evidence, context);
    checkStateConfidence(evidence, context);
    checkTraceability(evidence, context);
    checkArtifactBacking(evidence, context);
  });

/** Stable node identifier strategies and their explicit scope. */
export const applicationNodeIdentitySchema = z.discriminatedUnion("strategy", [
  z.strictObject({
    strategy: z.literal("content-digest"),
    stability: z.literal("global-exact"),
    sha256: digestSchema,
  }),
  z.strictObject({
    strategy: z.literal("source-map-original"),
    stability: z.literal("source-map-exact"),
    source_map_sha256: digestSchema,
    // The exact `sources` entry; `""` is a legal relative reference.
    original_source: z.string(),
    // Exact leaf-local root; null means omitted or explicitly null.
    source_root: z.string().nullable(),
    source_sha256: digestSchema.nullable(),
  }),
  z.strictObject({
    strategy: z.literal("canonical-path"),
    stability: z.literal("artifact-version"),
    artifact_sha256: digestSchema,
    path: relativePathSchema,
  }),
  z.strictObject({
    strategy: z.literal("structural-fingerprint"),
    stability: z.literal("cross-version-inference"),
    algorithm: z.string().min(1),
    fingerprint_sha256: digestSchema,
    basis: z
      .array(
        z.enum([
          "syntax-tree",
          "control-flow",
          "imports",
          "exports",
          "literals",
          "api-usage",
        ]),
      )
      .min(1),
  }),
  z.strictObject({
    strategy: z.literal("artifact-local-key"),
    stability: z.literal("artifact-version"),
    artifact_sha256: digestSchema,
    namespace: boundedKeySchema,
    // The exact artifact-local value, such as `""` from `fetch("")`.
    key: z.string(),
  }),
  z.strictObject({
    strategy: z.literal("runtime-instance"),
    stability: z.literal("capture-only"),
    capture_sha256: digestSchema,
    runtime_key: boundedTextSchema,
  }),
  z.strictObject({
    strategy: z.literal("observation-fingerprint"),
    stability: z.literal("observation-only"),
    observation_sha256: digestSchema,
    scope: boundedTextSchema,
  }),
]);

/** Evidence coordinates attached to one graph observation or edge. */
export type ApplicationGraphEvidence = z.infer<
  typeof applicationGraphEvidenceSchema
>;

/** Provenance shared by facts with the same non-location evidence. */
export type ApplicationGraphEvidenceContext = z.infer<
  typeof applicationGraphEvidenceContextSchema
>;

/** Explicit stable identity strategy for one application entity. */
export type ApplicationNodeIdentity = z.infer<
  typeof applicationNodeIdentitySchema
>;
