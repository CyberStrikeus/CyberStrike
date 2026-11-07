import { z } from "zod";
import {
  arrayContainerSchema,
  parseElementSteps,
} from "../zodCollectionSteps.js";
import { canonicalJsonDigestSteps } from "../canonicalJsonDigestSteps.js";
import { canonicalJson } from "../comparisonSemantics.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import { uniqueSorted } from "../canonicalOrdering.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import {
  freezeJsonSnapshot,
  freezeOwnedJsonSnapshotSteps,
} from "../immutableJson.js";

import type {
  ApplicationGraphEvidence,
  ApplicationNodeIdentity,
} from "./javascriptApplicationEvidenceSchemas.js";
import {
  applicationEdgeInputSchema,
  applicationEdgeSchema,
  applicationNodeInputSchema,
  applicationNodeObservationSchema,
  applicationNodeSchema,
  javascriptApplicationGraphInputSchema,
  javascriptApplicationGraphRecordSchema,
  type ApplicationEdge,
  type ApplicationNode,
  type JavaScriptApplicationGraphInput,
} from "./javascriptApplicationGraphSchemas.js";

const OBSERVATION_IDENTIFIER_STRATEGY = {
  strategy: "semantic-content-sha256" as const,
  stability: "observation-exact" as const,
};
const EDGE_IDENTIFIER_STRATEGY = {
  strategy: "semantic-content-sha256" as const,
  stability: "relationship-exact" as const,
};

const limitKey = (
  limit: ApplicationGraphEvidence["coverage"]["limits"][number],
) => canonicalJson(limit, "JavaScript Application Graph");

const normalizeLimits = (
  limits: ApplicationGraphEvidence["coverage"]["limits"],
): ApplicationGraphEvidence["coverage"]["limits"] =>
  [...new Map(limits.map((limit) => [limitKey(limit), limit])).values()].sort(
    (left, right) => compareUnicodeCodePoints(limitKey(left), limitKey(right)),
  );

const normalizeEvidence = (
  evidence: ApplicationGraphEvidence,
): ApplicationGraphEvidence => ({
  ...evidence,
  coverage: {
    ...evidence.coverage,
    limits: normalizeLimits(evidence.coverage.limits),
  },
  limitations: uniqueSorted(evidence.limitations),
  evidence_ids: uniqueSorted(evidence.evidence_ids),
});

const normalizeIdentity = (
  identity: ApplicationNodeIdentity,
): ApplicationNodeIdentity =>
  identity.strategy === "structural-fingerprint"
    ? { ...identity, basis: uniqueSorted(identity.basis) }
    : identity;

const nodeSemantic = (node: Pick<ApplicationNode, "kind" | "identity">) => ({
  kind: node.kind,
  identity: node.identity,
});

const nodeId = (node: Pick<ApplicationNode, "kind" | "identity">): string =>
  `jag_node_${digestCanonicalValue(nodeSemantic(node), "JavaScript Application Graph")}`;

const observationSemantic = (
  nodeIdentifier: string,
  observation: Omit<
    z.infer<typeof applicationNodeObservationSchema>,
    "observation_id"
  >,
) => ({ node_id: nodeIdentifier, ...observation });

const observationId = (
  nodeIdentifier: string,
  observation: Omit<
    z.infer<typeof applicationNodeObservationSchema>,
    "observation_id"
  >,
): string =>
  `jag_observation_${digestCanonicalValue(
    observationSemantic(nodeIdentifier, observation),
  )}`;

type EdgeSemantic = Omit<ApplicationEdge, "edge_id">;

const edgeId = (edge: EdgeSemantic): string =>
  `jag_edge_${digestCanonicalValue(edge, "JavaScript Application Graph")}`;

/** The issue sink shared by schema refinement and stepwise checking. */
type GraphIssueContext = Pick<z.RefinementCtx, "addIssue">;

const sortedUniqueIssue = (
  values: readonly string[],
  path: PropertyKey[],
  label: string,
  context: GraphIssueContext,
): void => {
  for (let index = 1; index < values.length; index += 1) {
    if (
      compareUnicodeCodePoints(values[index - 1] ?? "", values[index] ?? "") < 0
    )
      continue;
    context.addIssue({
      code: "custom",
      message: `${label} must be sorted and unique by Unicode code point`,
      path: [...path, index],
    });
    return;
  }
};

