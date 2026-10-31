import { nativeExportCorrespondenceKey } from "./javascriptNativeExportFacts.js";
import { canonicalJson } from "../comparisonSemantics.js";
import {
  compareUnicodeCodePoints,
  compositeKey,
} from "../unicodeCodePointOrder.js";
import type { ApplicationNode } from "./javascriptApplicationGraphSchemas.js";
import type { JsonValue } from "../jsonValue.js";
import { applicationEndpointCorrespondence } from "./javascriptApplicationEndpointCorrespondence.js";

/** One deterministic one-to-one match between two graph versions. */
type ApplicationVersionPairMatch =
  | {
      readonly basis:
        | "exact-node-identity"
        | "exact-content-digest"
        | "exact-module-source-digest";
      readonly confidence: "exact";
    }
  | {
      readonly basis: "source-map-identity";
      readonly confidence: "high";
    }
  | {
      readonly basis: "structural-fingerprint" | "semantic-key";
      readonly confidence: "medium";
    };

export type ApplicationVersionNodePair = {
  readonly left: ApplicationNode;
  readonly right: ApplicationNode;
} & ApplicationVersionPairMatch;

/** Matched nodes plus ambiguity candidates that were never forced into pairs. */
export interface ApplicationVersionMatchingProjection {
  readonly pairs: ApplicationVersionNodePair[];
  readonly unmatchedLeft: ApplicationNode[];
  readonly unmatchedRight: ApplicationNode[];
  readonly candidatesForLeft: ReadonlyMap<string, readonly string[]>;
  readonly candidatesForRight: ReadonlyMap<string, readonly string[]>;
}

interface MatchTier {
  readonly match: ApplicationVersionPairMatch;
  readonly key: (node: ApplicationNode) => string | null;
}

const matchTiers = (): readonly MatchTier[] => [
  {
    match: { basis: "exact-content-digest", confidence: "exact" },
    key: contentDigestKey,
  },
  {
    match: { basis: "exact-module-source-digest", confidence: "exact" },
    key: moduleSourceDigestKey,
  },
  {
    match: { basis: "exact-node-identity", confidence: "exact" },
    key: nodeIdentityKey,
  },
  {
    match: { basis: "source-map-identity", confidence: "high" },
    key: sourceMapKey,
  },
  {
    match: { basis: "structural-fingerprint", confidence: "medium" },
    key: structuralFingerprintKey,
  },
  {
    match: { basis: "semantic-key", confidence: "medium" },
    key: semanticKey,
  },
];

/** Apply ordered, unique-only matching tiers without fuzzy pairing. */
export const matchJavaScriptApplicationVersions = (
  leftNodes: readonly ApplicationNode[],
  rightNodes: readonly ApplicationNode[],
): ApplicationVersionMatchingProjection => {
  const left = new Map(leftNodes.map((node) => [node.node_id, node]));
  const right = new Map(rightNodes.map((node) => [node.node_id, node]));
  const pairs: ApplicationVersionNodePair[] = [];
  const ambiguousGroups: AmbiguousGroup[] = [];
  for (const tier of matchTiers())
    applyTier({ left, right, pairs, ambiguousGroups, tier });
  const remainingLeft = sortedNodes(left.values());
  const remainingRight = sortedNodes(right.values());
  const leftCandidates = new Map<string, Set<string>>();
  const rightCandidates = new Map<string, Set<string>>();
  // Later tiers can pair members of an ambiguous group. Expand only survivors,
  // without pairing groups that became unique after those later matches.
  for (const group of ambiguousGroups) {
    const leftGroup = group.left.filter((node) => left.has(node.node_id));
    if (leftGroup.length === 0) continue;
    const rightGroup = group.right.filter((node) => right.has(node.node_id));
    if (rightGroup.length === 0) continue;
    recordCandidates(leftGroup, rightGroup, leftCandidates, rightCandidates);
  }
  return {
    pairs: pairs.sort((a, b) =>
      compareUnicodeCodePoints(
        `${a.left.node_id}\0${a.right.node_id}`,
        `${b.left.node_id}\0${b.right.node_id}`,
      ),
    ),
    unmatchedLeft: remainingLeft,
    unmatchedRight: remainingRight,
    candidatesForLeft: sortedCandidates(leftCandidates),
    candidatesForRight: sortedCandidates(rightCandidates),
  };
};

