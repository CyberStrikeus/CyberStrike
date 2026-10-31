import { absenceClaimable, canonicalJson } from "../comparisonSemantics.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import type { Evidence } from "../evidence.js";
import type {
  ApplicationEdge,
  ApplicationNode,
} from "./javascriptApplicationGraphSchemas.js";
import { IPC_COVERAGE_LIMITED_PAIRING_BASIS } from "./javascriptApplicationGraphSchemas.js";
import type { JavaScriptApplicationGraph } from "./javascriptApplicationGraph.js";
import { javaScriptFileOccurrenceSchema } from "./javascriptArtifactFiles.js";
import { applicationEndpointCorrespondence } from "./javascriptApplicationEndpointCorrespondence.js";
import type { ApplicationVersionComparisonItem } from "./javascriptApplicationVersionComparisonSchemas.js";
import type {
  ApplicationVersionMatchingProjection,
  ApplicationVersionNodePair,
} from "./javascriptApplicationVersionKeys.js";

/** All classified entities and their complete ambiguity candidate sets. */
export interface ApplicationVersionItemProjection {
  readonly items: ApplicationVersionComparisonItem[];
}

interface ItemContext {
  readonly leftGraph: JavaScriptApplicationGraph;
  readonly rightGraph: JavaScriptApplicationGraph;
  readonly leftEvidenceId: string;
  readonly rightEvidenceId: string;
  readonly leftNativeEvidenceByDigest: ReadonlyMap<string, readonly string[]>;
  readonly rightNativeEvidenceByDigest: ReadonlyMap<string, readonly string[]>;
  readonly pairByLeft: ReadonlyMap<string, string>;
  readonly pairByRight: ReadonlyMap<string, string>;
  readonly leftRelationships: RelationshipIndex;
  readonly rightRelationships: RelationshipIndex;
  readonly leftUnresolvedEndpointKinds: ReadonlySet<string | null>;
  readonly rightUnresolvedEndpointKinds: ReadonlySet<string | null>;
}

type ItemContextInput = Omit<
  ItemContext,
  | "leftNativeEvidenceByDigest"
  | "rightNativeEvidenceByDigest"
  | "pairByLeft"
  | "pairByRight"
  | "leftRelationships"
  | "rightRelationships"
  | "leftUnresolvedEndpointKinds"
  | "rightUnresolvedEndpointKinds"
> & {
  readonly leftNativeEvidence: readonly Evidence[];
  readonly rightNativeEvidence: readonly Evidence[];
};

interface IndexedRelationship {
  readonly direction: "in" | "out";
  readonly relation: ApplicationEdge["relation"];
  readonly neighborId: string;
  readonly coverageLimited: boolean;
}

interface RelationshipIndex {
  readonly nodeById: ReadonlyMap<string, ApplicationNode>;
  readonly adjacency: ReadonlyMap<string, readonly IndexedRelationship[]>;
}

type OneSidedNode =
  | {
      readonly left: ApplicationNode;
      readonly right?: never;
      readonly candidateRightNodeIds: readonly string[];
      readonly candidateLeftNodeIds?: never;
    }
  | {
      readonly left?: never;
      readonly right: ApplicationNode;
      readonly candidateRightNodeIds?: never;
      readonly candidateLeftNodeIds: readonly string[];
    };

type ComparisonItemSemantic<
  Item extends ApplicationVersionComparisonItem =
    ApplicationVersionComparisonItem,
> = Item extends ApplicationVersionComparisonItem
  ? Omit<Item, "item_id">
  : never;

