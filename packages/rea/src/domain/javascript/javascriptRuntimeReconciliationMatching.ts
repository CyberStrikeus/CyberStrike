import { createJavaScriptApplicationEdge } from "./javascriptApplicationGraph.js";
import type { ApplicationEdge } from "./javascriptApplicationGraphSchemas.js";
import type { ApplicationGraphEvidence } from "./javascriptApplicationEvidenceSchemas.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import type { ParsedStaticLayer } from "./javascriptRuntimeReconciliationParsing.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import type { JavaScriptRuntimeReconciliationItem } from "./javascriptRuntimeReconciliationSchemas.js";
import type { RuntimeReconciliationEntity } from "./javascriptRuntimeReconciliationRuntime.js";
import {
  mappedRuntimePaths,
  type MappedRuntimePath,
  type StaticRuntimeCandidate,
} from "./javascriptRuntimeStaticCandidates.js";

export interface RuntimeMatchingProjection {
  readonly items: readonly JavaScriptRuntimeReconciliationItem[];
  readonly edges: readonly ApplicationEdge[];
  readonly omittedItems: number;
}

/** Match runtime entities conservatively and emit only inferred observed_as edges. */
export const reconcileRuntimeEntities = (input: {
  readonly entities: readonly RuntimeReconciliationEntity[];
  readonly candidates: readonly StaticRuntimeCandidate[];
  readonly layers: readonly ParsedStaticLayer[];
}): RuntimeMatchingProjection => {
  const index = indexCandidates(input.candidates);
  const evaluated = input.entities.map((entity) =>
    reconcileEntity(entity, index, input.layers),
  );
  const retained = evaluated.sort((left, right) =>
    compareUnicodeCodePoints(
      left.item.reconciliation_id,
      right.item.reconciliation_id,
    ),
  );
  return {
    items: retained.map(({ item }) => item),
    edges: retained.flatMap(({ edge }) => (edge === null ? [] : [edge])),
    omittedItems: 0,
  };
};

interface EvaluatedMatch {
  readonly item: JavaScriptRuntimeReconciliationItem;
  readonly edge: ApplicationEdge | null;
}

interface CandidateIndex {
  readonly containingAssets: ReadonlyMap<string, ReadonlySet<string>>;
  readonly byCategoryDigest: ReadonlyMap<
    string,
    readonly StaticRuntimeCandidate[]
  >;
  readonly byNativeDeclarationPath: ReadonlyMap<
    string,
    readonly {
      readonly candidate: StaticRuntimeCandidate;
      readonly sourcePath: string | null;
    }[]
  >;
  readonly byLayerCategoryPath: ReadonlyMap<
    string,
    readonly StaticRuntimeCandidate[]
  >;
}

const reconcileEntity = (
  entity: RuntimeReconciliationEntity,
  index: CandidateIndex,
  layers: readonly ParsedStaticLayer[],
): EvaluatedMatch => {
  if (entity.location.kind === "unresolved")
    return unresolved(entity, {
      status: "unknown",
      basis: "none",
      confidence: "unknown",
      reason: "runtime-location-unresolved",
      candidates: [],
    });
  const { locations, mapped } = locateEntity(entity, index, layers);
  if (entity.sourceSha256 !== null)
    return reconcileCapturedSource(entity, entity.sourceSha256, {
      locations,
      mapped,
      index,
    });

  // A factory's containing-file path is not a separate script location. Only
  // suppress it when a located asset in the same layer is proven to contain it.
  const locatedAssets = new Set(
    locations.flatMap(({ candidate, mapping }) =>
      candidate.node.kind === "javascript-asset"
        ? [
            JSON.stringify([
              candidate.layer.layerId,
              mapping.path,
              candidate.node.node_id,
            ]),
          ]
        : [],
    ),
  );
  const wholeFileLocations = locations.filter(({ candidate, mapping }) => {
    if (candidate.node.kind !== "javascript-module") return true;
    const assets = index.containingAssets.get(candidateKey(candidate));
    return ![...(assets ?? [])].some((asset) =>
      locatedAssets.has(
        JSON.stringify([candidate.layer.layerId, mapping.path, asset]),
      ),
    );
  });
  const location = wholeFileLocations.at(0);
  if (wholeFileLocations.length === 1 && location !== undefined) {
    const located = location;
    return matched(entity, located.candidate, {
      basis: located.mapping.basis,
      confidence: "medium",
      reason: "unique-location-match",
    });
  }
  if (wholeFileLocations.length > 1)
    return unresolved(entity, {
      status: "ambiguous",
      basis: strongestLocationBasis(wholeFileLocations),
      confidence: "unknown",
      reason: "ambiguous-static-candidates",
      candidates: wholeFileLocations.map(({ candidate }) => candidate),
    });
  return withoutStaticCandidate(entity, mapped, "unknown");
};

