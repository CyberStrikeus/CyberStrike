import { uniqueSorted } from "../canonicalOrdering.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import { absenceClaimable } from "../comparisonSemantics.js";
import { digestCanonicalValue } from "../canonicalDigest.js";

import type { JavaScriptApplicationGraph } from "./javascriptApplicationGraph.js";
import type { HistoricalSourceGraph } from "../referenceSourceGraph.js";
import {
  SOURCE_TO_BUNDLE_SIGNAL_WEIGHTS,
  sourceToBundleComparisonResultSchema,
  type SourceToBundleCandidate,
  type SourceToBundleComparisonItem,
  type SourceToBundleComparisonResult,
} from "./sourceToBundleComparisonSchemas.js";
import {
  buildSourceToBundleCandidateIndex,
  candidateHasDigest,
  candidateIdsForSource,
  historicalSourceFiles,
  scoreSourceToBundleCandidate,
  sourceBearingNodes,
  sourceToBundleCandidateIdentity,
  type SourceToBundleCandidateIndex,
} from "./sourceToBundleSignals.js";

interface SourceToBundleComparisonInput {
  readonly reference: HistoricalSourceGraph;
  readonly application: {
    readonly evidenceId: string;
    readonly rootArtifactSha256: string;
    readonly graph: JavaScriptApplicationGraph;
  };
}

interface ClassifiedMapping {
  readonly status: SourceToBundleComparisonItem["status"];
  readonly confidence: SourceToBundleComparisonItem["confidence"];
  readonly currentNodeIds: string[];
  readonly limitations: string[];
}

interface ComparisonProjection {
  readonly sources: ReturnType<typeof historicalSourceFiles>;
  readonly currentNodes: ReturnType<typeof sourceBearingNodes>;
  readonly index: SourceToBundleCandidateIndex;
  readonly absenceComplete: boolean;
  readonly factors: CoverageFactors;
}

interface MappingProjection {
  readonly items: SourceToBundleComparisonItem[];
  readonly candidateEvaluations: number;
}

/** Compare historical source files to static source-bearing application nodes. */
export const compareSourceToBundle = (
  input: SourceToBundleComparisonInput,
): SourceToBundleComparisonResult => {
  const projection = projectComparison(input);
  const mappings = compareMappings(input, projection);
  const factors = {
    ...projection.factors,
  };
  const mappedCurrentIds = new Set(
    mappings.items.flatMap(({ current_node_ids: nodeIds, candidates }) => [
      ...nodeIds,
      ...candidates
        .filter((candidate) => nodeIds.includes(candidate.current_node_id))
        .flatMap((candidate) => candidate.representation_node_ids ?? []),
    ]),
  );
  const unmappedCurrentNodeIds = projection.currentNodes
    .map(({ node_id: nodeId }) => nodeId)
    .filter((nodeId) => !mappedCurrentIds.has(nodeId));
  const semanticResult = {
    reference: {
      root_sha256: input.reference.root_sha256,
      inventory_state: input.reference.inventory_state,
    },
    application: {
      evidence_id: input.application.evidenceId,
      graph_id: input.application.graph.graph_id,
      root_artifact_sha256: input.application.rootArtifactSha256,
    },
    scoring: scoringModel(),
    summary: comparisonSummary(mappings.items),
    items: mappings.items,
    unmapped_current_node_ids: unmappedCurrentNodeIds,
    coverage: comparisonCoverage(projection, mappings, factors),
    evidence_links: [input.application.evidenceId],
    limitations: comparisonLimitations(factors),
  };
  return sourceToBundleComparisonResultSchema.parse({
    ...semanticResult,
    comparison_id: `stbc_${digestCanonicalValue(semanticResult, "Source-to-bundle comparison")}`,
  });
};

const projectComparison = (
  input: SourceToBundleComparisonInput,
): ComparisonProjection => {
  const allSources = historicalSourceFiles(input.reference);
  const allCurrentNodes = sourceBearingNodes(input.application.graph.nodes);
  const sources = allSources;
  const currentNodes = allCurrentNodes;
  const index = buildSourceToBundleCandidateIndex(currentNodes);
  return {
    sources,
    currentNodes,
    index,
    absenceComplete:
      input.reference.inventory_state === "complete" &&
      absenceClaimable(input.application.graph.coverage),
    factors: {
      input,
    },
  };
};