/** Classify matched, unmatched, and ambiguous nodes without inventing absence. */
export const classifyJavaScriptApplicationVersions = (
  matching: ApplicationVersionMatchingProjection,
  context: ItemContextInput,
): ApplicationVersionItemProjection => {
  const pairByLeft = new Map(
    matching.pairs.map(({ left, right }) => [
      left.node_id,
      `pair:${left.node_id}:${right.node_id}`,
    ]),
  );
  const pairByRight = new Map(
    matching.pairs.map(({ left, right }) => [
      right.node_id,
      `pair:${left.node_id}:${right.node_id}`,
    ]),
  );
  const fullContext: ItemContext = {
    leftGraph: context.leftGraph,
    rightGraph: context.rightGraph,
    leftEvidenceId: context.leftEvidenceId,
    rightEvidenceId: context.rightEvidenceId,
    leftNativeEvidenceByDigest: indexNativeEvidence(context.leftNativeEvidence),
    rightNativeEvidenceByDigest: indexNativeEvidence(
      context.rightNativeEvidence,
    ),
    pairByLeft,
    pairByRight,
    leftRelationships: indexRelationships(context.leftGraph),
    rightRelationships: indexRelationships(context.rightGraph),
    leftUnresolvedEndpointKinds: unresolvedEndpointKinds(context.leftGraph),
    rightUnresolvedEndpointKinds: unresolvedEndpointKinds(context.rightGraph),
  };
  const leftItems = matching.unmatchedLeft.map((node) => {
    const candidates = matching.candidatesForLeft.get(node.node_id) ?? [];
    return unmatchedItem(
      {
        left: node,
        candidateRightNodeIds: candidates,
      },
      fullContext,
    );
  });
  const rightItems = matching.unmatchedRight.map((node) => {
    const candidates = matching.candidatesForRight.get(node.node_id) ?? [];
    return unmatchedItem(
      {
        right: node,
        candidateLeftNodeIds: candidates,
      },
      fullContext,
    );
  });
  return {
    items: [
      ...matching.pairs.map((pair) => matchedItem(pair, fullContext)),
      ...leftItems,
      ...rightItems,
    ].sort((left, right) =>
      compareUnicodeCodePoints(left.item_id, right.item_id),
    ),
  };
};

const matchedItem = (
  pair: ApplicationVersionNodePair,
  context: ItemContext,
): ApplicationVersionComparisonItem => {
  const relationships = compareRelationships(pair, context);
  const sourceAnalysisUncertain =
    hasUnexaminedSourceFile(pair.left) || hasUnexaminedSourceFile(pair.right);
  const dimensions = changedDimensions(
    pair,
    relationships,
    sourceAnalysisUncertain,
  );
  const complete = graphsComplete(context);
  const ownEvidenceUncertain =
    ownPresenceUncertain(pair.left) || ownPresenceUncertain(pair.right);
  const endpointTargetUncertain =
    unresolvedEndpointTarget(pair.left) || unresolvedEndpointTarget(pair.right);
  const observedChange =
    !ownEvidenceUncertain &&
    (dimensions.includes("content") || dimensions.includes("properties"));
  // Coordinates remain comparison evidence; relocation alone is not a
  // content, property, or relationship change.
  const completeChange =
    !ownEvidenceUncertain &&
    !sourceAnalysisUncertain &&
    complete &&
    dimensions.some((dimension) => dimension !== "location");
  const status: ApplicationVersionComparisonItem["status"] =
    ownEvidenceUncertain
      ? "unknown"
      : observedChange || completeChange
        ? "changed"
        : complete &&
            !relationships.unresolved &&
            !relationships.coverageLimited &&
            !endpointTargetUncertain &&
            !sourceAnalysisUncertain
          ? "unchanged"
          : "unknown";
  const finalDimensions = ownEvidenceUncertain
    ? []
    : status === "unknown" && (!complete || sourceAnalysisUncertain)
      ? [...dimensions, "coverage" as const]
      : dimensions;
  const semantic: ComparisonItemSemantic = {
    status,
    node_kind: pair.left.kind,
    left_node_id: pair.left.node_id,
    right_node_id: pair.right.node_id,
    match: matchedMatch(pair),
    dimensions: finalDimensions,
    evidence_links: itemEvidenceLinks(pair.left, pair.right, context),
    limitations: [
      ...new Set([
        ...ownComparisonLimitations(pair.left),
        ...ownComparisonLimitations(pair.right),
      ]),
      ...matchLimitations(pair),
      ...(sourceAnalysisUncertain
        ? [
            "Source file analysis was not complete on both sides; retained file identity does not establish equality of unexamined facts.",
          ]
        : []),
      ...(status === "unknown" && !complete
        ? [
            "Incomplete graph coverage prevents a complete node-level conclusion.",
          ]
        : []),
      ...(relationships.unresolved
        ? [
            "Relationship target identity remains unresolved; equal node kinds do not establish cross-version alignment.",
          ]
        : []),
      ...(relationships.coverageLimited
        ? [
            "Incomplete source coverage leaves some candidate relationships unconfirmed.",
          ]
        : []),
    ],
  };
  return itemWithId(semantic);
};

