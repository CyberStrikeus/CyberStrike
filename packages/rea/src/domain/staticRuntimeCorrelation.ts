import { digestCanonicalValue } from "./canonicalDigest.js";
import { z } from "zod";

import type { AnalysisInputError } from "./analysisErrorCore.js";
import { EvidenceIntegrityError } from "./evidenceErrors.js";
import { analysisInputErrorFromIssues } from "./inputIssueProjection.js";
import { readEvidence } from "./evidenceValidation.js";
import { uniqueSorted } from "./canonicalOrdering.js";
import { compareUnicodeCodePoints } from "./unicodeCodePointOrder.js";
import { comparisonSourceEvidenceIds } from "./comparisonSourceEvidence.js";
import {
  readComparisonResult,
  type ParsedComparisonEvidence,
} from "./comparisonEvidenceResult.js";
import { evidenceSchema, type Evidence } from "./evidence.js";
import { hasComparisonEvidenceIdentity } from "./comparisonEvidenceIdentity.js";
import { functionComparisonDimensionNameSchema } from "./functionComparisonSchemas.js";
import type { JsonValue } from "./jsonValue.js";
import {
  comparisonStatusSchema,
  PROCESS_COMPARISON_DIMENSIONS,
} from "./process/processComparison.js";
import { prefixedDigestSchema } from "./../domain/digests.js";

const evidenceIdSchema = prefixedDigestSchema("ev");
const runtimeDimensionSchema = z.enum(PROCESS_COMPARISON_DIMENSIONS);
const expectedPatternSchema = z.enum([
  "cochanged",
  "static_only",
  "runtime_only",
  "both_unchanged",
]);
const observedPatternSchema = z.enum([
  ...expectedPatternSchema.options,
  "unknown",
  "truncated",
]);

const artifactSelectorSchema = z
  .object({
    kind: z.literal("artifact"),
    logical_path: z.string().min(1),
  })
  .strict();
const functionSelectorSchema = z
  .object({
    kind: z.literal("function"),
    dimension: functionComparisonDimensionNameSchema,
  })
  .strict();
const staticSelectorSchema = z.discriminatedUnion("kind", [
  artifactSelectorSchema,
  functionSelectorSchema,
]);

const mappingSchema = z
  .object({
    static: z
      .object({
        comparison_evidence_id: evidenceIdSchema,
        selector: staticSelectorSchema,
      })
      .strict(),
    runtime: z
      .object({
        comparison_evidence_id: evidenceIdSchema,
        dimension: runtimeDimensionSchema,
      })
      .strict(),
    side_alignment: z.enum(["left_to_left", "left_to_right"]),
    hypothesis: z
      .object({
        statement: z.string().trim().min(1),
        expected_pattern: expectedPatternSchema,
      })
      .strict(),
  })
  .strict();

/** Strict input for explicit static/runtime hypothesis correlation. */
export const staticRuntimeCorrelationInputSchema = z
  .object({
    static_comparisons: z.array(evidenceSchema).min(1),
    runtime_comparisons: z.array(evidenceSchema).min(1),
    mappings: z.array(mappingSchema).min(1),
  })
  .strict();
const staticRuntimeCorrelationEnvelopeSchema =
  staticRuntimeCorrelationInputSchema
    .omit({ static_comparisons: true, runtime_comparisons: true })
    .extend({
      static_comparisons: z.array(z.unknown()).min(1),
      runtime_comparisons: z.array(z.unknown()).min(1),
    })
    .strict();

const correlationItemSchema = z.object({
  correlation_id: prefixedDigestSchema("cor"),
  static: z.object({
    comparison_evidence_id: evidenceIdSchema,
    selector: staticSelectorSchema,
    status: comparisonStatusSchema,
    conclusion_kind: z.enum([
      "derived_relationship",
      "contradiction",
      "unresolved_branch",
    ]),
  }),
  runtime: z.object({
    comparison_evidence_id: evidenceIdSchema,
    dimension: runtimeDimensionSchema,
    status: comparisonStatusSchema,
  }),
  side_alignment: z.enum(["left_to_left", "left_to_right"]),
  hypothesis: z.object({
    statement: z.string().min(1),
    expected_pattern: expectedPatternSchema,
  }),
  observed_pattern: observedPatternSchema,
  classification: z.enum(["hypothesis", "contradiction", "unresolved_branch"]),
  evidence_links: z.array(evidenceIdSchema).min(2),
  limitations: z.array(z.string()),
});