const checkEvidenceNormalization = (
  evidence: ApplicationGraphEvidence,
  path: PropertyKey[],
  context: GraphIssueContext,
): void => {
  sortedUniqueIssue(
    evidence.limitations,
    [...path, "limitations"],
    "Evidence limitations",
    context,
  );
  sortedUniqueIssue(
    evidence.evidence_ids,
    [...path, "evidence_ids"],
    "Evidence identifiers",
    context,
  );
  sortedUniqueIssue(
    evidence.coverage.limits.map(limitKey),
    [...path, "coverage", "limits"],
    "Evidence limits",
    context,
  );

  const runtimeLocation =
    evidence.location.available && evidence.location.value.kind === "runtime";
  const staticAuthority = [
    "artifact-bytes",
    "ast-static-analysis",
    "static-relationship-inference",
    "native-analysis-provider",
    "managed-static-analysis",
  ].includes(evidence.authority);
  if (runtimeLocation && staticAuthority)
    context.addIssue({
      code: "custom",
      message: "Static and native authorities cannot claim a runtime location",
      path: [...path, "location"],
    });
};

const sourceMapObservationMatchesIdentity = (
  identity: Extract<
    ApplicationNodeIdentity,
    { readonly strategy: "source-map-original" }
  >,
  observation: ApplicationNode["observations"][number],
): boolean => {
  const { evidence, source_map_reference: reference } = observation;
  const sourceDigests = [
    observation.properties.content_sha256,
    // Older graph producers used `source_sha256` for the same source-map fact.
    observation.properties.source_sha256,
  ];
  const hasKnownSourceDigest = identity.source_sha256 !== null;
  const sourceDigestMatches =
    sourceDigests.every(
      (digest) =>
        digest === undefined ||
        digest === null ||
        digest === identity.source_sha256,
    ) &&
    (!hasKnownSourceDigest || sourceDigests.includes(identity.source_sha256));
  const contentAvailabilityMatches =
    (observation.properties.content_available !== true ||
      hasKnownSourceDigest) &&
    (observation.properties.content_available !== false ||
      !hasKnownSourceDigest);
  return (
    sourceDigestMatches &&
    contentAvailabilityMatches &&
    reference !== null &&
    evidence.state === "observed" &&
    evidence.artifact.available &&
    evidence.artifact.sha256 === identity.source_map_sha256 &&
    reference.source_name === identity.original_source &&
    reference.source_root === identity.source_root &&
    evidence.location.available &&
    evidence.location.value.kind === "artifact-path" &&
    reference.map_path === evidence.location.value.path
  );
};

const observationMatchesIdentity = (
  node: ApplicationNode,
  observation: ApplicationNode["observations"][number],
): boolean => {
  const { identity } = node;
  const { evidence } = observation;
  if (identity.strategy === "content-digest")
    return (
      evidence.state === "observed" &&
      evidence.artifact.available &&
      evidence.artifact.sha256 === identity.sha256
    );
  if (identity.strategy === "source-map-original")
    return sourceMapObservationMatchesIdentity(identity, observation);
  if (identity.strategy === "canonical-path")
    return (
      evidence.artifact.available &&
      evidence.artifact.sha256 === identity.artifact_sha256 &&
      evidence.location.available &&
      evidence.location.value.kind === "artifact-path" &&
      evidence.location.value.path === identity.path
    );
  if (identity.strategy === "artifact-local-key")
    return (
      evidence.artifact.available &&
      evidence.artifact.sha256 === identity.artifact_sha256
    );
  if (identity.strategy === "runtime-instance") {
    if (
      !["passive-cdp-runtime", "controlled-replay"].includes(
        evidence.authority,
      ) ||
      !evidence.location.available ||
      evidence.location.value.kind !== "runtime"
    )
      return false;
    const location = evidence.location.value;
    return (
      location.capture_sha256 === identity.capture_sha256 &&
      [location.target_key, location.frame_key, location.script_key].includes(
        identity.runtime_key,
      )
    );
  }
  if (identity.strategy === "structural-fingerprint")
    return evidence.state === "inferred";
  return evidence.state === "observed";
};