const unmatchedItem = (
  member: OneSidedNode,
  context: ItemContext,
): ApplicationVersionComparisonItem =>
  member.left === undefined
    ? rightOnlyItem(member.right, member.candidateLeftNodeIds, context)
    : leftOnlyItem(member.left, member.candidateRightNodeIds, context);

const leftOnlyItem = (
  node: ApplicationNode,
  candidateNodeIds: readonly string[],
  context: ItemContext,
): ApplicationVersionComparisonItem => {
  const [firstCandidate, ...remainingCandidates] = candidateNodeIds;
  const common = {
    node_kind: node.kind,
    evidence_links: itemEvidenceLinks(node, undefined, context),
  };
  if (firstCandidate !== undefined)
    return itemWithId({
      ...common,
      status: "unknown",
      left_node_id: node.node_id,
      right_node_id: null,
      match: {
        status: "ambiguous",
        basis: "none",
        confidence: "unknown",
        candidate_left_node_ids: [],
        candidate_right_node_ids: [firstCandidate, ...remainingCandidates],
      },
      dimensions: ["availability"],
      limitations: [
        ...ownComparisonLimitations(node),
        AMBIGUOUS_MATCH_LIMITATION,
      ],
    });
  if (ownPresenceUncertain(node) || unresolvedEndpointTarget(node))
    return itemWithId({
      ...common,
      status: "unknown",
      left_node_id: node.node_id,
      right_node_id: null,
      match: unmatchedMatch(),
      dimensions: ["availability"],
      limitations: ownComparisonLimitations(node),
    });
  const endpointGap = oppositeEndpointUncertain(
    node,
    context.rightUnresolvedEndpointKinds,
  );
  const absenceObserved =
    !endpointGap && absenceClaimable(context.rightGraph.coverage);
  return itemWithId({
    ...common,
    status: absenceObserved ? "removed" : "unknown",
    left_node_id: node.node_id,
    right_node_id: null,
    match: unmatchedMatch(),
    dimensions:
      absenceObserved || endpointGap
        ? ["availability"]
        : ["availability", "coverage"],
    limitations: [
      ...ownComparisonLimitations(node),
      ...(endpointGap
        ? [ENDPOINT_ABSENCE_LIMITATION]
        : absenceObserved
          ? []
          : [INCOMPLETE_GRAPH_LIMITATION]),
    ],
  });
};