/**
 * Classify an entity with no qualifying static candidate. Absence is claimed
 * only beneath an automatic or caller-declared mapping; without one, the
 * runtime location has no authorized static counterpart and stays unknown.
 * Captured bytes compared against every static digest support a high-confidence
 * absence; a location-only absence does not.
 */
const withoutStaticCandidate = (
  entity: RuntimeReconciliationEntity,
  mapped: boolean,
  absenceConfidence: JavaScriptRuntimeReconciliationItem["confidence"],
): EvaluatedMatch =>
  unresolved(
    entity,
    mapped
      ? {
          status: "unmatched",
          basis: "none",
          confidence: absenceConfidence,
          reason: "no-static-content-match",
          candidates: [],
        }
      : {
          status: "unknown",
          basis: "none",
          confidence: "unknown",
          reason: "no-authorized-location-mapping",
          candidates: [],
        },
  );

interface LocatedCandidate {
  readonly candidate: StaticRuntimeCandidate;
  readonly mapping: MappedRuntimePath;
}

const reconcileCapturedSource = (
  entity: RuntimeReconciliationEntity,
  sourceSha256: string,
  {
    locations,
    mapped,
    index,
  }: {
    readonly locations: readonly LocatedCandidate[];
    readonly mapped: boolean;
    readonly index: CandidateIndex;
  },
): EvaluatedMatch => {
  // A known mapped candidate owns the comparison. Unrelated equal bytes cannot
  // repair a disagreement or establish the content of a candidate without a digest.
  const content =
    locations.length > 0
      ? locations
          .map(({ candidate }) => candidate)
          .filter(({ digests }) =>
            digests.some(({ sha256 }) => sha256 === sourceSha256),
          )
      : (index.byCategoryDigest.get(
          categoryDigestKey(entity.staticKind, sourceSha256),
        ) ?? []);
  const candidate = content.at(0);
  if (content.length === 1 && candidate !== undefined)
    return matched(entity, candidate, {
      basis:
        locations.length > 0
          ? "content-and-location"
          : (candidate.digests.find(({ sha256 }) => sha256 === sourceSha256)
              ?.basis ?? "content-sha256"),
      confidence: "high",
      reason:
        locations.length > 0
          ? "content-and-location-match"
          : "unique-content-match",
    });
  if (content.length > 1)
    return unresolved(entity, {
      status: "ambiguous",
      basis: locations.length > 0 ? "content-and-location" : "none",
      confidence: "unknown",
      reason: "ambiguous-static-candidates",
      candidates: content,
    });
  if (locations.length > 0) {
    const digestUnavailable = locations.some(
      ({ candidate: { digests } }) => digests.length === 0,
    );
    return unresolved(entity, {
      status: digestUnavailable ? "unknown" : "unmatched",
      basis: strongestLocationBasis(locations),
      confidence: digestUnavailable ? "unknown" : "high",
      reason: digestUnavailable
        ? "static-or-runtime-coverage-incomplete"
        : "captured-content-disagrees-with-static-location",
      candidates: locations.map(({ candidate: located }) => located),
    });
  }
  return withoutStaticCandidate(entity, mapped, "high");
};