const checkNode = (
  node: ApplicationNode,
  index: number,
  context: GraphIssueContext,
): void => {
  if (node.node_id !== nodeId(node))
    context.addIssue({
      code: "custom",
      message: "Node identifier does not match its kind and identity",
      path: ["nodes", index, "node_id"],
    });
  if (
    node.identity.strategy === "structural-fingerprint" &&
    canonicalJson(node.identity.basis, "JavaScript Application Graph") !==
      canonicalJson(
        uniqueSorted(node.identity.basis),
        "JavaScript Application Graph",
      )
  )
    context.addIssue({
      code: "custom",
      message: "Structural fingerprint basis must be sorted and unique",
      path: ["nodes", index, "identity", "basis"],
    });

  sortedUniqueIssue(
    node.observations.map(({ observation_id: id }) => id),
    ["nodes", index, "observations"],
    "Node observations",
    context,
  );
  for (const [observationIndex, observation] of node.observations.entries()) {
    const { observation_id: identifier, ...semantic } = observation;
    if (identifier !== observationId(node.node_id, semantic))
      context.addIssue({
        code: "custom",
        message: "Observation identifier does not match its semantic content",
        path: [
          "nodes",
          index,
          "observations",
          observationIndex,
          "observation_id",
        ],
      });
    if (
      node.identity.strategy === "source-map-original" &&
      !observationMatchesIdentity(node, observation)
    )
      context.addIssue({
        code: "custom",
        message:
          "Source-map observation must retain its exact declaration and map location",
        path: [
          "nodes",
          index,
          "observations",
          observationIndex,
          "source_map_reference",
        ],
      });
    checkEvidenceNormalization(
      observation.evidence,
      ["nodes", index, "observations", observationIndex, "evidence"],
      context,
    );
  }
  if (
    !node.observations.some((observation) =>
      observationMatchesIdentity(node, observation),
    )
  )
    context.addIssue({
      code: "custom",
      message: "Node identity is not supported by a compatible observation",
      path: ["nodes", index, "identity"],
    });
};

type GraphRecord = z.infer<typeof javascriptApplicationGraphRecordSchema>;

const checkGraphContent = (
  graph: JavaScriptApplicationGraphInput,
  context: GraphIssueContext,
): void => {
  const steps = checkGraphContentSteps(graph, context);
  while (steps.next().done !== true);
};

function* checkGraphContentSteps(
  graph: JavaScriptApplicationGraphInput,
  context: GraphIssueContext,
): Generator<void, void> {
  sortedUniqueIssue(
    graph.root_node_ids,
    ["root_node_ids"],
    "Root nodes",
    context,
  );
  sortedUniqueIssue(
    graph.nodes.map(({ node_id: id }) => id),
    ["nodes"],
    "Nodes",
    context,
  );
  sortedUniqueIssue(
    graph.edges.map(({ edge_id: id }) => id),
    ["edges"],
    "Edges",
    context,
  );
  sortedUniqueIssue(
    graph.limitations,
    ["limitations"],
    "Graph limitations",
    context,
  );
  sortedUniqueIssue(
    graph.coverage.limits.map(limitKey),
    ["coverage", "limits"],
    "Graph limits",
    context,
  );
  if (graph.coverage.status !== "complete" && graph.limitations.length === 0)
    context.addIssue({
      code: "custom",
      message: "Non-complete graph coverage requires an explicit limitation",
      path: ["limitations"],
    });

  const nodesById = new Map(graph.nodes.map((node) => [node.node_id, node]));
  for (const root of graph.root_node_ids)
    if (!nodesById.has(root))
      context.addIssue({
        code: "custom",
        message: "Root identifier must name a graph node",
        path: ["root_node_ids"],
      });
  for (const [index, node] of graph.nodes.entries()) {
    if (index % 64 === 0) yield;
    checkNode(node, index, context);
  }
  for (const [index, edge] of graph.edges.entries()) {
    if (index % 64 === 0) yield;
    const { edge_id: identifier, ...semantic } = edge;
    if (identifier !== edgeId(semantic))
      context.addIssue({
        code: "custom",
        message: "Edge identifier does not match its semantic content",
        path: ["edges", index, "edge_id"],
      });
    if (
      !nodesById.has(edge.source_node_id) ||
      !nodesById.has(edge.target_node_id)
    )
      context.addIssue({
        code: "custom",
        message: "Edge endpoints must name graph nodes",
        path: ["edges", index],
      });
    if (edge.source_node_id === edge.target_node_id)
      context.addIssue({
        code: "custom",
        message: "Application graph edges cannot be self-referential",
        path: ["edges", index],
      });
    if (
      edge.relation === "changed_from" &&
      nodesById.get(edge.source_node_id)?.kind !==
        nodesById.get(edge.target_node_id)?.kind
    )
      context.addIssue({
        code: "custom",
        message: "changed_from endpoints must have the same node kind",
        path: ["edges", index, "relation"],
      });
    checkEvidenceNormalization(
      edge.evidence,
      ["edges", index, "evidence"],
      context,
    );
  }
}