/** Deterministic static/runtime correlation payload. */
export const staticRuntimeCorrelationResultSchema = z.object({
  status: z.enum(["correlated", "contradicted", "unknown", "truncated"]),
  summary: z.object({
    hypotheses: z.int().min(0),
    contradictions: z.int().min(0),
    unresolved: z.int().min(0),
  }),
  correlations: z.object({
    items: z.array(correlationItemSchema),
  }),
  evidence_links: z.array(evidenceIdSchema).min(2),
  limitations: z.array(z.string()),
});

export type StaticRuntimeCorrelationResult = z.infer<
  typeof staticRuntimeCorrelationResultSchema
>;
type Mapping = z.infer<typeof mappingSchema>;
type CorrelationItem = z.infer<typeof correlationItemSchema>;
type ComparisonStatus = z.infer<typeof comparisonStatusSchema>;
type StaticComparison = ParsedComparisonEvidence<
  "compare_artifacts" | "compare_functions"
>;
type RuntimeComparison = ParsedComparisonEvidence<"compare_process_captures">;

/** Correlate only caller-declared static/runtime hypotheses. */
export const correlateStaticAndRuntime = (
  input: unknown,
): StaticRuntimeCorrelationResult => {
  const parsed = staticRuntimeCorrelationEnvelopeSchema.safeParse(input);
  if (!parsed.success)
    throw analysisInputErrorFromIssues(OPERATION, parsed.error.issues, input, {
      cause: parsed.error,
      userMessage:
        "Provide valid static and runtime comparison Evidence and mappings.",
    });
  const { data } = parsed;
  const staticEvidence = data.static_comparisons.map((item, index) =>
    parseStatic(item, input, index),
  );
  const runtimeEvidence = data.runtime_comparisons.map((item, index) =>
    parseRuntime(item, input, index),
  );
  assertUnique(
    staticEvidence.map(({ evidence }) => evidence.evidence_id),
    input,
    ["static_comparisons"],
    "Static/runtime correlation rejects duplicate static comparison Evidence",
  );
  assertUnique(
    runtimeEvidence.map(({ evidence }) => evidence.evidence_id),
    input,
    ["runtime_comparisons"],
    "Static/runtime correlation rejects duplicate runtime comparison Evidence",
  );
  const staticById = byId(staticEvidence);
  const runtimeById = byId(runtimeEvidence);
  const correlations = data.mappings.map((mapping, index) =>
    correlate(mapping, staticById, runtimeById, input, index),
  );
  const duplicateMappingIndex = firstDuplicateIndex(
    correlations.map(({ correlation_id }) => correlation_id),
  );
  if (duplicateMappingIndex !== undefined)
    throw callerInputError(
      input,
      ["mappings", duplicateMappingIndex],
      "Static/runtime correlation rejects duplicate mappings",
    );
  correlations.sort((left, right) =>
    compareUnicodeCodePoints(left.correlation_id, right.correlation_id),
  );
  const links = uniqueSorted(
    correlations.flatMap(({ evidence_links: evidenceLinks }) => evidenceLinks),
  );
  const unresolved = correlations.filter(
    ({ classification }) => classification === "unresolved_branch",
  );
  const contradictions = correlations.filter(
    ({ classification }) => classification === "contradiction",
  );
  return staticRuntimeCorrelationResultSchema.parse({
    status: correlations.some(
      ({ observed_pattern: pattern }) => pattern === "truncated",
    )
      ? "truncated"
      : unresolved.length > 0
        ? "unknown"
        : contradictions.length > 0
          ? "contradicted"
          : "correlated",
    summary: {
      hypotheses:
        correlations.length - contradictions.length - unresolved.length,
      contradictions: contradictions.length,
      unresolved: unresolved.length,
    },
    correlations: {
      items: correlations,
    },
    evidence_links: links,
    limitations: [
      "Mappings are caller-declared hypotheses; consistency does not establish causality.",
      "Only explicit mappings were evaluated; similar unmapped observations were not correlated.",
    ],
  });
};