const rightOnlyItem = (
  node: ApplicationNode,
  candidateNodeIds: readonly string[],
  context: ItemContext,
): ApplicationVersionComparisonItem => {
  const [firstCandidate, ...remainingCandidates] = candidateNodeIds;
  const common = {
    node_kind: node.kind,
    evidence_links: itemEvidenceLinks(undefined, node, context),
  };
  if (firstCandidate !== undefined)
    return itemWithId({
      ...common,
      status: "unknown",
      left_node_id: null,
      right_node_id: node.node_id,
      match: {
        status: "ambiguous",
        basis: "none",
        confidence: "unknown",
        candidate_left_node_ids: [firstCandidate, ...remainingCandidates],
        candidate_right_node_ids: [],
      },
      dimensions: ["availability"],
      limitations: [
        ...ownComparisonLimitations(node),
        AMBIGUOUS_MATCH_LIMITATION,
      ],
    });
  if (ownPresenceUncertain(node) || unresolvedEndpointTarget(node))
    return itemWithId({
      ...common,
      status: "unknown",
      left_node_id: null,
      right_node_id: node.node_id,
      match: unmatchedMatch(),
      dimensions: ["availability"],
      limitations: ownComparisonLimitations(node),
    });
  const endpointGap = oppositeEndpointUncertain(
    node,
    context.leftUnresolvedEndpointKinds,
  );
  const absenceObserved =
    !endpointGap && absenceClaimable(context.leftGraph.coverage);
  return itemWithId({
    ...common,
    status: absenceObserved ? "added" : "unknown",
    left_node_id: null,
    right_node_id: node.node_id,
    match: unmatchedMatch(),
    dimensions:
      absenceObserved || endpointGap
        ? ["availability"]
        : ["availability", "coverage"],
    limitations: [
      ...ownComparisonLimitations(node),
      ...(endpointGap
        ? [ENDPOINT_ABSENCE_LIMITATION]
        : absenceObserved
          ? []
          : [INCOMPLETE_GRAPH_LIMITATION]),
    ],
  });
};

const matchedMatch = (
  pair: ApplicationVersionNodePair,
): Extract<
  ApplicationVersionComparisonItem["match"],
  { readonly status: "matched" }
> => {
  const candidates: {
    readonly candidate_left_node_ids: [];
    readonly candidate_right_node_ids: [];
  } = {
    candidate_left_node_ids: [],
    candidate_right_node_ids: [],
  };
  switch (pair.basis) {
    case "exact-node-identity":
    case "exact-content-digest":
    case "exact-module-source-digest":
      return {
        status: "matched",
        basis: pair.basis,
        confidence: "exact",
        ...candidates,
      };
    case "source-map-identity":
      return {
        status: "matched",
        basis: pair.basis,
        confidence: "high",
        ...candidates,
      };
    case "structural-fingerprint":
    case "semantic-key":
      return {
        status: "matched",
        basis: pair.basis,
        confidence: "medium",
        ...candidates,
      };
  }
};

const unmatchedMatch = (): Extract<
  ApplicationVersionComparisonItem["match"],
  { readonly status: "unmatched" }
> => ({
  status: "unmatched",
  basis: "none",
  confidence: "unknown",
  candidate_left_node_ids: [],
  candidate_right_node_ids: [],
});

const AMBIGUOUS_MATCH_LIMITATION =
  "Multiple nodes share the same permitted match key; no cross-version pair was selected.";
const INCOMPLETE_GRAPH_LIMITATION =
  "The opposite graph is incomplete, so an unmatched node cannot be classified as added or removed.";
const ENDPOINT_TARGET_LIMITATION =
  "Endpoint target identity remains unresolved; any matched source site aligns retained syntax, not an established runtime destination.";
const ENDPOINT_ABSENCE_LIMITATION =
  "An unresolved endpoint of the same kind on the opposite side prevents proving this endpoint target absent.";

const unresolvedEndpointTarget = (node: ApplicationNode): boolean =>
  node.kind === "endpoint" &&
  applicationEndpointCorrespondence(node).targetResolution !== "exact";

const unresolvedEndpointKinds = (
  graph: JavaScriptApplicationGraph,
): ReadonlySet<string | null> => {
  const kinds = new Set<string | null>();
  for (const node of graph.nodes) {
    if (node.kind !== "endpoint") continue;
    const identity = applicationEndpointCorrespondence(node);
    if (identity.targetResolution !== "exact") kinds.add(identity.endpointKind);
  }
  return kinds;
};

const oppositeEndpointUncertain = (
  node: ApplicationNode,
  kinds: ReadonlySet<string | null>,
): boolean => {
  if (node.kind !== "endpoint" || kinds.size === 0) return false;
  const { endpointKind } = applicationEndpointCorrespondence(node);
  return endpointKind === null || kinds.has(null) || kinds.has(endpointKind);
};

const ownPresenceUncertain = (node: ApplicationNode): boolean =>
  node.observations.every(
    ({ evidence }) =>
      evidence.state === "unknown" || evidence.state === "unavailable",
  );