const locateEntity = (
  entity: RuntimeReconciliationEntity,
  index: CandidateIndex,
  layers: readonly ParsedStaticLayer[],
): { readonly locations: LocatedCandidate[]; readonly mapped: boolean } => {
  const located = new Map<string, LocatedCandidate>();
  let mapped = false;
  for (const layer of layers)
    for (const mapping of mappedRuntimePaths(layer, entity)) {
      mapped = true;
      for (const candidate of [
        ...(index.byLayerCategoryPath.get(
          layerCategoryPathKey(layer.layerId, entity.staticKind, mapping.path),
        ) ?? []),
        ...(mapping.fileStyle === null || mapping.nativeRelativePath === null
          ? []
          : (
              index.byNativeDeclarationPath.get(
                `${mapping.fileStyle}\0${layerCategoryPathKey(layer.layerId, entity.staticKind, mapping.nativeRelativePath)}`,
              ) ?? []
            )
              .filter(
                ({ sourcePath }) =>
                  mapping.artifactPrefix === "" ||
                  (sourcePath !== null &&
                    sourcePath.startsWith(`${mapping.artifactPrefix}/`)),
              )
              .map(({ candidate }) => candidate)),
      ]) {
        const key = candidateKey(candidate);
        if (!located.has(key)) located.set(key, { candidate, mapping });
      }
    }
  return {
    locations: [...located.values()].sort((left, right) =>
      compareUnicodeCodePoints(
        candidateKey(left.candidate),
        candidateKey(right.candidate),
      ),
    ),
    mapped,
  };
};

const indexCandidates = (
  candidates: readonly StaticRuntimeCandidate[],
): CandidateIndex => {
  const byCategoryDigest = new Map<string, StaticRuntimeCandidate[]>();
  const byLayerCategoryPath = new Map<string, StaticRuntimeCandidate[]>();
  const byNativeDeclarationPath = new Map<
    string,
    { candidate: StaticRuntimeCandidate; sourcePath: string | null }[]
  >();
  for (const candidate of candidates) {
    for (const { sha256 } of candidate.digests)
      appendIndex(
        byCategoryDigest,
        categoryDigestKey(candidate.category, sha256),
        candidate,
      );
    for (const path of candidate.paths)
      appendIndex(
        byLayerCategoryPath,
        layerCategoryPathKey(candidate.layer.layerId, candidate.category, path),
        candidate,
      );
    for (const style of ["posix", "windows"] as const)
      for (const { path, sourcePath } of candidate.nativeDeclarationPaths[
        style
      ])
        appendIndex(
          byNativeDeclarationPath,
          `${style}\0${layerCategoryPathKey(candidate.layer.layerId, candidate.category, path)}`,
          { candidate, sourcePath },
        );
  }
  return {
    byCategoryDigest,
    byLayerCategoryPath,
    byNativeDeclarationPath,
    containingAssets: indexContainingAssets(candidates),
  };
};

