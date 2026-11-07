import { z } from "zod";

import { canonicalJson } from "../comparisonSemantics.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import { uniqueSorted } from "../canonicalOrdering.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import { canonicalJsonDigestSteps } from "../canonicalJsonDigestSteps.js";
import { freezeOwnedJsonSnapshotSteps } from "../immutableJson.js";
import {
  arrayContainerSchema,
  parseElementSteps,
} from "../zodCollectionSteps.js";
import type {
  ApplicationGraphEvidence,
  ApplicationGraphEvidenceContext,
} from "./javascriptApplicationEvidenceSchemas.js";
import { applicationGraphEvidenceSchema } from "./javascriptApplicationEvidenceSchemas.js";
import {
  JAVASCRIPT_SEMANTIC_RELATION_FAMILIES,
  JAVASCRIPT_SEMANTIC_RELATION_FAMILY,
  javaScriptSemanticFingerprintInputSchema,
  javaScriptSemanticEvidenceContextSchema,
  javaScriptSemanticGraphInputSchema,
  javaScriptSemanticGraphRecordSchema,
  javaScriptSemanticNodeInputSchema,
  javaScriptSemanticRelationInputSchema,
  javaScriptSemanticUnknownInputSchema,
  type JavaScriptSemanticGraphInput,
  type JavaScriptSemanticGraphNode,
  type JavaScriptSemanticGraphRelation,
  type JavaScriptSemanticGraphUnknown,
  type JavaScriptSemanticFingerprint,
  type JavaScriptSemanticEvidenceContext,
  type JavaScriptSemanticEvidenceReference,
} from "./javascriptSemanticGraphSchemas.js";

const normalizeEvidence = (
  evidence: ApplicationGraphEvidence,
): ApplicationGraphEvidence => ({
  ...evidence,
  coverage: {
    ...evidence.coverage,
    limits: [...evidence.coverage.limits].sort((left, right) =>
      compareUnicodeCodePoints(
        canonicalJson(left, "JavaScript semantic graph"),
        canonicalJson(right, "JavaScript semantic graph"),
      ),
    ),
  },
  limitations: uniqueSorted(evidence.limitations),
  evidence_ids: uniqueSorted(evidence.evidence_ids),
});

const evidenceContextId = (context: ApplicationGraphEvidenceContext): string =>
  `jsrg_evidence_${digestCanonicalValue(context, "JavaScript semantic evidence context")}`;

/** Graph-scoped owner for canonical provenance shared by semantic facts. */
export class JavaScriptSemanticEvidenceContextRegistry {
  readonly #contexts = new Map<string, JavaScriptSemanticEvidenceContext>();
  // Facts share a few contexts, so key them by canonical text and hash each
  // distinct context once instead of on every fact.
  readonly #idsByCanonicalContext = new Map<string, string>();