const ownComparisonLimitations = (node: ApplicationNode): string[] => {
  const limitations = new Set<string>();
  const endpointTargetUncertain = unresolvedEndpointTarget(node);
  if (endpointTargetUncertain) limitations.add(ENDPOINT_TARGET_LIMITATION);
  for (const { evidence } of node.observations)
    if (
      endpointTargetUncertain ||
      evidence.state === "unknown" ||
      evidence.state === "unavailable"
    )
      for (const limitation of evidence.limitations)
        limitations.add(limitation);
  return [...limitations].sort(compareUnicodeCodePoints);
};

const changedDimensions = (
  pair: ApplicationVersionNodePair,
  relationships: RelationshipComparison,
  sourceAnalysisUncertain: boolean,
): ApplicationVersionComparisonItem["dimensions"] => {
  const dimensions: ApplicationVersionComparisonItem["dimensions"] = [];
  const leftContent = contentIdentity(pair.left);
  const rightContent = contentIdentity(pair.right);
  if (
    leftContent !== null &&
    rightContent !== null &&
    leftContent !== rightContent
  )
    dimensions.push("content");
  if (
    canonicalJson(locations(pair.left)) !== canonicalJson(locations(pair.right))
  )
    dimensions.push("location");
  if (
    canonicalJson(properties(pair.left, sourceAnalysisUncertain)) !==
    canonicalJson(properties(pair.right, sourceAnalysisUncertain))
  )
    dimensions.push("properties");
  if (relationships.different) dimensions.push("relationships");
  return dimensions;
};

const contentIdentity = (node: ApplicationNode): string | null => {
  if (node.identity.strategy === "content-digest")
    return `content:${node.identity.sha256}`;
  if (node.kind === "javascript-module")
    return stringProperty(node, "source_sha256");
  if (
    node.kind === "source-module" &&
    node.identity.strategy === "source-map-original"
  )
    return node.identity.source_sha256;
  return null;
};

const locations = (node: ApplicationNode) =>
  node.observations
    .map(({ evidence }) =>
      evidence.location.available ? evidence.location.value : evidence.location,
    )
    .sort((left, right) =>
      compareUnicodeCodePoints(canonicalJson(left), canonicalJson(right)),
    );

const SOURCE_FILE_KINDS = new Set([
  "javascript",
  "html",
  "json",
  "package-json",
  "source-map",
]);

const hasUnexaminedSourceFile = (node: ApplicationNode): boolean =>
  node.observations.some(
    ({ properties: values }) =>
      typeof values.file_kind === "string" &&
      SOURCE_FILE_KINDS.has(values.file_kind) &&
      (values.text_status === "outside-analysis-scope" ||
        values.text_status === "invalid-utf8" ||
        (values.file_kind === "json" &&
          "json_parse_status" in values &&
          values.json_parse_status !== "included") ||
        (values.file_kind === "package-json" &&
          values.package_parse_status !== "included") ||
        (values.file_kind === "javascript" &&
          (("parse_status" in values && values.parse_status === null) ||
            values.parse_status === "failed" ||
            values.parse_status === "skipped" ||
            values.parse_status === "partial"))),
  );

const properties = (node: ApplicationNode, sourceAnalysisUncertain: boolean) =>
  node.observations
    .map(({ label, properties: values, source_map_reference }) => ({
      label,
      properties: comparisonPropertyValues(values, sourceAnalysisUncertain),
      source_map_reference,
    }))
    .sort((left, right) =>
      compareUnicodeCodePoints(canonicalJson(left), canonicalJson(right)),
    );