/** Index the producer's asset -> chunk -> module containment facts once. */
const indexContainingAssets = (
  candidates: readonly StaticRuntimeCandidate[],
): ReadonlyMap<string, ReadonlySet<string>> => {
  const layers = new Map(candidates.map(({ layer }) => [layer.layerId, layer]));
  const result = new Map<string, Set<string>>();
  for (const layer of layers.values()) {
    const nodes = new Map(
      layer.graph.nodes.map((node) => [node.node_id, node]),
    );
    const chunks = new Map<string, Set<string>>();
    for (const edge of layer.graph.edges) {
      if (edge.relation !== "contains") continue;
      const source = nodes.get(edge.source_node_id);
      const target = nodes.get(edge.target_node_id);
      if (source?.kind !== "javascript-asset" || target === undefined) continue;
      if (target.kind === "javascript-chunk") {
        const assets = chunks.get(target.node_id) ?? new Set<string>();
        assets.add(source.node_id);
        chunks.set(target.node_id, assets);
      } else if (target.kind === "javascript-module") {
        const key = `${layer.layerId}:${target.node_id}`;
        const assets = result.get(key) ?? new Set<string>();
        assets.add(source.node_id);
        result.set(key, assets);
      }
    }
    for (const edge of layer.graph.edges) {
      if (edge.relation !== "contains") continue;
      const assets = chunks.get(edge.source_node_id);
      const target = nodes.get(edge.target_node_id);
      if (assets === undefined || target?.kind !== "javascript-module")
        continue;
      const key = `${layer.layerId}:${target.node_id}`;
      const existing = result.get(key) ?? new Set<string>();
      for (const asset of assets) existing.add(asset);
      result.set(key, existing);
    }
  }
  return result;
};

const appendIndex = <Value>(
  index: Map<string, Value[]>,
  key: string,
  candidate: Value,
): void => {
  const values = index.get(key);
  if (values === undefined) index.set(key, [candidate]);
  else values.push(candidate);
};

const categoryDigestKey = (category: string, digest: string): string =>
  `${category}\0${digest}`;

const layerCategoryPathKey = (
  layerId: string,
  category: string,
  path: string,
): string => `${layerId}\0${category}\0${path}`;

const matched = (
  entity: RuntimeReconciliationEntity,
  candidate: StaticRuntimeCandidate,
  input: Pick<ItemInput, "basis" | "confidence" | "reason">,
): EvaluatedMatch => {
  const item = createItem(entity, {
    layer: candidate.layer,
    staticNodeId: candidate.node.node_id,
    status: "matched",
    basis: input.basis,
    confidence: input.confidence,
    reason: input.reason,
    candidates: [candidate],
  });
  return {
    item,
    edge: createJavaScriptApplicationEdge({
      source_node_id: candidate.node.node_id,
      target_node_id: entity.node.node_id,
      relation: "observed_as",
      properties: {
        reconciliation_id: item.reconciliation_id,
        basis: input.basis,
        static_layer_id: candidate.layer.layerId,
      },
      evidence: reconciliationEvidence(
        entity,
        candidate.layer,
        input.basis,
        input.confidence,
      ),
    }),
  };
};

const unresolved = (
  entity: RuntimeReconciliationEntity,
  input: Pick<ItemInput, "basis" | "confidence" | "reason" | "candidates"> & {
    readonly status: Exclude<
      JavaScriptRuntimeReconciliationItem["status"],
      "matched"
    >;
  },
): EvaluatedMatch => ({
  item: createItem(entity, {
    layer: null,
    staticNodeId: null,
    status: input.status,
    basis: input.basis,
    confidence: input.confidence,
    reason: input.reason,
    candidates: input.candidates,
  }),
  edge: null,
});

type ItemInput = {
  readonly basis: JavaScriptRuntimeReconciliationItem["basis"];
  readonly confidence: JavaScriptRuntimeReconciliationItem["confidence"];
  readonly reason: JavaScriptRuntimeReconciliationItem["reason"];
  readonly candidates: readonly StaticRuntimeCandidate[];
} & (
  | {
      readonly layer: ParsedStaticLayer;
      readonly staticNodeId: string;
      readonly status: "matched";
    }
  | {
      readonly layer: null;
      readonly staticNodeId: null;
      readonly status: Exclude<
        JavaScriptRuntimeReconciliationItem["status"],
        "matched"
      >;
    }
);

