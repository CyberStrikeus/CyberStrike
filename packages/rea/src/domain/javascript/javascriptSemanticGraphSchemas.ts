import { z } from "zod";

import { javascriptSourceRangeSchema } from "./javascriptSourceCoordinates.js";

import {
  applicationGraphEvidenceContextSchema,
  applicationGraphEvidenceLocationSchema,
  applicationGraphEvidenceSchema,
} from "./javascriptApplicationEvidenceSchemas.js";
import { jsonValueSchema } from "../jsonValue.js";
import { digestSchema, prefixedDigestSchema } from "../digests.js";

const boundedTextSchema = z.string().min(1);
const semanticNodeIdSchema = prefixedDigestSchema("jsrg_node");
const semanticRelationIdSchema = z
  .string()
  .regex(/^jsrg_relation_[a-f0-9]{64}$/u);
const semanticUnknownIdSchema = z
  .string()
  .regex(/^jsrg_unknown_[a-f0-9]{64}$/u);
const semanticEvidenceContextIdSchema = z
  .string()
  .regex(/^jsrg_evidence_[a-f0-9]{64}$/u);

/** One canonical owner for provenance shared by semantic graph facts. */
export const javaScriptSemanticEvidenceContextSchema =
  applicationGraphEvidenceContextSchema.extend({
    context_id: semanticEvidenceContextIdSchema,
  });

/** Location-specific reference to one exact graph-level evidence context. */
export const javaScriptSemanticEvidenceReferenceSchema = z.strictObject({
  context_id: semanticEvidenceContextIdSchema,
  location: applicationGraphEvidenceLocationSchema,
});

/** Semantic entity kinds admitted by JavaScript Semantic Relation Graph. */
export const JAVASCRIPT_SEMANTIC_NODE_KINDS = [
  "module",
  "function",
  "parameter",
  "binding",
  "expression",
  "literal",
  "property-slot",
  "call-site",
  "return-site",
  "closure-capture",
  "promise",
  "task",
  "event",
  "listener",
  "timer",
  "child-process",
  "stdio",
  "signal",
  "config-source",
  "request",
  "response",
  "boundary",
  "resource",
  "unknown-frontier",
] as const;

/** Required semantic-analysis coverage families. */
export const JAVASCRIPT_SEMANTIC_RELATION_FAMILIES = [
  "boundary",
  "call-flow",
  "child-process",
  "closure",
  "configuration",
  "data-flow",
  "event",
  "object-flow",
  "promise-ownership",
  "request",
  "resource-lifecycle",
  "timer",
] as const;

/** Directed semantic relations admitted by the graph. */
export const JAVASCRIPT_SEMANTIC_RELATIONS = [
  "acquires",
  "aggregates",
  "aliases",
  "argument-to-parameter",
  "awaits",
  "calls",
  "cancels-timer",
  "captures",
  "chains",
  "coerces",
  "connects-stdio",
  "consumed-by",
  "constructs-request",
  "creates-promise",
  "defaults",
  "defines",
  "destructures",
  "detaches-task",
  "dispatches-candidate",
  "forwards-signal",
  "influences",
  "listens-error",
  "listens-exit",
  "owns",
  "overrides",
  "parses",
  "reads",
  "reads-argv",
  "reads-config",
  "reads-environment",
  "reads-property",
  "registers-listener",
  "releases",
  "removes-listener",
  "returns-task",
  "returns-to-call",
  "schedules-timer",
  "spawns",
  "spreads",
  "supplies-argv",
  "supplies-env",
  "supplies-request-field",
  "validates",
  "writes",
  "writes-property",
] as const;

/** Map each semantic relation to its coverage family. */
export const JAVASCRIPT_SEMANTIC_RELATION_FAMILY = {
  acquires: "resource-lifecycle",
  aggregates: "promise-ownership",
  aliases: "data-flow",
  "argument-to-parameter": "call-flow",
  awaits: "promise-ownership",
  calls: "call-flow",
  "cancels-timer": "timer",
  captures: "closure",
  chains: "promise-ownership",
  coerces: "boundary",
  "connects-stdio": "child-process",
  "consumed-by": "request",
  "constructs-request": "request",
  "creates-promise": "promise-ownership",
  defaults: "configuration",
  defines: "data-flow",
  destructures: "object-flow",
  "detaches-task": "promise-ownership",
  "dispatches-candidate": "event",
  "forwards-signal": "child-process",
  influences: "data-flow",
  "listens-error": "child-process",
  "listens-exit": "child-process",
  owns: "promise-ownership",
  overrides: "configuration",
  parses: "boundary",
  reads: "data-flow",
  "reads-argv": "configuration",
  "reads-config": "configuration",
  "reads-environment": "configuration",
  "reads-property": "object-flow",
  "registers-listener": "event",
  releases: "resource-lifecycle",
  "removes-listener": "event",
  "returns-task": "promise-ownership",
  "returns-to-call": "call-flow",
  "schedules-timer": "timer",
  spawns: "child-process",
  spreads: "object-flow",
  "supplies-argv": "child-process",
  "supplies-env": "child-process",
  "supplies-request-field": "request",
  validates: "boundary",
  writes: "data-flow",
  "writes-property": "object-flow",
} as const satisfies Readonly<
  Record<
    (typeof JAVASCRIPT_SEMANTIC_RELATIONS)[number],
    (typeof JAVASCRIPT_SEMANTIC_RELATION_FAMILIES)[number]
  >