const checkGraphInvariants = (
  graph: GraphRecord,
  context: GraphIssueContext,
): void => {
  checkGraphContent(graph, context);
  const { graph_id: identifier, ...semantic } = graph;
  if (
    identifier !==
    `jag_${digestCanonicalValue(semantic, "JavaScript Application Graph")}`
  )
    context.addIssue({
      code: "custom",
      message: "Graph identifier does not match its semantic content",
      path: ["graph_id"],
    });
};

/** Strict JavaScript Application Graph with verified commitments. */
export const javascriptApplicationGraphSchema =
  javascriptApplicationGraphRecordSchema.superRefine(checkGraphInvariants);

const javascriptApplicationGraphContentSchema =
  javascriptApplicationGraphInputSchema.superRefine(checkGraphContent);

/** Fully validated JavaScript Application Graph. */
export type JavaScriptApplicationGraph = z.infer<
  typeof javascriptApplicationGraphSchema
>;

/** Build one normalized application entity and derive all semantic IDs. */
export const createJavaScriptApplicationNode = (
  input: unknown,
): ApplicationNode => {
  const parsed = applicationNodeInputSchema.parse(input);
  // These properties are newly parsed and exclusively owned. Authenticate
  // them before the observation/node schemas and final graph validate again.
  for (const observation of parsed.observations)
    freezeJsonSnapshot(observation.properties);
  const identity = normalizeIdentity(parsed.identity);
  const identifier = nodeId({ kind: parsed.kind, identity });
  const observations = parsed.observations
    .map((observation) => {
      const semantic = {
        ...observation,
        evidence: normalizeEvidence(observation.evidence),
        identifier_strategy: OBSERVATION_IDENTIFIER_STRATEGY,
      };
      return applicationNodeObservationSchema.parse({
        ...semantic,
        observation_id: observationId(identifier, semantic),
      });
    })
    .sort((left, right) =>
      compareUnicodeCodePoints(left.observation_id, right.observation_id),
    );
  return applicationNodeSchema.parse({
    node_id: identifier,
    kind: parsed.kind,
    identity,
    observations,
  });
};

/** Merge authenticated entities, retaining every distinct observation. */
export const mergeJavaScriptApplicationNodes = (
  nodes: readonly ApplicationNode[],
): ApplicationNode[] => {
  const groups = new Map<
    string,
    {
      node: ApplicationNode;
      observations: Map<string, ApplicationNode["observations"][number]>;
    }
  >();
  for (const node of nodes) {
    const group = groups.get(node.node_id);
    if (group === undefined) {
      groups.set(node.node_id, {
        node,
        observations: new Map(
          node.observations.map((observation) => [
            observation.observation_id,
            observation,
          ]),
        ),
      });
      continue;
    }
    if (
      node.kind !== group.node.kind ||
      canonicalJson(node.identity) !== canonicalJson(group.node.identity)
    )
      throw new TypeError("Colliding JAG node identifiers disagree");
    for (const observation of node.observations)
      group.observations.set(observation.observation_id, observation);
  }
  return [...groups.values()].map(({ node, observations }) =>
    createJavaScriptApplicationNode({
      kind: node.kind,
      identity: node.identity,
      observations: [...observations.values()].map(
        ({ observation_id: _id, identifier_strategy: _strategy, ...value }) =>
          value,
      ),
    }),
  );
};

/** Build one normalized directed relationship and derive its semantic ID. */
export const createJavaScriptApplicationEdge = (
  input: unknown,
): ApplicationEdge => {
  const parsed = applicationEdgeInputSchema.parse(input);
  freezeJsonSnapshot(parsed.properties);
  const semantic = {
    ...parsed,
    evidence: normalizeEvidence(parsed.evidence),
    identifier_strategy: EDGE_IDENTIFIER_STRATEGY,
  };
  return applicationEdgeSchema.parse({
    ...semantic,
    edge_id: edgeId(semantic),
  });
};

/** Normalize a complete graph and derive its top-level semantic ID. */
export const createJavaScriptApplicationGraph = (
  input: unknown,
): JavaScriptApplicationGraph => {
  const semantic = normalizeGraphInput(
    javascriptApplicationGraphInputSchema.parse(input),
  );
  const content = javascriptApplicationGraphContentSchema.parse(semantic);
  return {
    ...content,
    graph_id: `jag_${digestCanonicalValue(content, "JavaScript Application Graph")}`,
  };
};