interface AmbiguousGroup {
  readonly left: readonly ApplicationNode[];
  readonly right: readonly ApplicationNode[];
}

interface TierContext {
  readonly left: Map<string, ApplicationNode>;
  readonly right: Map<string, ApplicationNode>;
  readonly pairs: ApplicationVersionNodePair[];
  readonly ambiguousGroups: AmbiguousGroup[];
  readonly tier: MatchTier;
}

const applyTier = (context: TierContext): void => {
  const leftByKey = nodesByKey(context.left.values(), context.tier.key);
  const rightByKey = nodesByKey(context.right.values(), context.tier.key);
  for (const key of [...leftByKey.keys()].sort(compareUnicodeCodePoints)) {
    const leftGroup = leftByKey.get(key) ?? [];
    const rightGroup = rightByKey.get(key);
    if (rightGroup === undefined) continue;
    if (leftGroup.length !== 1 || rightGroup.length !== 1) {
      context.ambiguousGroups.push({ left: leftGroup, right: rightGroup });
      continue;
    }
    const leftNode = leftGroup[0];
    const rightNode = rightGroup[0];
    if (leftNode === undefined || rightNode === undefined) continue;
    context.pairs.push({
      left: leftNode,
      right: rightNode,
      ...context.tier.match,
    });
    context.left.delete(leftNode.node_id);
    context.right.delete(rightNode.node_id);
  }
};

const nodesByKey = (
  nodes: Iterable<ApplicationNode>,
  keyFor: (node: ApplicationNode) => string | null,
): Map<string, ApplicationNode[]> => {
  const output = new Map<string, ApplicationNode[]>();
  for (const node of nodes) {
    const key = keyFor(node);
    if (key === null) continue;
    const group = output.get(key);
    if (group === undefined) output.set(key, [node]);
    else group.push(node);
  }
  return output;
};

const recordCandidates = (
  left: readonly ApplicationNode[],
  right: readonly ApplicationNode[],
  leftCandidates: Map<string, Set<string>>,
  rightCandidates: Map<string, Set<string>>,
): void => {
  for (const leftNode of left) {
    const candidates =
      leftCandidates.get(leftNode.node_id) ?? new Set<string>();
    for (const rightNode of right) candidates.add(rightNode.node_id);
    leftCandidates.set(leftNode.node_id, candidates);
  }
  for (const rightNode of right) {
    const candidates =
      rightCandidates.get(rightNode.node_id) ?? new Set<string>();
    for (const leftNode of left) candidates.add(leftNode.node_id);
    rightCandidates.set(rightNode.node_id, candidates);
  }
};