>;

const relativePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      path.split("/").every((part) => !["", ".", ".."].includes(part)),
    "Expected a normalized relative POSIX path without traversal",
  );

const semanticPropertiesSchema = z.record(z.string().min(1), jsonValueSchema);

const semanticNodeIdentitySchema = z.strictObject({
  artifact_sha256: digestSchema,
  module_path: relativePathSchema,
  source_range: javascriptSourceRangeSchema.nullable(),
  role_key: z.string().min(1),
});

/** One semantic entity before its canonical identifier is derived. */
export const javaScriptSemanticNodeInputSchema = z.strictObject({
  kind: z.enum(JAVASCRIPT_SEMANTIC_NODE_KINDS),
  identity: semanticNodeIdentitySchema,
  function_node_id: semanticNodeIdSchema.nullable(),
  application_node_ids: z.array(prefixedDigestSchema("jag_node")),
  label: z.string().min(1).nullable(),
  properties: semanticPropertiesSchema,
  evidence: applicationGraphEvidenceSchema,
});

/** One exact, artifact-version semantic entity. */
export const javaScriptSemanticNodeSchema =
  javaScriptSemanticNodeInputSchema.extend({
    evidence: javaScriptSemanticEvidenceReferenceSchema,
    node_id: semanticNodeIdSchema.describe(
      "SHA-256 of the node kind and identity; stable for one artifact version.",
    ),
  });

/** One directed semantic relationship before its ID is derived. */
export const javaScriptSemanticRelationInputSchema = z.strictObject({
  source_node_id: semanticNodeIdSchema,
  target_node_id: semanticNodeIdSchema,
  relation: z.enum(JAVASCRIPT_SEMANTIC_RELATIONS),
  resolution: z.enum(["resolved", "candidate"]),
  properties: semanticPropertiesSchema,
  evidence: applicationGraphEvidenceSchema,
});

/** One canonical directed semantic relationship. */
export const javaScriptSemanticRelationSchema =
  javaScriptSemanticRelationInputSchema.extend({
    evidence: javaScriptSemanticEvidenceReferenceSchema,
    relation_id: semanticRelationIdSchema.describe(
      "SHA-256 of the exact relation content, including its evidence reference.",
    ),
  });

/** Reasons semantic analysis can leave an explicit frontier. */
export const JAVASCRIPT_SEMANTIC_UNKNOWN_REASONS = [
  "ambiguous-target",
  "bound-reached",
  "dynamic-call",
  "dynamic-property",
  "dynamic-scope",
  "eval-or-generated-code",
  "incomplete-module",
  "missing-source",
  "resource-limit",
  "unknown-value",
  "unsupported-syntax",
] as const;

/** Counts examined emission occurrences, including repeats, without retaining discarded IDs. */
export const javaScriptSemanticUnknownOmissionSchema = z.strictObject({
  family: z.enum(JAVASCRIPT_SEMANTIC_RELATION_FAMILIES),
  reason: z.enum(JAVASCRIPT_SEMANTIC_UNKNOWN_REASONS),
  occurrences: z.int().positive(),
});
/** At most one summary row for each finite family/reason pair. */
export const javaScriptSemanticUnknownOmissionsSchema = z
  .array(javaScriptSemanticUnknownOmissionSchema)
  .min(1)
  .max(
    JAVASCRIPT_SEMANTIC_RELATION_FAMILIES.length *
      JAVASCRIPT_SEMANTIC_UNKNOWN_REASONS.length,
  );
export type JavaScriptSemanticUnknownOmission = z.infer<
  typeof javaScriptSemanticUnknownOmissionSchema
>;

/** One unresolved semantic frontier before its ID is derived. */
export const javaScriptSemanticUnknownInputSchema = z.strictObject({
  node_id: semanticNodeIdSchema.nullable(),
  family: z.enum(JAVASCRIPT_SEMANTIC_RELATION_FAMILIES),
  relation_kinds: z.array(z.enum(JAVASCRIPT_SEMANTIC_RELATIONS)).min(1),
  reason: z.enum(JAVASCRIPT_SEMANTIC_UNKNOWN_REASONS),
  detail: boundedTextSchema,
  candidate_node_ids: z.array(semanticNodeIdSchema),
  evidence: applicationGraphEvidenceSchema,
});