const compareMappings = (
  input: SourceToBundleComparisonInput,
  projection: ComparisonProjection,
): MappingProjection => {
  let candidateEvaluations = 0;
  const provisionalItems: SourceToBundleComparisonItem[] = [];
  for (const source of projection.sources) {
    const candidateIds = candidateIdsForSource(source, projection.index);
    candidateEvaluations += candidateIds.length;
    const scored = candidateIds
      .map((nodeId) =>
        scoreSourceToBundleCandidate(source, nodeId, projection.index),
      )
      .filter(
        (candidate): candidate is SourceToBundleCandidate => candidate !== null,
      )
      .sort(compareCandidates);
    const classification = classifyMapping(
      scored,
      projection.absenceComplete,
      (candidate) =>
        source.sha256 !== null &&
        candidateHasDigest(projection.index, candidate),
    );
    const semantic = {
      source_path: source.path,
      source_sha256: source.sha256,
      source_language: source.language,
      status: classification.status,
      confidence: classification.confidence,
      current_node_ids: classification.currentNodeIds,
      candidates: scored,
      limitations: uniqueSorted([
        ...source.limitations,
        ...classification.limitations,
      ]),
    };
    provisionalItems.push({
      mapping_id: mappingId(input, semantic),
      ...semantic,
    });
  }
  return {
    items: markMergedMappings(input, provisionalItems),
    candidateEvaluations,
  };
};

const comparisonCoverage = (
  projection: ComparisonProjection,
  mappings: MappingProjection,
  factors: CoverageFactors,
): SourceToBundleComparisonResult["coverage"] => ({
  status: coverageStatus(factors),
  reference_inventory_state: factors.input.reference.inventory_state,
  application_graph_status: factors.input.application.graph.coverage.status,
  retained_source_files: projection.sources.length,
  retained_application_nodes: projection.currentNodes.length,
  candidate_evaluations: mappings.candidateEvaluations,
});

const scoringModel = (): SourceToBundleComparisonResult["scoring"] => ({
  algorithm: "rea-source-to-bundle-signals",
  minimum_candidate_score: 20,
  weights: SOURCE_TO_BUNDLE_SIGNAL_WEIGHTS.map(([signal, weight]) => ({
    signal,
    weight,
  })),
});

const classifyMapping = (
  candidates: readonly SourceToBundleCandidate[],
  absenceComplete: boolean,
  digestComparable: (candidate: SourceToBundleCandidate) => boolean,
): ClassifiedMapping => {
  const exact = candidates.filter((candidate) =>
    hasSignal(candidate, "exact-source-digest"),
  );
  if (exact.length === 1)
    return {
      status: "unchanged",
      confidence: "exact",
      currentNodeIds: [exact[0]?.current_node_id ?? ""].filter(Boolean),
      limitations: [
        "Exact byte identity does not establish equivalent load context or runtime behavior.",
      ],
    };
  if (exact.length > 1)
    return {
      status: "duplicated",
      confidence: "exact",
      currentNodeIds: uniqueSorted(
        exact.map(({ current_node_id: nodeId }) => nodeId),
      ),
      limitations: [
        "The same historical source digest occurs in multiple current source occurrences.",
      ],
    };
  const pathCandidates = candidates.filter((candidate) =>
    candidate.signals.some(({ kind }) =>
      [
        "source-map-original-path",
        "current-path-exact",
        "current-path-suffix",
      ].includes(kind),
    ),
  );
  const topScore = pathCandidates[0]?.score;
  const topPathCandidates =
    topScore === undefined
      ? []
      : pathCandidates.filter(({ score }) => score === topScore);
  if (topPathCandidates.length === 1) {
    const candidate = topPathCandidates[0];
    if (candidate !== undefined && digestComparable(candidate))
      return {
        status: "modified",
        confidence: candidate.confidence === "high" ? "high" : "medium",
        currentNodeIds: [candidate.current_node_id],
        limitations: [
          "Location evidence links the source to the current node, but their source digests differ.",
        ],
      };
    return {
      status: "unknown",
      confidence: "unknown",
      currentNodeIds:
        candidate === undefined ? [] : [candidate.current_node_id],
      limitations: [
        "Location evidence links the source to the current node, but comparable source digests are unavailable.",
      ],
    };
  }
  if (topPathCandidates.length > 1)
    return {
      status: "split",
      confidence: "medium",
      currentNodeIds: uniqueSorted(
        topPathCandidates.map(({ current_node_id: nodeId }) => nodeId),
      ),
      limitations: [
        "Multiple equally scored current source occurrences retain the historical source path; this is a static split inference, not runtime proof.",
      ],
    };
  if (candidates.length > 0)
    return {
      status: "unknown",
      confidence: "unknown",
      currentNodeIds: [],
      limitations: [
        candidates.some((candidate) =>
          hasSignal(candidate, "unicode-equivalent-path"),
        )
          ? "Unicode-equivalent paths are inferred candidates only; filesystem paths with distinct Unicode spellings may identify different files, so no mapping was forced."
          : "Only weak basename or extension signals were available; no mapping was forced.",
      ],
    };
  return absenceComplete
    ? {
        status: "removed",
        confidence: "high",
        currentNodeIds: [],
        limitations: [
          "No retained current node matched exact digest or path signals within complete static inventories.",
        ],
      }
    : {
        status: "unknown",
        confidence: "unknown",
        currentNodeIds: [],
        limitations: [
          "No candidate was observed, but incomplete input or graph coverage prevents a removal claim.",
        ],
      };
};