const correlate = (
  mapping: Mapping,
  staticById: ReadonlyMap<string, StaticComparison>,
  runtimeById: ReadonlyMap<string, RuntimeComparison>,
  input: unknown,
  mappingIndex: number,
): CorrelationItem => {
  const staticEvidence = required(
    staticById,
    mapping.static.comparison_evidence_id,
    "static comparison",
    input,
    ["mappings", mappingIndex, "static", "comparison_evidence_id"],
  );
  const runtimeEvidence = required(
    runtimeById,
    mapping.runtime.comparison_evidence_id,
    "runtime comparison",
    input,
    ["mappings", mappingIndex, "runtime", "comparison_evidence_id"],
  );
  const { limitations: selectedLimitations, ...selectedStatic } = selectStatic(
    staticEvidence,
    mapping.static.selector,
    input,
    ["mappings", mappingIndex, "static", "selector"],
  );
  const process = runtimeEvidence.result;
  const runtimeStatus = process[mapping.runtime.dimension];
  const pattern = observedPattern(selectedStatic, runtimeStatus);
  const classification =
    pattern === "unknown" || pattern === "truncated"
      ? "unresolved_branch"
      : pattern === mapping.hypothesis.expected_pattern
        ? "hypothesis"
        : "contradiction";
  const projection = {
    static: mapping.static,
    runtime: mapping.runtime,
    side_alignment: mapping.side_alignment,
    hypothesis: mapping.hypothesis,
  } satisfies JsonValue;
  return correlationItemSchema.parse({
    correlation_id: `cor_${digestCanonicalValue(projection, "Static/runtime correlation")}`,
    static: { ...mapping.static, ...selectedStatic },
    runtime: { ...mapping.runtime, status: runtimeStatus },
    side_alignment: mapping.side_alignment,
    hypothesis: mapping.hypothesis,
    observed_pattern: pattern,
    classification,
    evidence_links: uniqueSorted([
      staticEvidence.evidence.evidence_id,
      ...staticEvidence.evidence.evidence_links,
      runtimeEvidence.evidence.evidence_id,
      ...runtimeEvidence.evidence.evidence_links,
    ]),
    limitations: uniqueSorted([
      ...staticEvidence.evidence.limitations,
      ...selectedLimitations,
      ...runtimeEvidence.evidence.limitations,
      ...process.limitations,
      "This correlation tests an explicit hypothesis and does not establish causality.",
      "Side alignment is caller-declared and was not independently validated against source subjects or environments.",
    ]),
  });
};

const selectStatic = (
  comparison: StaticComparison,
  selector: z.infer<typeof staticSelectorSchema>,
  input: unknown,
  path: readonly (string | number)[],
): Pick<CorrelationItem["static"], "status" | "conclusion_kind"> & {
  readonly limitations: readonly string[];
} => {
  if (selector.kind === "function") {
    if (comparison.operation !== "compare_functions")
      throw callerInputError(
        input,
        path,
        "Function selector requires function comparison Evidence",
      );
    const result = comparison.result;
    const match = result.dimensions.find(
      ({ dimension }) => dimension === selector.dimension,
    );
    if (match === undefined)
      throw evidenceIntegrityError("Function comparison dimension missing");
    return {
      status: match.status,
      conclusion_kind: match.conclusion_kind,
      limitations: match.limitations,
    };
  }
  if (comparison.operation !== "compare_artifacts")
    throw callerInputError(
      input,
      path,
      "Artifact selector requires artifact comparison Evidence",
    );
  const result = comparison.result;
  const matches = result.changes.filter(
    ({ logical_path: path }) => path === selector.logical_path,
  );
  const match = matches.at(0);
  if (matches.length !== 1 || match === undefined)
    throw callerInputError(
      input,
      path,
      "Artifact selector must resolve exactly one reported delta",
    );
  const status = match.classification;
  return {
    status,
    limitations: [],
    conclusion_kind:
      status === "contradiction"
        ? "contradiction"
        : status === "unknown"
          ? "unresolved_branch"
          : "derived_relationship",
  };
};