/** One canonical unresolved semantic frontier. */
export const javaScriptSemanticUnknownSchema =
  javaScriptSemanticUnknownInputSchema.extend({
    evidence: javaScriptSemanticEvidenceReferenceSchema,
    unknown_id: semanticUnknownIdSchema,
  });

const fingerprintComponentsSchema = z.strictObject({
  parameter_arity: z.int().min(0),
  normalized_ast_sha256: digestSchema,
  control_flow_sha256: digestSchema,
  relation_shape_sha256: digestSchema,
  literal_set_sha256: digestSchema,
  effects: z.array(
    z.enum([
      "async",
      "child-process",
      "event",
      "network",
      "promise",
      "resource",
      "timer",
    ]),
  ),
});

/** One bounded rename-resistant function fingerprint. */
export const javaScriptSemanticFingerprintInputSchema = z.strictObject({
  function_node_id: semanticNodeIdSchema,
  algorithm: z.literal("rea.javascript-semantic-function"),
  status: z.enum(["complete", "partial", "unavailable"]),
  components: fingerprintComponentsSchema,
  limitations: z.array(boundedTextSchema),
  evidence: applicationGraphEvidenceSchema,
});

/** One canonical function fingerprint record. */
export const javaScriptSemanticFingerprintSchema =
  javaScriptSemanticFingerprintInputSchema.extend({
    evidence: javaScriptSemanticEvidenceReferenceSchema,
    fingerprint_id: prefixedDigestSchema("jsrg_fingerprint"),
    fingerprint_sha256: digestSchema,
  });

const familyCoverageSchema = z.strictObject({
  family: z.enum(JAVASCRIPT_SEMANTIC_RELATION_FAMILIES),
  status: z.enum(["complete", "partial", "unknown", "unsupported"]),
  retained_relations: z.int().min(0),
  omitted_relations: z.int().min(0).nullable(),
  unknown_ids: z.array(semanticUnknownIdSchema),
});

const graphCoverageSchema = z.strictObject({
  status: z.enum(["complete", "partial", "unknown", "unavailable"]),
  truncated: z.boolean(),
  omitted_unknown_occurrences:
    javaScriptSemanticUnknownOmissionsSchema.exactOptional(),
  omitted_nodes: z.int().min(0).nullable(),
  omitted_relations: z.int().min(0).nullable(),
  limits: z.array(
    z.strictObject({
      name: z.string().min(1),
      value: z.int().min(0),
      unit: z.enum(["items", "bytes", "milliseconds", "depth", "other"]),
    }),
  ),
  families: z.array(familyCoverageSchema).length(12),
});

/** Graph content before its top-level commitment is derived. */
export const javaScriptSemanticGraphInputSchema = z.strictObject({
  schema: z.literal("JavaScriptSemanticRelationGraph"),
  root_artifact_sha256: digestSchema,
  application_graph_id: prefixedDigestSchema("jag"),
  root_node_ids: z.array(semanticNodeIdSchema).min(1),
  evidence_contexts: z.array(javaScriptSemanticEvidenceContextSchema),
  nodes: z.array(javaScriptSemanticNodeSchema).min(1),
  relations: z.array(javaScriptSemanticRelationSchema),
  fingerprints: z.array(javaScriptSemanticFingerprintSchema),
  unknowns: z.array(javaScriptSemanticUnknownSchema),
  coverage: graphCoverageSchema,
  limitations: z.array(boundedTextSchema),
});

/** Stored JavaScript Semantic Relation Graph. */
export const javaScriptSemanticGraphRecordSchema =
  javaScriptSemanticGraphInputSchema.extend({
    graph_id: prefixedDigestSchema("jsrg"),
  });

/** Canonical semantic node. */
export type JavaScriptSemanticGraphNode = z.infer<
  typeof javaScriptSemanticNodeSchema
>;
/** Compact provenance on one graph fact. */
export type JavaScriptSemanticEvidenceReference = z.infer<
  typeof javaScriptSemanticEvidenceReferenceSchema
>;
/** Content-addressed graph-level provenance context. */
export type JavaScriptSemanticEvidenceContext = z.infer<
  typeof javaScriptSemanticEvidenceContextSchema
>;
/** Canonical semantic relation. */
export type JavaScriptSemanticGraphRelation = z.infer<
  typeof javaScriptSemanticRelationSchema
>;
/** Canonical unresolved semantic frontier. */
export type JavaScriptSemanticGraphUnknown = z.infer<
  typeof javaScriptSemanticUnknownSchema
>;
/** Canonical function fingerprint with a compact evidence reference. */
export type JavaScriptSemanticFingerprint = z.infer<
  typeof javaScriptSemanticFingerprintSchema
>;
/** Canonical graph content before graph ID derivation. */
export type JavaScriptSemanticGraphInput = z.infer<
  typeof javaScriptSemanticGraphInputSchema
>;