const markMergedMappings = (
  input: SourceToBundleComparisonInput,
  items: readonly SourceToBundleComparisonItem[],
): SourceToBundleComparisonItem[] => {
  const sourcesByNode = new Map<string, SourceToBundleComparisonItem[]>();
  for (const item of items) {
    if (item.status !== "unchanged" || item.current_node_ids.length !== 1)
      continue;
    const nodeId = item.current_node_ids[0];
    const candidate = item.candidates.find(
      (candidate) => candidate.current_node_id === nodeId,
    );
    if (candidate === undefined) continue;
    const key = sourceToBundleCandidateIdentity(candidate);
    sourcesByNode.set(key, [...(sourcesByNode.get(key) ?? []), item]);
  }
  const mergedSources = new Set(
    [...sourcesByNode.values()]
      .filter((group) => group.length > 1)
      .flatMap((group) => group.map(({ source_path: path }) => path)),
  );
  return items.map((item) => {
    if (!mergedSources.has(item.source_path)) return item;
    const { mapping_id: previousMappingId, ...base } = item;
    void previousMappingId;
    const semantic = {
      ...base,
      status: "merged" as const,
      confidence: "exact" as const,
      limitations: uniqueSorted([
        ...item.limitations,
        "Multiple historical source paths have exact digest identity with the same current source occurrence.",
      ]),
    };
    return { ...semantic, mapping_id: mappingId(input, semantic) };
  });
};

const mappingId = (
  input: SourceToBundleComparisonInput,
  item: Omit<SourceToBundleComparisonItem, "mapping_id">,
): string =>
  `stbc_item_${digestCanonicalValue(
    {
      reference_root_sha256: input.reference.root_sha256,
      application_graph_id: input.application.graph.graph_id,
      ...item,
    },
    "Source-to-bundle comparison",
  )}`;

const comparisonSummary = (
  items: readonly SourceToBundleComparisonItem[],
): SourceToBundleComparisonResult["summary"] => ({
  unchanged: countStatus(items, "unchanged"),
  modified: countStatus(items, "modified"),
  removed: countStatus(items, "removed"),
  split: countStatus(items, "split"),
  merged: countStatus(items, "merged"),
  duplicated: countStatus(items, "duplicated"),
  unknown: countStatus(items, "unknown"),
});

const countStatus = (
  items: readonly SourceToBundleComparisonItem[],
  status: SourceToBundleComparisonItem["status"],
): number => items.filter((item) => item.status === status).length;

interface CoverageFactors {
  readonly input: SourceToBundleComparisonInput;
}

const coverageStatus = (
  factors: CoverageFactors,
): SourceToBundleComparisonResult["coverage"]["status"] => {
  return factors.input.reference.inventory_state === "complete" &&
    factors.input.application.graph.coverage.status === "complete"
    ? "complete-within-inputs"
    : "partial";
};

const comparisonLimitations = (factors: CoverageFactors): string[] =>
  uniqueSorted([
    "Static digest and location signals do not establish runtime behavior, semantic equivalence, or absence of dynamically generated modules.",
    ...factors.input.reference.limitations,
    ...factors.input.application.graph.limitations,
    ...(factors.input.reference.inventory_state === "complete"
      ? []
      : [
          `Historical source inventory is ${factors.input.reference.inventory_state}; unmatched files remain unknown.`,
        ]),
    ...(factors.input.application.graph.coverage.status === "complete"
      ? []
      : [
          `Application graph coverage is ${factors.input.application.graph.coverage.status}; unmatched files remain unknown.`,
        ]),
  ]);

const hasSignal = (
  candidate: SourceToBundleCandidate,
  kind: SourceToBundleCandidate["signals"][number]["kind"],
): boolean => candidate.signals.some((signal) => signal.kind === kind);

const compareCandidates = (
  left: SourceToBundleCandidate,
  right: SourceToBundleCandidate,
): number =>
  right.score - left.score ||
  compareUnicodeCodePoints(
    sourceToBundleCandidateIdentity(left),
    sourceToBundleCandidateIdentity(right),
  );