const parseStatic = (
  raw: unknown,
  fullInput: unknown,
  index: number,
): StaticComparison => {
  const parsed = readEvidence(raw);
  if (!parsed.ok) throw parsed.error;
  const evidence = parsed.value;
  if (
    evidence.operation !== "compare_artifacts" &&
    evidence.operation !== "compare_functions"
  )
    throw callerInputError(
      fullInput,
      ["static_comparisons", index],
      "Static/runtime correlation requires artifact or function comparison Evidence",
    );
  assertComparisonIdentity(evidence);
  const result = readComparisonResult(evidence, evidence.operation);
  if (!result.ok) throw result.error;
  return result.value;
};

const parseRuntime = (
  raw: unknown,
  fullInput: unknown,
  index: number,
): RuntimeComparison => {
  const parsed = readEvidence(raw);
  if (!parsed.ok) throw parsed.error;
  const evidence = parsed.value;
  if (evidence.operation !== "compare_process_captures")
    throw callerInputError(
      fullInput,
      ["runtime_comparisons", index],
      "Static/runtime correlation requires process comparison Evidence",
    );
  assertComparisonIdentity(evidence);
  const result = readComparisonResult(evidence, evidence.operation);
  if (!result.ok) throw result.error;
  return result.value;
};

const assertComparisonIdentity = (evidence: Evidence): void => {
  if (!hasComparisonEvidenceIdentity(evidence))
    throw evidenceIntegrityError(
      "Comparison Evidence operation, predicate, provider, or citations disagree",
    );
  const expectedLinks = comparisonSourceEvidenceIds(evidence);
  const actualLinks = uniqueSorted(evidence.evidence_links);
  if (
    expectedLinks.length !== actualLinks.length ||
    expectedLinks.some((id, index) => id !== actualLinks[index])
  )
    throw evidenceIntegrityError(
      "Comparison Evidence closure disagrees with its source parameters",
    );
};

const observedPattern = (
  staticFinding: Pick<CorrelationItem["static"], "status" | "conclusion_kind">,
  runtimeStatus: ComparisonStatus,
): z.infer<typeof observedPatternSchema> => {
  const staticStatus = staticFinding.status;
  if (staticStatus === "truncated" || runtimeStatus === "truncated")
    return "truncated";
  if (
    staticStatus === "unknown" ||
    runtimeStatus === "unknown" ||
    staticFinding.conclusion_kind !== "derived_relationship" ||
    runtimeStatus === "contradiction"
  )
    return "unknown";
  const staticChanged = staticStatus !== "unchanged";
  const runtimeChanged = runtimeStatus !== "unchanged";
  if (staticChanged && runtimeChanged) return "cochanged";
  if (staticChanged) return "static_only";
  if (runtimeChanged) return "runtime_only";
  return "both_unchanged";
};

const required = <Comparison>(
  values: ReadonlyMap<string, Comparison>,
  id: string,
  label: string,
  input: unknown,
  path: readonly (string | number)[],
): Comparison => {
  const value = values.get(id);
  if (value === undefined)
    throw callerInputError(
      input,
      path,
      `Mapping references absent ${label} Evidence`,
    );
  return value;
};

const byId = <Comparison extends StaticComparison | RuntimeComparison>(
  comparisons: readonly Comparison[],
): Map<string, Comparison> =>
  new Map(comparisons.map((item) => [item.evidence.evidence_id, item]));

const assertUnique = (
  values: readonly string[],
  input: unknown,
  path: readonly (string | number)[],
  message: string,
): void => {
  const duplicateIndex = firstDuplicateIndex(values);
  if (duplicateIndex !== undefined)
    throw callerInputError(input, [...path, duplicateIndex], message);
};

const firstDuplicateIndex = (values: readonly string[]): number | undefined => {
  const seen = new Set<string>();
  const index = values.findIndex((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  });
  return index < 0 ? undefined : index;
};

const OPERATION = "correlate_static_and_runtime";

const callerInputError = (
  input: unknown,
  path: readonly (string | number)[],
  message: string,
): AnalysisInputError =>
  analysisInputErrorFromIssues(OPERATION, [], input, {
    userMessage: message,
    additionalIssues: [{ path, reason: "invalid_value", message }],
  });

const evidenceIntegrityError = (message: string): EvidenceIntegrityError =>
  new EvidenceIntegrityError(message, { userMessage: message });