const comparisonPropertyValues = (
  values: ApplicationNode["observations"][number]["properties"],
  sourceAnalysisUncertain: boolean,
) => {
  const comparable =
    sourceAnalysisUncertain &&
    typeof values.file_kind === "string" &&
    SOURCE_FILE_KINDS.has(values.file_kind)
      ? Object.fromEntries(
          Object.entries(values).filter(
            ([key]) =>
              ![
                "text_status",
                "parse_status",
                "analysis_coverage",
                "vendor_markers",
                "json_parse_status",
                "package_parse_status",
                "json_top_level_keys",
                "omitted_json_top_level_keys",
              ].includes(key),
          ),
        )
      : values;
  const occurrence = javaScriptFileOccurrenceSchema.safeParse(
    comparable.file_occurrence,
  );
  if (!occurrence.success) return comparable;
  // A containing artifact's digest locates this occurrence in one version;
  // sibling changes do not establish a change to this file's own facts.
  // Keep the occurrence's path and content digest comparable, and retain the
  // complete provenance record on the original observation.
  return {
    ...comparable,
    file_occurrence: {
      path: occurrence.data.path,
      sha256: occurrence.data.sha256,
    },
  };
};

const indexRelationships = (
  graph: JavaScriptApplicationGraph,
): RelationshipIndex => {
  const adjacency = new Map<string, IndexedRelationship[]>();
  const add = (nodeId: string, relationship: IndexedRelationship): void => {
    const existing = adjacency.get(nodeId);
    if (existing === undefined) adjacency.set(nodeId, [relationship]);
    else existing.push(relationship);
  };
  for (const edge of graph.edges) {
    const coverageLimited =
      edge.properties.pairing_basis === IPC_COVERAGE_LIMITED_PAIRING_BASIS;
    add(edge.source_node_id, {
      direction: "out",
      relation: edge.relation,
      neighborId: edge.target_node_id,
      coverageLimited,
    });
    if (edge.target_node_id !== edge.source_node_id)
      add(edge.target_node_id, {
        direction: "in",
        relation: edge.relation,
        neighborId: edge.source_node_id,
        coverageLimited,
      });
  }
  return {
    nodeById: new Map(graph.nodes.map((value) => [value.node_id, value])),
    adjacency,
  };
};

/** Positive topology differences and unresolved neighbor identity are independent facts. */
interface RelationshipComparison {
  readonly different: boolean;
  readonly unresolved: boolean;
  readonly coverageLimited: boolean;
}

const compareRelationships = (
  pair: ApplicationVersionNodePair,
  context: ItemContext,
): RelationshipComparison => {
  const left = relationshipFacts(pair.left, "left", context);
  const right = relationshipFacts(pair.right, "right", context);
  return {
    different:
      unexplainedRelationshipDifference(
        left.paired,
        right.paired,
        left.possiblePaired,
        right.possiblePaired,
      ) ||
      unexplainedRelationshipDifference(
        left.unpairedShape,
        right.unpairedShape,
        left.possibleUnpairedShape,
        right.possibleUnpairedShape,
      ),
    unresolved: left.unresolved || right.unresolved,
    coverageLimited: left.coverageLimited || right.coverageLimited,
  };
};

/** A candidate can explain a missing counterpart but cannot prove a change. */
const unexplainedRelationshipDifference = (
  left: readonly string[],
  right: readonly string[],
  leftPossible: readonly string[],
  rightPossible: readonly string[],
): boolean => {
  const counts = (values: readonly string[]) => {
    const result = new Map<string, number>();
    for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
    return result;
  };
  const leftCounts = counts(left);
  const rightCounts = counts(right);
  const leftCandidateCounts = counts(leftPossible);
  const rightCandidateCounts = counts(rightPossible);
  for (const key of new Set([...leftCounts.keys(), ...rightCounts.keys()])) {
    const difference = (leftCounts.get(key) ?? 0) - (rightCounts.get(key) ?? 0);
    if (
      difference > (rightCandidateCounts.get(key) ?? 0) ||
      -difference > (leftCandidateCounts.get(key) ?? 0)
    )
      return true;
  }
  return false;
};