const normalizeGraphInput = (
  parsed: JavaScriptApplicationGraphInput,
): JavaScriptApplicationGraphInput => ({
  ...parsed,
  root_node_ids: uniqueSorted(parsed.root_node_ids),
  nodes: [...parsed.nodes].sort((left, right) =>
    compareUnicodeCodePoints(left.node_id, right.node_id),
  ),
  edges: [...parsed.edges].sort((left, right) =>
    compareUnicodeCodePoints(left.edge_id, right.edge_id),
  ),
  coverage: {
    ...parsed.coverage,
    limits: normalizeLimits(parsed.coverage.limits),
  },
  limitations: uniqueSorted(parsed.limitations),
});

const validatedImmutableApplicationGraphs = new WeakSet<object>();

/** Clone and validate synchronously, then return steps to seal the owned graph. */
export const createImmutableJavaScriptApplicationGraphSteps = (
  input: unknown,
): Generator<void, JavaScriptApplicationGraph> =>
  sealValidatedApplicationGraphSteps(createJavaScriptApplicationGraph(input));

const applicationGraphShape = javascriptApplicationGraphInputSchema.shape;
const applicationGraphContainerSchema =
  javascriptApplicationGraphInputSchema.extend({
    nodes: arrayContainerSchema(applicationGraphShape.nodes),
    edges: arrayContainerSchema(applicationGraphShape.edges),
  });

/**
 * Seal a graph whose input the caller transfers: the caller neither retains nor
 * mutates any part of it afterwards. Only the graph's own fields are validated
 * synchronously; nodes and edges are validated, checked, hashed and frozen in
 * steps, because doing so at once held the event loop for large applications.
 */
export const sealTransferredJavaScriptApplicationGraphSteps = (
  input: unknown,
): Generator<void, JavaScriptApplicationGraph> =>
  parseAndSealApplicationGraphSteps(
    applicationGraphContainerSchema.parse(input),
  );

function* parseAndSealApplicationGraphSteps(
  container: z.output<typeof applicationGraphContainerSchema>,
): Generator<void, JavaScriptApplicationGraph> {
  const issues: z.core.$ZodIssue[] = [];
  const parsed: JavaScriptApplicationGraphInput = {
    ...container,
    nodes: yield* parseElementSteps(
      applicationGraphShape.nodes.element,
      container.nodes,
      ["nodes"],
      issues,
    ),
    edges: yield* parseElementSteps(
      applicationGraphShape.edges.element,
      container.edges,
      ["edges"],
      issues,
    ),
  };
  if (issues.length > 0) throw new z.ZodError(issues);
  const content = normalizeGraphInput(parsed);
  let invalid = false;
  yield* checkGraphContentSteps(content, {
    addIssue: () => {
      invalid = true;
    },
  });
  // An invalid owned graph is a construction defect; report it with the exact
  // issues the content schema produces.
  if (invalid) {
    javascriptApplicationGraphContentSchema.parse(content);
    throw new TypeError("Application graph checks disagree with its schema");
  }
  return yield* sealValidatedApplicationGraphSteps({
    ...content,
    graph_id: `jag_${yield* canonicalJsonDigestSteps(content)}`,
  });
}

function* sealValidatedApplicationGraphSteps(
  graph: JavaScriptApplicationGraph,
): Generator<void, JavaScriptApplicationGraph> {
  yield* freezeOwnedJsonSnapshotSteps(graph);
  validatedImmutableApplicationGraphs.add(graph);
  return graph;
}

/** Recognize the exact completely sealed graph produced by the owned factory. */
export const isValidatedImmutableJavaScriptApplicationGraph = (
  value: unknown,
): value is JavaScriptApplicationGraph =>
  typeof value === "object" &&
  value !== null &&
  validatedImmutableApplicationGraphs.has(value);

/** Parse a stored graph and reject stale IDs. */
export const parseJavaScriptApplicationGraph = (
  input: unknown,
): JavaScriptApplicationGraph => javascriptApplicationGraphSchema.parse(input);

/** Compute the byte-stable SHA-256 commitment of a verified graph. */
export const computeJavaScriptApplicationGraphSha256 = (
  input: unknown,
): string =>
  digestCanonicalValue(
    parseJavaScriptApplicationGraph(input),
    "JavaScript Application Graph",
  );

/** Serialize a verified graph as RFC 8785 canonical JSON. */
export const serializeJavaScriptApplicationGraph = (input: unknown): string =>
  canonicalJson(
    parseJavaScriptApplicationGraph(input),
    "JavaScript Application Graph",
  );