const createItem = (
  entity: RuntimeReconciliationEntity,
  input: ItemInput,
): JavaScriptRuntimeReconciliationItem => {
  const candidateReferences = uniqueCandidateReferences(input.candidates);
  const staticMatch =
    input.status === "matched"
      ? {
          static_layer_id: input.layer.layerId,
          static_node_id: input.staticNodeId,
          status: input.status,
        }
      : {
          static_layer_id: null,
          static_node_id: null,
          status: input.status,
        };
  const semantic = {
    entity_kind: entity.kind,
    runtime_evidence_id: entity.capture.evidence.evidence_id,
    runtime_node_id: entity.node.node_id,
    ...staticMatch,
    basis: input.basis,
    confidence: input.confidence,
    reason: input.reason,
    candidate_static_count: candidateReferences.count,
    candidate_static_nodes: candidateReferences.items,
  } satisfies Omit<JavaScriptRuntimeReconciliationItem, "reconciliation_id">;
  return {
    reconciliation_id: `jrr_item_${digestCanonicalValue(semantic, "Runtime reconciliation")}`,
    ...semantic,
  };
};

const reconciliationEvidence = (
  entity: RuntimeReconciliationEntity,
  layer: ParsedStaticLayer,
  basis: JavaScriptRuntimeReconciliationItem["basis"],
  confidence: JavaScriptRuntimeReconciliationItem["confidence"],
): ApplicationGraphEvidence => {
  const observation = entity.node.observations.at(0);
  if (observation === undefined)
    throw new TypeError("Runtime reconciliation entity has no observation");
  return {
    authority: "cross-layer-reconciliation",
    state: "inferred",
    confidence: confidence === "medium" ? "medium" : "high",
    artifact:
      entity.sourceSha256 === null
        ? {
            available: false,
            reason: "not-observed",
            detail: "Runtime source bytes were not captured for this mapping.",
          }
        : {
            available: true,
            artifact_id: `art_${entity.sourceSha256}`,
            sha256: entity.sourceSha256,
          },
    location: observation.evidence.location,
    extractor: {
      name: "rea-javascript-runtime-reconciliation",
      version: "1",
      operation: "reconcile_javascript_runtime",
      executable_sha256: null,
    },
    coverage:
      layer.graph.coverage.status === "complete" &&
      entity.capture.scriptsCompleteWithinScope
        ? { status: "complete", truncated: false, omitted_count: 0, limits: [] }
        : {
            status: "partial",
            truncated: false,
            omitted_count: null,
            limits: [],
          },
    limitations: [
      basis === "content-sha256" ||
      basis === "module-source-sha256" ||
      basis === "content-and-location"
        ? "Equal content digests establish byte identity, not execution causality."
        : "Location correspondence is inferred from an artifact root or caller-declared mapping.",
      "Passive script parsing or target presence does not prove feature execution.",
    ],
    evidence_ids: [
      layer.evidence.evidence_id,
      entity.capture.evidence.evidence_id,
    ].sort(),
  };
};

const strongestLocationBasis = (
  values: readonly LocatedCandidate[],
): JavaScriptRuntimeReconciliationItem["basis"] => {
  const bases = new Set(values.map(({ mapping }) => mapping.basis));
  if (bases.has("artifact-path")) return "artifact-path";
  if (bases.has("operator-file-mapping")) return "operator-file-mapping";
  return "operator-url-mapping";
};

const candidateKey = (candidate: StaticRuntimeCandidate): string =>
  `${candidate.layer.layerId}:${candidate.node.node_id}`;

const uniqueCandidateReferences = (
  candidates: readonly StaticRuntimeCandidate[],
): {
  readonly count: number;
  readonly items: JavaScriptRuntimeReconciliationItem["candidate_static_nodes"];
} => {
  const seen = new Set<string>();
  let count = 0;
  const items: JavaScriptRuntimeReconciliationItem["candidate_static_nodes"] =
    [];
  for (const { layer, node } of candidates) {
    const key = `${layer.layerId}:${node.node_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    count += 1;
    items.push({
      static_layer_id: layer.layerId,
      static_node_id: node.node_id,
    });
  }
  return { count, items };
};