const relationshipFacts = (
  node: ApplicationNode,
  side: "left" | "right",
  context: ItemContext,
): {
  readonly paired: readonly string[];
  readonly unpairedShape: readonly string[];
  readonly possiblePaired: readonly string[];
  readonly possibleUnpairedShape: readonly string[];
  readonly unresolved: boolean;
  readonly coverageLimited: boolean;
} => {
  const { nodeById, adjacency } =
    side === "left" ? context.leftRelationships : context.rightRelationships;
  const paired = side === "left" ? context.pairByLeft : context.pairByRight;
  const matched: string[] = [];
  const unpaired: string[] = [];
  const possibleMatched: string[] = [];
  const possibleUnpaired: string[] = [];
  let coverageLimited = false;
  for (const {
    direction,
    relation,
    neighborId,
    coverageLimited: candidate,
  } of adjacency.get(node.node_id) ?? []) {
    const mapped = paired.get(neighborId);
    if (candidate) coverageLimited = true;
    if (mapped !== undefined) {
      (candidate ? possibleMatched : matched).push(
        `${direction}\0${relation}\0${mapped}`,
      );
    } else {
      (candidate ? possibleUnpaired : unpaired).push(
        `${direction}\0${relation}\0${nodeById.get(neighborId)?.kind ?? "unknown"}`,
      );
    }
  }
  return {
    paired: matched,
    unpairedShape: unpaired,
    possiblePaired: possibleMatched,
    possibleUnpairedShape: possibleUnpaired,
    unresolved: unpaired.length > 0 || possibleUnpaired.length > 0,
    coverageLimited,
  };
};

const itemEvidenceLinks = (
  left: ApplicationNode | undefined,
  right: ApplicationNode | undefined,
  context: ItemContext,
): string[] =>
  [
    ...new Set([
      context.leftEvidenceId,
      context.rightEvidenceId,
      ...nativeLinks(left, context.leftNativeEvidenceByDigest),
      ...nativeLinks(right, context.rightNativeEvidenceByDigest),
    ]),
  ].sort(compareUnicodeCodePoints);

const nativeLinks = (
  node: ApplicationNode | undefined,
  evidenceByDigest: ReadonlyMap<string, readonly string[]>,
): readonly string[] => {
  const identity = node === undefined ? null : contentIdentity(node);
  if (identity === null) return [];
  const digest = identity.replace(/^content:/u, "");
  return evidenceByDigest.get(digest) ?? [];
};

const indexNativeEvidence = (
  evidence: readonly Evidence[],
): ReadonlyMap<string, readonly string[]> => {
  const evidenceByDigest = new Map<string, string[]>();
  for (const { evidence_id: id, subject } of evidence) {
    const digest = subject?.digest.sha256;
    if (digest === undefined) continue;
    const ids = evidenceByDigest.get(digest);
    if (ids === undefined) evidenceByDigest.set(digest, [id]);
    else ids.push(id);
  }
  return evidenceByDigest;
};

const matchLimitations = (pair: ApplicationVersionNodePair): string[] => [
  ...(pair.basis === "structural-fingerprint"
    ? [
        "Structural fingerprint equality is rename-resistant inference; it is not byte identity or proof of semantic equivalence.",
      ]
    : []),
  ...(pair.basis === "source-map-identity"
    ? [
        "Source-map original names identify a candidate source lineage; changed or unavailable source content remains explicit.",
      ]
    : []),
  ...(pair.basis === "semantic-key"
    ? [
        "Semantic-key pairing is a deterministic inference and is never promoted to exact identity.",
      ]
    : []),
];

const itemWithId = <Semantic extends ComparisonItemSemantic>(
  semantic: Semantic,
): Semantic & { readonly item_id: string } => ({
  ...semantic,
  item_id: `javc_item_${digestCanonicalValue(semantic, "Application version item")}`,
});

const stringProperty = (node: ApplicationNode, key: string): string | null => {
  const values = [
    ...new Set(
      node.observations
        .map(({ properties: values }) => values[key])
        .filter((value): value is string => typeof value === "string"),
    ),
  ];
  return values.length === 1 ? (values[0] ?? null) : null;
};

const graphsComplete = (context: ItemContext): boolean =>
  absenceClaimable(context.leftGraph.coverage) &&
  absenceClaimable(context.rightGraph.coverage);