  /** Intern normalized non-location provenance at fact construction. */
  intern(
    evidence: ApplicationGraphEvidence,
  ): JavaScriptSemanticEvidenceReference {
    const normalized = normalizeEvidence(evidence);
    const { location, ...context } = normalized;
    const canonicalContext = canonicalJson(
      context,
      "JavaScript semantic graph",
    );
    const internedId = this.#idsByCanonicalContext.get(canonicalContext);
    if (internedId !== undefined) return { context_id: internedId, location };
    const contextId = evidenceContextId(context);
    // This canonical context is new, so a row already stored under its
    // digest holds different provenance.
    if (this.#contexts.has(contextId))
      throw new TypeError(
        "JavaScript semantic evidence context digest collision",
      );
    this.#contexts.set(contextId, { ...context, context_id: contextId });
    this.#idsByCanonicalContext.set(canonicalContext, contextId);
    return { context_id: contextId, location };
  }

  /** Resolve one already interned fact reference for derived evidence. */
  resolve(
    reference: JavaScriptSemanticEvidenceReference,
  ): ApplicationGraphEvidence {
    const context = this.#contexts.get(reference.context_id);
    if (context === undefined)
      throw new TypeError(
        "Semantic evidence reference names an absent context",
      );
    const { context_id: _contextId, ...evidenceContext } = context;
    return { ...evidenceContext, location: reference.location };
  }

  /** Return the deterministic context table owned by this graph projection. */
  get contexts(): JavaScriptSemanticEvidenceContext[] {
    return [...this.#contexts.values()].sort((left, right) =>
      compareUnicodeCodePoints(left.context_id, right.context_id),
    );
  }

  /** Release interned contexts after the owning graph is finalized. */
  clear(): void {
    this.#contexts.clear();
    this.#idsByCanonicalContext.clear();
  }

  /** Validate and intern provenance decoded in this realm from an analysis worker. */
  adopt(input: unknown): void {
    const context = javaScriptSemanticEvidenceContextSchema.parse(input);
    const { context_id: identifier, ...value } = context;
    if (identifier !== evidenceContextId(value))
      throw new TypeError(
        "Transferred semantic evidence context identifier is stale",
      );
    const canonical = canonicalJson(
      value,
      "JavaScript semantic evidence context",
    );
    const existing = this.#contexts.get(identifier);
    if (existing !== undefined) {
      const { context_id: _existingIdentifier, ...existingValue } = existing;
      if (
        canonical !==
        canonicalJson(existingValue, "JavaScript semantic evidence context")
      )
        throw new TypeError(
          "Transferred semantic evidence context digest collision",
        );
    }
    this.#contexts.set(identifier, context);
    this.#idsByCanonicalContext.set(canonical, identifier);
  }
}

/** Derive a semantic node ID from its kind and exact artifact identity. */
export const javaScriptSemanticNodeId = (
  node: Pick<JavaScriptSemanticGraphNode, "kind" | "identity">,
): string =>
  `jsrg_node_${digestCanonicalValue({ kind: node.kind, identity: node.identity }, "JavaScript semantic graph")}`;

/** Normalize one semantic entity and derive its artifact-version identifier. */
export const createJavaScriptSemanticGraphNode = (
  input: unknown,
  evidenceContexts: JavaScriptSemanticEvidenceContextRegistry,
): JavaScriptSemanticGraphNode => {
  const parsed = javaScriptSemanticNodeInputSchema.parse(input);
  const semantic = {
    ...parsed,
    application_node_ids: uniqueSorted(parsed.application_node_ids),
    evidence: evidenceContexts.intern(parsed.evidence),
  };
  return {
    ...semantic,
    node_id: javaScriptSemanticNodeId(semantic),
  };
};

/** Normalize one semantic relationship and derive its exact identifier. */
export const createJavaScriptSemanticGraphRelation = (
  input: unknown,
  evidenceContexts: JavaScriptSemanticEvidenceContextRegistry,
): JavaScriptSemanticGraphRelation => {
  const parsed = javaScriptSemanticRelationInputSchema.parse(input);
  const semantic = {
    ...parsed,
    evidence: evidenceContexts.intern(parsed.evidence),
  };
  return {
    ...semantic,
    relation_id: `jsrg_relation_${digestCanonicalValue(semantic, "JavaScript semantic graph")}`,
  };
};

/** Normalize one unresolved semantic frontier and derive its identifier. */
export const createJavaScriptSemanticGraphUnknown = (
  input: unknown,
  evidenceContexts: JavaScriptSemanticEvidenceContextRegistry,
): JavaScriptSemanticGraphUnknown => {
  const parsed = javaScriptSemanticUnknownInputSchema.parse(input);
  const semantic = {
    ...parsed,
    relation_kinds: uniqueSorted(parsed.relation_kinds),
    candidate_node_ids: uniqueSorted(parsed.candidate_node_ids),
    evidence: evidenceContexts.intern(parsed.evidence),
  };
  return {
    ...semantic,
    unknown_id: `jsrg_unknown_${digestCanonicalValue(semantic, "JavaScript semantic graph")}`,
  };
};

/** Normalize one function fingerprint and derive its component commitment. */
export const createJavaScriptSemanticFingerprint = (
  input: unknown,
  evidenceContexts: JavaScriptSemanticEvidenceContextRegistry,
): JavaScriptSemanticFingerprint => {
  const parsed = javaScriptSemanticFingerprintInputSchema.parse(input);
  const semantic = {
    ...parsed,
    components: {
      ...parsed.components,
      effects: uniqueSorted(parsed.components.effects),
    },
    limitations: uniqueSorted(parsed.limitations),
    evidence: evidenceContexts.intern(parsed.evidence),
  };
  const fingerprintSha256 = digestCanonicalValue(
    semantic.components,
    "JavaScript semantic graph",
  );
  return {
    ...semantic,
    fingerprint_sha256: fingerprintSha256,
    fingerprint_id: `jsrg_fingerprint_${digestCanonicalValue(
      {
        function_node_id: semantic.function_node_id,
        algorithm: semantic.algorithm,
        fingerprint_sha256: fingerprintSha256,
      },
      "JavaScript semantic graph",
    )}`,
  };
};

type GraphRecord = z.infer<typeof javaScriptSemanticGraphRecordSchema>;

type SemanticGraphIssue = {
  readonly code: "custom";
  readonly path: PropertyKey[];
  readonly message: string;
};

interface GraphIssueReporter {
  readonly addIssue: (issue: SemanticGraphIssue) => void;
}

const sortedUniqueIssue = (
  values: readonly string[],
  path: PropertyKey[],
  label: string,
  context: GraphIssueReporter,
): void => {
  for (let index = 1; index < values.length; index += 1) {
    if (
      compareUnicodeCodePoints(values[index - 1] ?? "", values[index] ?? "") < 0
    )
      continue;
    context.addIssue({
      code: "custom",
      path: [...path, index],
      message: `${label} must be sorted and unique`,
    });
    return;
  }
};

function* checkCoverageSteps(
  graph: GraphRecord,
  context: GraphIssueReporter,
): Generator<void> {
  const omittedUnknowns = graph.coverage.omitted_unknown_occurrences ?? [];
  sortedUniqueIssue(
    omittedUnknowns.map(({ family, reason }) => `${family}:${reason}`),
    ["coverage", "omitted_unknown_occurrences"],
    "Unknown omission coverage",
    context,
  );
  if (
    omittedUnknowns.length > 0 &&
    (!graph.coverage.truncated || graph.coverage.status !== "partial")
  )
    context.addIssue({
      code: "custom",
      path: ["coverage"],
      message: "Omitted unknown occurrences require truncated partial coverage",
    });
  const families = graph.coverage.families.map(({ family }) => family);
  if (
    canonicalJson(families, "JavaScript semantic graph") !==
    canonicalJson(
      JAVASCRIPT_SEMANTIC_RELATION_FAMILIES,
      "JavaScript semantic graph",
    )
  )
    context.addIssue({
      code: "custom",
      path: ["coverage", "families"],
      message:
        "Coverage must name every semantic relation family once in canonical order",
    });
  if (
    graph.coverage.status === "complete" &&
    (graph.coverage.truncated ||
      graph.coverage.omitted_nodes !== 0 ||
      graph.coverage.omitted_relations !== 0 ||
      graph.coverage.families.some(({ status }) => status !== "complete"))
  )
    context.addIssue({
      code: "custom",
      path: ["coverage"],
      message: "Complete graph coverage cannot omit or truncate semantic facts",
    });
  if (graph.coverage.truncated && graph.coverage.limits.length === 0)
    context.addIssue({
      code: "custom",
      path: ["coverage", "limits"],
      message: "Truncated graph coverage must identify an effective limit",
    });
  if (graph.coverage.truncated && graph.coverage.status !== "partial")
    context.addIssue({
      code: "custom",
      path: ["coverage", "status"],
      message: "Truncated semantic graph coverage must be partial",
    });
  if (
    graph.coverage.truncated &&
    graph.coverage.omitted_nodes === 0 &&
    graph.coverage.omitted_relations === 0 &&
    omittedUnknowns.length === 0
  )
    context.addIssue({
      code: "custom",
      path: ["coverage"],
      message:
        "Truncated semantic graph coverage must acknowledge omitted facts",
    });
  const relationsByFamily = new Map(
    JAVASCRIPT_SEMANTIC_RELATION_FAMILIES.map((family) => [family, 0]),
  );
  for (const [index, relation] of graph.relations.entries()) {
    if (index % 256 === 0) yield;
    const family = JAVASCRIPT_SEMANTIC_RELATION_FAMILY[relation.relation];
    relationsByFamily.set(family, (relationsByFamily.get(family) ?? 0) + 1);
  }
  const unknownsById = new Map<string, GraphRecord["unknowns"][number]>();
  const unknownFamilies = new Set<string>();
  for (const [index, unknown] of graph.unknowns.entries()) {
    if (index % 256 === 0) yield;
    unknownsById.set(unknown.unknown_id, unknown);
    unknownFamilies.add(unknown.family);
  }
  for (const [index, family] of graph.coverage.families.entries()) {
    if (family.retained_relations !== relationsByFamily.get(family.family))
      context.addIssue({
        code: "custom",
        path: ["coverage", "families", index, "retained_relations"],
        message: "Family retained relation count does not match graph content",
      });
    if (
      family.unknown_ids.some(
        (identifier) => unknownsById.get(identifier)?.family !== family.family,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["coverage", "families", index, "unknown_ids"],
        message: "Family coverage references an unknown from another family",
      });
    if (
      family.status === "complete" &&
      (family.omitted_relations !== 0 ||
        family.unknown_ids.length > 0 ||
        unknownFamilies.has(family.family) ||
        omittedUnknowns.some((omitted) => omitted.family === family.family))
    )
      context.addIssue({
        code: "custom",
        path: ["coverage", "families", index],
        message: "Complete family coverage cannot omit or retain unknown facts",
      });
  }
}

const checkCanonicalOrder = (
  graph: GraphRecord,
  context: GraphIssueReporter,
): void => {
  sortedUniqueIssue(
    graph.root_node_ids,
    ["root_node_ids"],
    "Root nodes",
    context,
  );
  sortedUniqueIssue(
    graph.evidence_contexts.map(({ context_id }) => context_id),
    ["evidence_contexts"],
    "Evidence contexts",
    context,
  );
  sortedUniqueIssue(
    graph.nodes.map(({ node_id }) => node_id),
    ["nodes"],
    "Nodes",
    context,
  );
  sortedUniqueIssue(
    graph.relations.map(({ relation_id }) => relation_id),
    ["relations"],
    "Relations",
    context,
  );
  sortedUniqueIssue(
    graph.fingerprints.map(({ fingerprint_id }) => fingerprint_id),
    ["fingerprints"],
    "Fingerprints",
    context,
  );
  sortedUniqueIssue(
    graph.unknowns.map(({ unknown_id }) => unknown_id),
    ["unknowns"],
    "Unknown frontiers",
    context,
  );
  sortedUniqueIssue(graph.limitations, ["limitations"], "Limitations", context);
};

function* checkEvidenceContextReferencesSteps(
  graph: GraphRecord,
  context: GraphIssueReporter,
): Generator<void> {
  const contexts = new Map(
    graph.evidence_contexts.map((value) => [value.context_id, value]),
  );
  const referenced = new Set<string>();
  const validateReferences = function* (
    entities: readonly { evidence: JavaScriptSemanticEvidenceReference }[],
    entityKind: "nodes" | "relations" | "unknowns" | "fingerprints",
  ): Generator<void> {
    for (const [index, { evidence }] of entities.entries()) {
      if (index % 256 === 0) yield;
      referenced.add(evidence.context_id);
      const evidenceContext = contexts.get(evidence.context_id);
      if (evidenceContext === undefined) {
        context.addIssue({
          code: "custom",
          path: [entityKind, index, "evidence", "context_id"],
          message: "Evidence reference names an absent context",
        });
        continue;
      }
      const { context_id: _contextId, ...evidenceValue } = evidenceContext;
      if (
        !applicationGraphEvidenceSchema.safeParse({
          ...evidenceValue,
          location: evidence.location,
        }).success
      )
        context.addIssue({
          code: "custom",
          path: [entityKind, index, "evidence"],
          message: "Evidence context is incompatible with its fact location",
        });
    }
  };
  yield* validateReferences(graph.nodes, "nodes");
  yield* validateReferences(graph.relations, "relations");
  yield* validateReferences(graph.unknowns, "unknowns");
  yield* validateReferences(graph.fingerprints, "fingerprints");
  for (const [index, evidenceContext] of graph.evidence_contexts.entries()) {
    if (index % 256 === 0) yield;
    const { context_id: identifier, ...value } = evidenceContext;
    if (identifier !== evidenceContextId(value))
      context.addIssue({
        code: "custom",
        path: ["evidence_contexts", index, "context_id"],
        message: "Evidence context identifier is stale",
      });
    if (!referenced.has(identifier))
      context.addIssue({
        code: "custom",
        path: ["evidence_contexts", index],
        message: "Evidence context is not referenced by a graph fact",
      });
  }
}

function* checkNodesSteps(
  graph: GraphRecord,
  nodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>,
  context: GraphIssueReporter,
): Generator<void> {
  for (const [index, node] of graph.nodes.entries()) {
    if (index % 256 === 0) yield;
    if (node.node_id !== javaScriptSemanticNodeId(node))
      context.addIssue({
        code: "custom",
        path: ["nodes", index, "node_id"],
        message: "Node identifier is stale",
      });
    if (
      node.function_node_id !== null &&
      nodes.get(node.function_node_id)?.kind !== "function"
    )
      context.addIssue({
        code: "custom",
        path: ["nodes", index, "function_node_id"],
        message: "Function owner must name a function node",
      });
  }
}

function* checkRootsSteps(
  graph: GraphRecord,
  nodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>,
  context: GraphIssueReporter,
): Generator<void> {
  for (const [index, root] of graph.root_node_ids.entries()) {
    if (index % 256 === 0) yield;
    if (!nodes.has(root))
      context.addIssue({
        code: "custom",
        path: ["root_node_ids"],
        message: "Root identifier must name a semantic node",
      });
  }
}

function* checkRelationsSteps(
  graph: GraphRecord,
  nodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>,
  evidenceContexts: ReadonlyMap<string, JavaScriptSemanticEvidenceContext>,
  context: GraphIssueReporter,
): Generator<void> {
  for (const [index, relation] of graph.relations.entries()) {
    if (index % 256 === 0) yield;
    const { relation_id: identifier, ...semantic } = relation;
    if (
      identifier !==
      "jsrg_relation_" +
        digestCanonicalValue(semantic, "JavaScript semantic graph")
    )
      context.addIssue({
        code: "custom",
        path: ["relations", index, "relation_id"],
        message: "Relation identifier is stale",
      });
    if (
      !nodes.has(relation.source_node_id) ||
      !nodes.has(relation.target_node_id)
    )
      context.addIssue({
        code: "custom",
        path: ["relations", index],
        message: "Relation endpoints must name semantic nodes",
      });
    if (relation.source_node_id === relation.target_node_id)
      context.addIssue({
        code: "custom",
        path: ["relations", index],
        message: "Semantic relations cannot be self-referential",
      });
    if (
      relation.resolution === "candidate" &&
      evidenceContexts.get(relation.evidence.context_id)?.state === "observed"
    )
      context.addIssue({
        code: "custom",
        path: ["relations", index, "evidence", "state"],
        message: "Candidate relations cannot claim observed resolution",
      });
  }
}

function* checkUnknownsSteps(
  graph: GraphRecord,
  nodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>,
  evidenceContexts: ReadonlyMap<string, JavaScriptSemanticEvidenceContext>,
  context: GraphIssueReporter,
): Generator<void> {
  for (const [index, unknown] of graph.unknowns.entries()) {
    if (index % 256 === 0) yield;
    const { unknown_id: identifier, ...semantic } = unknown;
    if (
      identifier !==
      "jsrg_unknown_" +
        digestCanonicalValue(semantic, "JavaScript semantic graph")
    )
      context.addIssue({
        code: "custom",
        path: ["unknowns", index, "unknown_id"],
        message: "Unknown frontier identifier is stale",
      });
    if (unknown.node_id !== null && !nodes.has(unknown.node_id))
      context.addIssue({
        code: "custom",
        path: ["unknowns", index, "node_id"],
        message: "Unknown frontier node is absent",
      });
    if (unknown.candidate_node_ids.some((nodeId) => !nodes.has(nodeId)))
      context.addIssue({
        code: "custom",
        path: ["unknowns", index, "candidate_node_ids"],
        message: "Unknown frontier candidate node is absent",
      });
    if (
      unknown.relation_kinds.some(
        (kind) => JAVASCRIPT_SEMANTIC_RELATION_FAMILY[kind] !== unknown.family,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["unknowns", index, "relation_kinds"],
        message: "Unknown relation kinds must belong to their declared family",
      });
    const evidenceState = evidenceContexts.get(
      unknown.evidence.context_id,
    )?.state;
    if (evidenceState !== "unknown" && evidenceState !== "unavailable")
      context.addIssue({
        code: "custom",
        path: ["unknowns", index, "evidence", "state"],
        message: "Unknown frontiers require unknown or unavailable evidence",
      });
  }
}

const checkUnknownReferences = (
  graph: GraphRecord,
  context: GraphIssueReporter,
): void => {
  const unknownIds = new Set(
    graph.unknowns.map(({ unknown_id }) => unknown_id),
  );
  for (const [index, family] of graph.coverage.families.entries())
    if (family.unknown_ids.some((identifier) => !unknownIds.has(identifier)))
      context.addIssue({
        code: "custom",
        path: ["coverage", "families", index, "unknown_ids"],
        message: "Family coverage references an absent unknown frontier",
      });
};

function* checkFingerprintsSteps(
  graph: GraphRecord,
  nodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>,
  context: GraphIssueReporter,
): Generator<void> {
  for (const [index, fingerprint] of graph.fingerprints.entries()) {
    if (index % 256 === 0) yield;
    if (nodes.get(fingerprint.function_node_id)?.kind !== "function")
      context.addIssue({
        code: "custom",
        path: ["fingerprints", index, "function_node_id"],
        message: "Fingerprint must name a function node",
      });
    if (
      fingerprint.fingerprint_sha256 !==
      digestCanonicalValue(fingerprint.components, "JavaScript semantic graph")
    )
      context.addIssue({
        code: "custom",
        path: ["fingerprints", index, "fingerprint_sha256"],
        message: "Fingerprint component commitment is stale",
      });
    const expectedIdentifier =
      "jsrg_fingerprint_" +
      digestCanonicalValue(
        {
          function_node_id: fingerprint.function_node_id,
          algorithm: fingerprint.algorithm,
          fingerprint_sha256: fingerprint.fingerprint_sha256,
        },
        "JavaScript semantic graph",
      );
    if (fingerprint.fingerprint_id !== expectedIdentifier)
      context.addIssue({
        code: "custom",
        path: ["fingerprints", index, "fingerprint_id"],
        message: "Fingerprint identifier is stale",
      });
    if (
      fingerprint.status !== "complete" &&
      fingerprint.limitations.length === 0
    )
      context.addIssue({
        code: "custom",
        path: ["fingerprints", index, "limitations"],
        message: "Incomplete fingerprints require a limitation",
      });
  }
}

function* checkGraphContentSteps(
  graph: GraphRecord,
  context: GraphIssueReporter,
): Generator<void> {
  checkCanonicalOrder(graph, context);
  yield* checkEvidenceContextReferencesSteps(graph, context);
  const evidenceContexts = new Map(
    graph.evidence_contexts.map((evidenceContext) => [
      evidenceContext.context_id,
      evidenceContext,
    ]),
  );
  const nodes = new Map<string, JavaScriptSemanticGraphNode>();
  for (const [index, node] of graph.nodes.entries()) {
    if (index % 256 === 0) yield;
    nodes.set(node.node_id, node);
  }
  yield* checkNodesSteps(graph, nodes, context);
  yield* checkRootsSteps(graph, nodes, context);
  yield* checkRelationsSteps(graph, nodes, evidenceContexts, context);
  yield* checkUnknownsSteps(graph, nodes, evidenceContexts, context);
  checkUnknownReferences(graph, context);
  yield* checkFingerprintsSteps(graph, nodes, context);
  yield* checkCoverageSteps(graph, context);
  if (graph.coverage.status !== "complete" && graph.limitations.length === 0)
    context.addIssue({
      code: "custom",
      path: ["limitations"],
      message: "Non-complete graph coverage requires a limitation",
    });
}

const checkGraphContent = (
  graph: GraphRecord,
  context: GraphIssueReporter,
): void => {
  const steps = checkGraphContentSteps(graph, context);
  while (!steps.next().done) {
    // Synchronous callers apply the same integrity checks without scheduling.
  }
};

const checkGraph = (graph: GraphRecord, context: GraphIssueReporter): void => {
  checkGraphContent(graph, context);
  const { graph_id: identifier, ...semantic } = graph;
  if (
    identifier !==
    "jsrg_" + digestCanonicalValue(semantic, "JavaScript semantic graph")
  )
    context.addIssue({
      code: "custom",
      path: ["graph_id"],
      message: "Graph identifier is stale",
    });
};

/** Strict semantic graph schema with verified canonical commitments. */
export const javaScriptSemanticGraphSchema =
  javaScriptSemanticGraphRecordSchema.superRefine(checkGraph);

/** Fully validated JavaScript Semantic Relation Graph. */
export type JavaScriptSemanticGraph = z.infer<
  typeof javaScriptSemanticGraphSchema
>;

/** Resolve one fact's compact provenance without changing its stored shape. */
export const resolveJavaScriptSemanticEvidence = (
  graph: Pick<JavaScriptSemanticGraph, "evidence_contexts">,
  reference: JavaScriptSemanticEvidenceReference,
): ApplicationGraphEvidence => {
  const context = graph.evidence_contexts.find(
    ({ context_id }) => context_id === reference.context_id,
  );
  if (context === undefined)
    throw new TypeError("Semantic evidence reference names an absent context");
  const { context_id: _contextId, ...evidenceContext } = context;
  return { ...evidenceContext, location: reference.location };
};

const normalizeGraphInput = (
  parsed: JavaScriptSemanticGraphInput,
): JavaScriptSemanticGraphInput => ({
  ...parsed,
  root_node_ids: uniqueSorted(parsed.root_node_ids),
  evidence_contexts: [...parsed.evidence_contexts].sort((left, right) =>
    compareUnicodeCodePoints(left.context_id, right.context_id),
  ),
  nodes: [...parsed.nodes].sort((left, right) =>
    compareUnicodeCodePoints(left.node_id, right.node_id),
  ),
  relations: [...parsed.relations].sort((left, right) =>
    compareUnicodeCodePoints(left.relation_id, right.relation_id),
  ),
  fingerprints: [...parsed.fingerprints].sort((left, right) =>
    compareUnicodeCodePoints(left.fingerprint_id, right.fingerprint_id),
  ),
  unknowns: [...parsed.unknowns].sort((left, right) =>
    compareUnicodeCodePoints(left.unknown_id, right.unknown_id),
  ),
  coverage: {
    ...parsed.coverage,
    limits: [...parsed.coverage.limits].sort((left, right) =>
      compareUnicodeCodePoints(
        canonicalJson(left, "JavaScript semantic graph"),
        canonicalJson(right, "JavaScript semantic graph"),
      ),
    ),
    ...(parsed.coverage.omitted_unknown_occurrences === undefined
      ? {}
      : {
          omitted_unknown_occurrences: [
            ...parsed.coverage.omitted_unknown_occurrences,
          ].sort((left, right) =>
            compareUnicodeCodePoints(
              `${left.family}:${left.reason}`,
              `${right.family}:${right.reason}`,
            ),
          ),
        }),
    families: [...parsed.coverage.families]
      .map((family) => ({
        ...family,
        unknown_ids: uniqueSorted(family.unknown_ids),
      }))
      .sort((left, right) =>
        compareUnicodeCodePoints(left.family, right.family),
      ),
  },
  limitations: uniqueSorted(parsed.limitations),
});

/** Normalize a complete companion graph and derive its graph ID. */
export const createJavaScriptSemanticGraph = (
  input: unknown,
): JavaScriptSemanticGraph => {
  const semantic = normalizeGraphInput(
    javaScriptSemanticGraphInputSchema.parse(input),
  );
  // The input schema already cloned and validated every field. Validate the
  // normalized relationships in place, then derive the only added field. The
  // public schema still verifies arbitrary records and their commitments.
  const record: GraphRecord = {
    ...semantic,
    graph_id: `jsrg_${digestCanonicalValue(semantic, "JavaScript semantic graph")}`,
  };
  const issues: SemanticGraphIssue[] = [];
  checkGraphContent(record, {
    addIssue: (issue) => {
      issues.push(issue);
    },
  });
  if (issues.length > 0) throw new z.ZodError(issues);
  return record;
};

const validatedImmutableSemanticGraphs = new WeakSet<object>();

const semanticGraphShape = javaScriptSemanticGraphInputSchema.shape;
const semanticGraphContainerSchema = javaScriptSemanticGraphInputSchema.extend({
  evidence_contexts: arrayContainerSchema(semanticGraphShape.evidence_contexts),
  nodes: arrayContainerSchema(semanticGraphShape.nodes),
  relations: arrayContainerSchema(semanticGraphShape.relations),
  fingerprints: arrayContainerSchema(semanticGraphShape.fingerprints),
  unknowns: arrayContainerSchema(semanticGraphShape.unknowns),
});

/** Clone input synchronously; commit, check and seal the owned graph in steps. */
export const createImmutableJavaScriptSemanticGraphSteps = (
  input: unknown,
): Generator<void, JavaScriptSemanticGraph> =>
  validateAndSealSemanticGraphSteps(
    normalizeGraphInput(javaScriptSemanticGraphInputSchema.parse(input)),
  );

/**
 * Seal a graph whose input the caller transfers: the caller neither retains nor
 * mutates any part of it afterwards. Only the graph's own fields are validated
 * synchronously; collection elements are validated and cloned in steps, because
 * a whole-graph parse of a large application held the event loop for seconds.
 */
export const sealTransferredJavaScriptSemanticGraphSteps = (
  input: unknown,
): Generator<void, JavaScriptSemanticGraph> =>
  parseAndSealSemanticGraphSteps(semanticGraphContainerSchema.parse(input));

function* parseAndSealSemanticGraphSteps(
  container: z.output<typeof semanticGraphContainerSchema>,
): Generator<void, JavaScriptSemanticGraph> {
  const issues: z.core.$ZodIssue[] = [];
  const parsed: JavaScriptSemanticGraphInput = {
    ...container,
    evidence_contexts: yield* parseElementSteps(
      semanticGraphShape.evidence_contexts.element,
      container.evidence_contexts,
      ["evidence_contexts"],
      issues,
    ),
    nodes: yield* parseElementSteps(
      semanticGraphShape.nodes.element,
      container.nodes,
      ["nodes"],
      issues,
    ),
    relations: yield* parseElementSteps(
      semanticGraphShape.relations.element,
      container.relations,
      ["relations"],
      issues,
    ),
    fingerprints: yield* parseElementSteps(
      semanticGraphShape.fingerprints.element,
      container.fingerprints,
      ["fingerprints"],
      issues,
    ),
    unknowns: yield* parseElementSteps(
      semanticGraphShape.unknowns.element,
      container.unknowns,
      ["unknowns"],
      issues,
    ),
  };
  if (issues.length > 0) throw new z.ZodError(issues);
  return yield* validateAndSealSemanticGraphSteps(normalizeGraphInput(parsed));
}

function* validateAndSealSemanticGraphSteps(
  semantic: JavaScriptSemanticGraphInput,
): Generator<void, JavaScriptSemanticGraph> {
  const graph: GraphRecord = {
    ...semantic,
    graph_id: `jsrg_${yield* canonicalJsonDigestSteps(semantic)}`,
  };
  const issues: SemanticGraphIssue[] = [];
  yield* checkGraphContentSteps(graph, {
    addIssue: (issue) => {
      issues.push(issue);
    },
  });
  if (issues.length > 0) throw new z.ZodError(issues);
  yield* freezeOwnedJsonSnapshotSteps(graph);
  validatedImmutableSemanticGraphs.add(graph);
  return graph;
}

/** Recognize the exact completely sealed graph produced by the owned factory. */
export const isValidatedImmutableJavaScriptSemanticGraph = (
  value: unknown,
): value is JavaScriptSemanticGraph =>
  typeof value === "object" &&
  value !== null &&
  validatedImmutableSemanticGraphs.has(value);