const sortedCandidates = (
  candidates: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlyMap<string, readonly string[]> =>
  new Map(
    [...candidates.entries()].map(([nodeId, values]) => [
      nodeId,
      [...values].sort(compareUnicodeCodePoints),
    ]),
  );

const nodeIdentityKey = (node: ApplicationNode): string =>
  `node\0${node.kind}\0${node.node_id}`;

const contentDigestKey = (node: ApplicationNode): string | null =>
  node.identity.strategy === "content-digest"
    ? `content\0${node.kind}\0${node.identity.sha256}`
    : null;

const moduleSourceDigestKey = (node: ApplicationNode): string | null => {
  if (node.kind !== "javascript-module") return null;
  // An export binding is identified within its whole application root, so its
  // id changes with any sibling file. Its own file's bytes and exported name
  // identify it across versions, as `source_sha256` does a source module.
  if (
    node.identity.strategy === "artifact-local-key" &&
    node.identity.namespace === "module-export"
  ) {
    const name = uniqueStringProperty(node, "exported_name");
    return name === null
      ? null
      : `module-export\0${node.identity.artifact_sha256}\0${name}`;
  }
  const value = uniqueStringProperty(node, "source_sha256");
  return value === null ? null : `module-source\0${node.kind}\0${value}`;
};

const sourceMapKey = (node: ApplicationNode): string | null =>
  node.kind === "source-module" &&
  node.identity.strategy === "source-map-original"
    ? `source-map\0${canonicalJson([node.identity.source_root, node.identity.original_source])}`
    : null;

const structuralFingerprintKey = (node: ApplicationNode): string | null => {
  if (node.kind !== "javascript-module") return null;
  const digest = uniqueStringProperty(node, "structural_fingerprint_sha256");
  const algorithm = uniqueStringProperty(
    node,
    "structural_fingerprint_algorithm",
  );
  return digest === null || algorithm === null
    ? null
    : `structural\0${node.kind}\0${algorithm}\0${digest}`;
};

const semanticKey = (node: ApplicationNode): string | null => {
  if (
    [
      "javascript-module",
      "javascript-chunk",
      "runtime-script-instance",
      "unknown",
    ].includes(node.kind)
  )
    return null;
  const properties = firstProperties(node);
  const value = semanticValue(node, properties);
  return value === null ? null : `semantic\0${node.kind}\0${value}`;
};

/** Kinds keyed by one literal name, unless that name is a dynamic expression. */
const LITERAL_NAME_PROPERTIES: Partial<
  Record<ApplicationNode["kind"], string>
> = { "ipc-channel": "channel", "url-scheme": "scheme" };

const semanticValue = (
  node: ApplicationNode,
  properties: Readonly<Record<string, JsonValue>>,
): string | null => {
  if (node.kind === "endpoint")
    return applicationEndpointCorrespondence(node).semanticKey;
  if (node.kind === "storage")
    return joined(
      properties.storage_kind,
      properties.name ?? properties.mechanism,
    );
  const literalKey = LITERAL_NAME_PROPERTIES[node.kind];
  if (literalKey !== undefined)
    return ["dynamic", "invalid-literal"].includes(
      String(properties.resolution),
    )
      ? null
      : (exactString(properties[literalKey]) ?? firstLabel(node));
  if (node.kind === "context-bridge-api")
    return (
      firstLabel(node) ??
      exactString(properties.api_key) ??
      nonEmptyString(properties.api_name)
    );
  if (node.kind === "native-export") return nativeExportCorrespondenceKey(node);
  if (
    [
      "electron-main",
      "electron-preload",
      "electron-renderer",
      "electron-utility",
    ].includes(node.kind)
  )
    return joined(properties.declared_path, properties.resolved_path);
  if (node.kind === "package") return nonEmptyString(properties.name);
  return canonicalPath(node) ?? nonEmptyString(properties.path);
};

const canonicalPath = (node: ApplicationNode): string | null =>
  node.identity.strategy === "canonical-path" ? node.identity.path : null;

const firstProperties = (node: ApplicationNode) =>
  node.observations[0]?.properties ?? {};

const firstLabel = (node: ApplicationNode): string | null =>
  node.observations.find(({ label }) => label !== null)?.label ?? null;

const uniqueStringProperty = (
  node: ApplicationNode,
  name: string,
): string | null => {
  const values = [
    ...new Set(
      node.observations
        .map(({ properties }) => properties[name])
        .filter((value): value is string => typeof value === "string"),
    ),
  ];
  return values.length === 1 ? (values[0] ?? null) : null;
};

const joined = (...values: readonly unknown[]): string | null => {
  const strings = values.map(nonEmptyString);
  return strings.some((value) => value === null) ? null : compositeKey(strings);
};

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/** A literal value such as `ipcMain.handle("")` keeps its exact empty text. */
const exactString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const sortedNodes = (nodes: Iterable<ApplicationNode>): ApplicationNode[] =>
  [...nodes].sort((left, right) =>
    compareUnicodeCodePoints(left.node_id, right.node_id),
  );
