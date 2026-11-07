import {
  createJavaScriptSemanticGraph,
  sealTransferredJavaScriptSemanticGraphSteps,
  type JavaScriptSemanticGraph,
} from "../../domain/javascript/javascriptSemanticGraph.js";
import type {
  JavaScriptSemanticFingerprint,
  JavaScriptSemanticGraphNode,
} from "../../domain/javascript/javascriptSemanticGraphSchemas.js";
import {
  JAVASCRIPT_SEMANTIC_RELATION_FAMILIES,
  JAVASCRIPT_SEMANTIC_RELATION_FAMILY,
  JAVASCRIPT_SEMANTIC_RELATIONS,
} from "../../domain/javascript/javascriptSemanticGraphSchemas.js";
import type {
  JavaScriptSemanticCallArgument,
  JavaScriptSemanticCallReturnFlow,
  JavaScriptSemanticIr,
} from "../../domain/javascript/javascriptSemanticIr.js";
import { sourceRangesEqual as rangesEqual } from "../../domain/javascript/javascriptStaticAnalysisHelpers.js";
import { javascriptSourceRangeKey } from "../../domain/javascript/javascriptSourceCoordinates.js";
import type { JavaScriptApplicationGraph } from "../../domain/javascript/javascriptApplicationGraph.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import {
  projectSemanticEvents,
  projectSemanticTimers,
} from "./JavaScriptSemanticGraphAsyncProjection.js";
import { projectSemanticChildProcesses } from "./JavaScriptSemanticGraphChildProcessProjection.js";
import {
  projectSemanticBoundaries,
  projectSemanticConfiguration,
  projectSemanticRequests,
} from "./JavaScriptSemanticGraphDataProjection.js";
import { projectSemanticResources } from "./JavaScriptSemanticGraphResourceProjection.js";
import { projectSemanticAssignments } from "./JavaScriptSemanticGraphAssignmentProjection.js";
import { projectSemanticExpressionInfluence } from "./JavaScriptSemanticGraphExpressionProjection.js";
import { projectSemanticObjects } from "./JavaScriptSemanticGraphObjectProjection.js";
import { projectSemanticValues } from "./JavaScriptSemanticGraphValueProjection.js";
import {
  inferredSemanticEvidenceAt,
  observedSemanticEvidence,
  unknownSemanticEvidence,
} from "./JavaScriptSemanticGraphEvidence.js";
import {
  RETURNED_REFERENCE_WIDENING_LIMITATION,
  semanticCoverageResourceLimits,
  semanticResourceLimitCoverage,
} from "../../domain/javascript/javascriptSemanticCoverage.js";
import { semanticResourceLimitReason } from "../../domain/javascript/javascriptSemanticResourceLimits.js";
import {
  partialApplicationCoverage,
  type ApplicationCoverage,
} from "../../domain/javascript/javascriptApplicationEvidenceSchemas.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import {
  JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS,
  JAVASCRIPT_ANALYSIS_TRANSFER_RECORD_BYTES,
  JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM,
  javaScriptAnalysisCoverageLimits,
  javaScriptSemanticCeilingCoverage,
} from "../../domain/javascript/javascriptAnalysisResourceControls.js";
import { projectSemanticFunctionFingerprints } from "./JavaScriptSemanticGraphFingerprintProjection.js";
import {
  projectSemanticClosureCaptures,
  projectSemanticFrontiers,
  projectSemanticPromises,
  projectSemanticReturnValues,
  semanticObjectReadOccurrence,
  type SemanticFlowProjectionContext,
} from "./JavaScriptSemanticGraphFlowProjection.js";
import {
  createSemanticCallableOwnerLookup,
  createSemanticCallSiteLookup,
  createSemanticNodeRangeLookup,
  semanticFamilyStatus,
} from "./JavaScriptSemanticGraphProjection.js";
import {
  constructSemanticGraphNode,
  addSemanticFallbackRoot as addFallbackRoot,
  addSemanticGraphUnknown,
  recordSemanticUnknownOmission,
  retainSemanticGraphNode as retainNode,
  addSemanticGraphRelation as addRelation,
  createSemanticGraphProjectionState as emptyState,
  bindSemanticGraphApplicationNodes,
  type SemanticGraphProjectionState as BuilderState,
} from "./JavaScriptSemanticGraphConstruction.js";
import type {
  JavaScriptSemanticFileProjection,
  JavaScriptSemanticProjectionCapacity,
} from "../../domain/javascript/javascriptSemanticFileProjection.js";
import type { ElectronCallPath } from "../../domain/javascript/electronStaticAnalysisTypes.js";
import { projectElectronSemanticCallPaths } from "./JavaScriptSemanticGraphElectronProjection.js";

type ApplicationGraph = Pick<JavaScriptApplicationGraph, "graph_id" | "nodes">;

interface FileContext extends SemanticFlowProjectionContext {
  readonly file: JavaScriptArtifactFile;
  readonly ir: JavaScriptSemanticIr;
  readonly state: BuilderState;
  readonly moduleNode: JavaScriptSemanticGraphNode;
  readonly bindingNodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>;
  readonly callableNodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>;
  readonly callSiteNodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>;
  readonly returnSiteNodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>;
  readonly argumentNodes: Map<string, JavaScriptSemanticGraphNode>;
  readonly referenceNodes: JavaScriptSemanticGraphNode[];
  readonly callResolutions: ReadonlyMap<string, "candidate" | "resolved">;
  readonly callableOwnerAt: ReturnType<
    typeof createSemanticCallableOwnerLookup
  >;
}

/**
 * Resource-safety ceiling on retained semantic nodes.
 *
 * The semantic projection emits one node per AST expression, call site, binding
 * and property slot. That is unbounded in input size. A small tree of five files
 * already yields on the order of 170,000 nodes, and larger trees yield millions,
 * exhausting the heap before the result can be serialized.
 *
 * This is a real resource-safety constraint, not a presentation preference, so
 * the ceiling is applied and reported through the graph's own `coverage` fields
 * (`truncated`, `omitted_nodes`, `omitted_relations`, `limits`) rather than
 * silently dropping data.
 *
 * Defaults bound work even when ample heap is available. Callers may raise the
 * capacities explicitly; isolated worker heap, bounded record transport and
 * parent result admission independently constrain actual retained memory. The
 * result uses incremental serialization rather than a single JSON string.
 */
export const SEMANTIC_GRAPH_NODE_CEILING =
  JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS.semanticNodes;

/**
 * Per-file share of the semantic node budget.
 *
 * Bound each source file independently so one large bundled library cannot
 * consume the whole tree's budget and starve the application's own modules.
 */
export const SEMANTIC_GRAPH_FILE_NODE_CEILING =
  JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS.semanticNodesPerFile;

/** File-local semantic projection that does not retain consumed source IR. */
export interface JavaScriptSemanticGraphProjection {
  /** Node capacity offered to the next independently analyzed source file. */
  readonly remainingFileCapacity: () => JavaScriptSemanticProjectionCapacity;
  /** Adopt decoded file-local facts; final validation and proof remain in this realm. */
  readonly adoptFileProjection: (
    projection: JavaScriptSemanticFileProjection,
  ) => void;
  /** Preserve JavaScript-source unknowns; other file kinds have no semantic module. */
  readonly recordUnavailableFile: (
    file: JavaScriptArtifactFile,
    reason: string,
    limits: Readonly<Record<string, JsonValue>> | null,
    unknownReason: "resource-limit" | "incomplete-module",
  ) => void;
  readonly projectFile: (
    file: JavaScriptArtifactFile,
    ir: JavaScriptSemanticIr,
    paths?: readonly ElectronCallPath[],
  ) => void;
  /** Project one file in steps between its projection passes. */
  readonly projectFileSteps: (
    file: JavaScriptArtifactFile,
    ir: JavaScriptSemanticIr,
    paths?: readonly ElectronCallPath[],
  ) => Generator<void, void>;
  readonly finish: (
    rootArtifactSha256: string,
    applicationGraph: ApplicationGraph,
  ) => JavaScriptSemanticGraph;
  readonly finishImmutableSteps: (
    rootArtifactSha256: string,
    applicationGraph: ApplicationGraph,
  ) => Generator<void, JavaScriptSemanticGraph>;
}

/** Ceilings whose offered budget actually stopped retention. */
interface SemanticCeilingReached {
  total: boolean;
  perFile: boolean;
}

/**
 * Attribute a drop to the ceiling that bound this file's offer.
 *
 * The offer is the minimum of the per-file ceiling and the remaining
 * application room. Only that smaller ceiling stopped retention. When the
 * two values are equal, both did.
 */
const noteSemanticCeilingReached = (
  reached: SemanticCeilingReached,
  totalRoom: number,
  perFileCeiling: number,
): void => {
  if (perFileCeiling <= totalRoom) reached.perFile = true;
  if (totalRoom <= perFileCeiling) reached.total = true;
};

const semanticUnknownOccurrences = (
  omissions: ReadonlyMap<string, { readonly occurrences: number }>,
): number => {
  let count = 0;
  for (const omission of omissions.values()) count += omission.occurrences;
  return count;
};

/** Accumulate semantic nodes while each source IR is still file-local. */
export const createJavaScriptSemanticGraphProjection = (
  limits: {
    readonly totalNodes?: number;
    readonly fileNodes?: number;
    readonly totalUnknowns?: number;
    readonly fileUnknowns?: number;
  } = {},
): JavaScriptSemanticGraphProjection => {
  const nodeCeiling = limits.totalNodes ?? SEMANTIC_GRAPH_NODE_CEILING;
  const fileNodeCeiling = limits.fileNodes ?? SEMANTIC_GRAPH_FILE_NODE_CEILING;
  const unknownCeiling =
    limits.totalUnknowns ??
    JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS.semanticUnknowns;
  const fileUnknownCeiling =
    limits.fileUnknowns ??
    JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS.semanticUnknownsPerFile;
  for (const value of [
    nodeCeiling,
    fileNodeCeiling,
    unknownCeiling,
    fileUnknownCeiling,
  ])
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM
    )
      throw new RangeError("Semantic graph requires valid retained capacities");
  const state = emptyState();
  const fingerprints: JavaScriptSemanticFingerprint[] = [];
  let truncatedFiles = 0;
  let unavailableFiles = 0;
  let resourceTruncatedFiles = 0;
  const nodeCeilingsReached: SemanticCeilingReached = {
    total: false,
    perFile: false,
  };
  const unknownCeilingsReached: SemanticCeilingReached = {
    total: false,
    perFile: false,
  };
  const executionLimits = new Map<
    string,
    ApplicationCoverage["limits"][number]
  >();
  const projectSourceSteps = function* (
    file: JavaScriptArtifactFile,
    ir: JavaScriptSemanticIr,
    paths: readonly ElectronCallPath[] = [],
  ): Generator<void, void> {
    if (state.nodes.size >= nodeCeiling) {
      truncatedFiles += 1;
      noteSemanticCeilingReached(
        nodeCeilingsReached,
        nodeCeiling - state.nodes.size,
        fileNodeCeiling,
      );
      return;
    }
    const remainingTreeBudget = nodeCeiling - state.nodes.size;
    const unknownsBefore = state.unknowns.size;
    const omissionsBefore = semanticUnknownOccurrences(state.unknownOmissions);
    state.fileNodeBudget = Math.min(fileNodeCeiling, remainingTreeBudget);
    state.fileNodesDropped = false;
    state.unknownCapacity = Math.min(
      unknownCeiling,
      unknownsBefore + fileUnknownCeiling,
    );
    fingerprints.push(...(yield* projectFileSteps(file, ir, state, paths)));
    // Nodes were dropped only if the budget actually blocked creation. A file
    // that exactly fills its share ends with a zero budget without dropping
    // anything, so the remaining budget alone cannot decide truncation.
    if (state.fileNodesDropped) {
      truncatedFiles += 1;
      noteSemanticCeilingReached(
        nodeCeilingsReached,
        remainingTreeBudget,
        fileNodeCeiling,
      );
    }
    if (semanticUnknownOccurrences(state.unknownOmissions) > omissionsBefore)
      noteSemanticCeilingReached(
        unknownCeilingsReached,
        unknownCeiling - unknownsBefore,
        fileUnknownCeiling,
      );
    state.fileNodeBudget = null;
    state.unknownCapacity = null;
  };
  const finishWith = <Value>(
    factory: (input: unknown) => Value,
    rootArtifactSha256: string,
    applicationGraph: ApplicationGraph,
  ): Value => {
    bindSemanticGraphApplicationNodes(state, applicationGraph);
    if (state.roots.size === 0) addFallbackRoot(rootArtifactSha256, state);
    const relations = [...state.relations.values()];
    const unknowns = [...state.unknowns.values()];
    const unknownOmissions = [...state.unknownOmissions.values()];
    const unknownsDropped = unknownOmissions.length > 0;
    type Family = (typeof JAVASCRIPT_SEMANTIC_RELATION_FAMILIES)[number];
    const retainedByFamily = new Map<Family, number>();
    const unknownIdsByFamily = new Map<Family, string[]>();
    for (const relation of relations) {
      const family = JAVASCRIPT_SEMANTIC_RELATION_FAMILY[relation.relation];
      retainedByFamily.set(family, (retainedByFamily.get(family) ?? 0) + 1);
    }
    for (const unknown of unknowns) {
      const identifiers = unknownIdsByFamily.get(unknown.family);
      if (identifiers === undefined)
        unknownIdsByFamily.set(unknown.family, [unknown.unknown_id]);
      else identifiers.push(unknown.unknown_id);
    }
    const unknownCeilingCoverage = unknownsDropped
      ? javaScriptSemanticCeilingCoverage(
          "unknowns",
          unknownCeiling,
          fileUnknownCeiling,
          unknownCeilingsReached,
        )
      : undefined;
    const nodeCeilingCoverage =
      truncatedFiles > 0
        ? javaScriptSemanticCeilingCoverage(
            "nodes",
            nodeCeiling,
            fileNodeCeiling,
            nodeCeilingsReached,
          )
        : undefined;
    const graph = factory({
      schema: "JavaScriptSemanticRelationGraph",
      root_artifact_sha256: rootArtifactSha256,
      application_graph_id: applicationGraph.graph_id,
      root_node_ids: [...state.roots],
      evidence_contexts: state.evidenceContexts.contexts,
      nodes: [...state.nodes.values()],
      relations,
      // The input is transferred to the factory; `fingerprints` is cleared below.
      fingerprints: [...fingerprints],
      unknowns,
      coverage: {
        status:
          truncatedFiles > 0 || unavailableFiles > 0 || unknownsDropped
            ? "partial"
            : "unknown",
        truncated:
          truncatedFiles > 0 || resourceTruncatedFiles > 0 || unknownsDropped,
        ...(unknownsDropped
          ? { omitted_unknown_occurrences: unknownOmissions }
          : {}),
        omitted_nodes: truncatedFiles > 0 || unavailableFiles > 0 ? null : 0,
        omitted_relations:
          truncatedFiles > 0 || unavailableFiles > 0 ? null : 0,
        limits: [
          ...executionLimits.values(),
          ...(unknownCeilingCoverage?.limits ?? []),
          ...(nodeCeilingCoverage?.limits ?? []),
        ],
        families: JAVASCRIPT_SEMANTIC_RELATION_FAMILIES.map((family) => ({
          family,
          status: semanticFamilyStatus(family),
          retained_relations: retainedByFamily.get(family) ?? 0,
          omitted_relations:
            truncatedFiles > 0 || unavailableFiles > 0 ? null : 0,
          unknown_ids: unknownIdsByFamily.get(family) ?? [],
        })),
      },
      limitations: [
        ...(unknownCeilingCoverage === undefined
          ? []
          : [
              `${unknownCeilingCoverage.limitation} Omission coverage counts examined emission occurrences by family and reason, including repeats; it does not count unexamined source frontiers or distinct discarded identities.`,
            ]),
        ...(nodeCeilingCoverage === undefined
          ? []
          : [nodeCeilingCoverage.limitation]),
        "The semantic graph contains static syntax observations and conservative relationship candidates; it does not claim runtime execution.",
        "Local data flow does not claim control-flow-sensitive reaching definitions or arbitrary dynamic property resolution.",
        "Promise ownership covers explicit unshadowed Promise construction, static factories, aggregation, chaining, and await syntax only.",
        "Function fingerprints are static candidates; equal digests can remain ambiguous and do not prove behavioral equivalence.",
        "Event extraction covers EventEmitter-style literal registrations, removals, and dispatch candidates; dynamic names remain unknown.",
        "Timer extraction covers global or node:timers scheduling and exact local-handle cancellation.",
        "Child-process extraction covers asynchronous node:child_process creation, literal argv/env/stdio options, exit/error listeners, and kill signals.",
        "Configuration extraction covers process.env, process.argv, node:fs reads, and direct logical defaults.",
        "Request extraction covers fetch, WebSocket, node:http/node:https construction, direct option fields, and exact local response consumers.",
        "Boundary extraction covers unshadowed JSON/global coercions plus parse and validation method candidates.",
        "Resource extraction covers built-in filesystem/network acquisition and exact local close/destroy/end handles.",
      ],
    });
    state.nodes.clear();
    state.relations.clear();
    state.unknowns.clear();
    state.unknownOmissions.clear();
    state.roots.clear();
    state.evidenceContexts.clear();
    fingerprints.length = 0;
    return graph;
  };
  return {
    remainingFileCapacity: () => ({
      nodes: Math.min(
        fileNodeCeiling,
        Math.max(0, nodeCeiling - state.nodes.size),
      ),
      unknowns: Math.min(
        fileUnknownCeiling,
        Math.max(0, unknownCeiling - state.unknowns.size),
      ),
    }),
    adoptFileProjection: (projection) => {
      // Production offers remainingFileCapacity(), already the minimum of
      // the per-file ceiling and the room left in the application total.
      const remainingNodes = nodeCeiling - state.nodes.size;
      const remainingUnknowns = unknownCeiling - state.unknowns.size;
      const newNodes = projection.nodes.filter(
        ({ node_id }) => !state.nodes.has(node_id),
      );
      if (
        newNodes.length >
        Math.min(fileNodeCeiling, nodeCeiling - state.nodes.size)
      )
        throw new RangeError(
          "Transferred semantic nodes exceed the offered tree capacity",
        );
      const newUnknowns = projection.unknowns.filter(
        ({ unknown_id }) => !state.unknowns.has(unknown_id),
      );
      if (
        newUnknowns.length >
        Math.min(fileUnknownCeiling, unknownCeiling - state.unknowns.size)
      )
        throw new RangeError(
          "Transferred semantic unknowns exceed the offered tree capacity",
        );
      for (const omission of projection.omittedUnknownOccurrences ?? [])
        recordSemanticUnknownOmission(state, omission);
      for (const context of projection.evidenceContexts)
        state.evidenceContexts.adopt(context);
      for (const node of newNodes) state.nodes.set(node.node_id, node);
      for (const relation of projection.relations)
        state.relations.set(relation.relation_id, relation);
      for (const unknown of newUnknowns)
        state.unknowns.set(unknown.unknown_id, unknown);
      for (const root of projection.roots) state.roots.add(root);
      fingerprints.push(...projection.fingerprints);
      if (projection.nodesTruncated) {
        truncatedFiles += 1;
        noteSemanticCeilingReached(
          nodeCeilingsReached,
          remainingNodes,
          fileNodeCeiling,
        );
      }
      if ((projection.omittedUnknownOccurrences?.length ?? 0) > 0)
        noteSemanticCeilingReached(
          unknownCeilingsReached,
          remainingUnknowns,
          fileUnknownCeiling,
        );
    },
    recordUnavailableFile: (file, reason, limits, unknownReason) => {
      // Both full and incremental construction enter here. Metadata/native
      // processing gaps belong to the application graph, never JavaScript IR.
      if (file.kind !== "javascript") return;
      const retainedLimits = javaScriptAnalysisCoverageLimits(limits);
      for (const limit of retainedLimits) {
        executionLimits.set(
          JSON.stringify([limit.name, limit.value, limit.unit]),
          limit,
        );
      }
      state.fileNodeBudget = Math.min(
        fileNodeCeiling,
        Math.max(0, nodeCeiling - state.nodes.size),
      );
      const module = retainNode(state, file, {
        kind: "module",
        roleKey: "module",
        location: null,
        label: file.path,
        functionNodeId: null,
      });
      state.fileNodeBudget = null;
      if (module !== null) state.roots.add(module.node_id);
      const evidence = {
        ...observedSemanticEvidence(file, null),
        authority: "unknown" as const,
        state: "unknown" as const,
        confidence: "unknown" as const,
        coverage: partialApplicationCoverage(retainedLimits, null),
        limitations: [reason],
      };
      const unknownsBefore = state.unknowns.size;
      const omissionsBefore = semanticUnknownOccurrences(
        state.unknownOmissions,
      );
      state.unknownCapacity = Math.min(
        unknownCeiling,
        unknownsBefore + fileUnknownCeiling,
      );
      for (const family of JAVASCRIPT_SEMANTIC_RELATION_FAMILIES) {
        addSemanticGraphUnknown(state, {
          node_id: module?.node_id ?? null,
          family,
          relation_kinds: JAVASCRIPT_SEMANTIC_RELATIONS.filter(
            (relation) =>
              JAVASCRIPT_SEMANTIC_RELATION_FAMILY[relation] === family,
          ),
          reason: unknownReason,
          detail: reason,
          candidate_node_ids: [],
          evidence,
        });
      }
      state.unknownCapacity = null;
      if (semanticUnknownOccurrences(state.unknownOmissions) > omissionsBefore)
        noteSemanticCeilingReached(
          unknownCeilingsReached,
          unknownCeiling - unknownsBefore,
          fileUnknownCeiling,
        );
      unavailableFiles += 1;
      if (unknownReason === "resource-limit" && retainedLimits.length > 0)
        resourceTruncatedFiles += 1;
    },
    projectFile: (file, ir, paths) => {
      const steps = projectSourceSteps(file, ir, paths);
      while (steps.next().done !== true);
    },
    projectFileSteps: projectSourceSteps,
    finish: (rootArtifactSha256, applicationGraph) =>
      finishWith(
        createJavaScriptSemanticGraph,
        rootArtifactSha256,
        applicationGraph,
      ),
    finishImmutableSteps: (rootArtifactSha256, applicationGraph) =>
      finishWith(
        sealTransferredJavaScriptSemanticGraphSteps,
        rootArtifactSha256,
        applicationGraph,
      ),
  };
};

/** Project one source with the parent's remaining retained capacities, retaining no full IR. */
export function* projectJavaScriptSemanticFileSteps(
  file: JavaScriptArtifactFile,
  ir: JavaScriptSemanticIr,
  capacity: JavaScriptSemanticProjectionCapacity,
  paths: readonly ElectronCallPath[] = [],
): Generator<void, JavaScriptSemanticFileProjection> {
  if (
    [capacity.nodes, capacity.unknowns].some(
      (value) =>
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM,
    )
  )
    throw new RangeError(
      "File semantic projection requires valid offered retained capacities",
    );
  const state = emptyState();
  state.fileNodeBudget = capacity.nodes;
  state.unknownCapacity = capacity.unknowns;
  state.fileNodesDropped = false;
  const fingerprints = yield* projectFileSteps(file, ir, state, paths);
  return {
    roots: [...state.roots],
    evidenceContexts: state.evidenceContexts.contexts,
    nodes: [...state.nodes.values()],
    relations: [...state.relations.values()],
    unknowns: [...state.unknowns.values()],
    fingerprints,
    ...(state.unknownOmissions.size > 0
      ? { omittedUnknownOccurrences: [...state.unknownOmissions.values()] }
      : {}),
    nodesTruncated: Boolean(state.fileNodesDropped),
  };
}

function* projectFileSteps(
  file: JavaScriptArtifactFile,
  ir: JavaScriptSemanticIr,
  state: BuilderState,
  paths: readonly ElectronCallPath[] = [],
): Generator<void, JavaScriptSemanticFingerprint[]> {
  yield;
  const moduleNode = retainNode(state, file, {
    kind: "module",
    roleKey: "module",
    location: null,
    label: file.path,
    functionNodeId: null,
  });
  if (moduleNode === null) return [];
  state.roots.add(moduleNode.node_id);
  projectFileResourceLimits({ file, ir, state, moduleNode });
  for (const location of ir.coverage.widenedReturnedReferences ?? [])
    addSemanticGraphUnknown(state, {
      node_id: moduleNode.node_id,
      family: "data-flow",
      relation_kinds: ["defines"],
      reason: "dynamic-property",
      detail: RETURNED_REFERENCE_WIDENING_LIMITATION,
      candidate_node_ids: [],
      evidence: {
        ...unknownSemanticEvidence(file, location),
        limitations: [RETURNED_REFERENCE_WIDENING_LIMITATION],
      },
    });
  yield* projectElectronSemanticCallPaths(file, paths, state);
  // Node creation keeps source order, which the per-file node budget relies
  // on; yields between nodes do not change it.
  const callableNodes = new Map<string, JavaScriptSemanticGraphNode>();
  for (const [index, callable] of ir.callables.entries()) {
    if (index % 64 === 0) yield;
    const node = retainNode(state, file, {
      kind: "function",
      roleKey: `callable:${callable.callableId}`,
      location: callable.location,
      label: callable.name,
      functionNodeId: null,
      // The label is display text; keep the exact name, which may be "".
      properties: { name: callable.name },
    });
    if (node !== null) callableNodes.set(callable.callableId, node);
  }
  const callableOwnerAt = createSemanticCallableOwnerLookup(ir, callableNodes);
  const bindingNodes = new Map<string, JavaScriptSemanticGraphNode>();
  for (const [index, binding] of ir.bindings.entries()) {
    if (index % 64 === 0) yield;
    const location = binding.definitions[0]?.location ?? null;
    const kind = binding.kind === "parameter" ? "parameter" : "binding";
    const owner = callableOwnerAt(location);
    const node = retainNode(state, file, {
      kind,
      roleKey: `binding:${binding.bindingId}`,
      location,
      label: binding.name,
      functionNodeId: owner?.node_id ?? null,
    });
    if (node !== null) bindingNodes.set(binding.bindingId, node);
  }
  const returnSiteNodes = yield* createReturnSiteNodes(
    file,
    ir,
    callableNodes,
    state,
  );
  const callSiteNodes = yield* createCallSiteNodes(
    file,
    ir,
    callableNodes,
    state,
  );
  const definitions: Omit<FileContext, "referenceNodesWithin"> = {
    file,
    ir,
    state,
    moduleNode,
    bindingNodes,
    callableNodes,
    callSiteNodes,
    returnSiteNodes,
    argumentNodes: new Map(),
    referenceNodes: [],
    readNodes: [],
    writeNodes: [],
    callResolutions: new Map(
      ir.callSites.map((call) => [
        call.callSiteId,
        call.resolution === "exact" ? "resolved" : "candidate",
      ]),
    ),
    callableOwnerAt,
    callSiteAt: createSemanticCallSiteLookup(ir, callSiteNodes),
  };
  yield* projectDefinitionsAndReferences(definitions);
  const context: FileContext = {
    ...definitions,
    referenceNodesWithin: createSemanticNodeRangeLookup(
      definitions.referenceNodes,
    ),
  };
  // Each pass completes before the next starts, so yielding between passes
  // keeps projection order and results unchanged.
  for (const project of FILE_PROJECTION_PASSES) {
    yield;
    const steps = project(context);
    if (steps !== undefined) while (steps.next().done !== true) yield;
  }
  yield;
  return projectSemanticFunctionFingerprints(
    file,
    ir,
    callableNodes,
    state.evidenceContexts,
  );
}

const projectFileResourceLimits = (
  context: Pick<FileContext, "file" | "ir" | "state" | "moduleNode">,
): void => {
  // Query limits describe effects without tagged values; other limits
  // already project from binding or return-site values and must not be duplicated.
  for (const limit of semanticCoverageResourceLimits(context.ir.coverage)) {
    if (limit !== "getter-expansion" && limit !== "alias-selections") continue;
    addSemanticGraphUnknown(context.state, {
      node_id: context.moduleNode.node_id,
      family: "data-flow",
      relation_kinds: ["defines"],
      reason: "resource-limit",
      detail: semanticResourceLimitReason(limit),
      candidate_node_ids: [],
      evidence: {
        ...unknownSemanticEvidence(context.file, null),
        coverage: partialApplicationCoverage(
          semanticResourceLimitCoverage([limit]),
          null,
        ),
        limitations: [semanticResourceLimitReason(limit)],
      },
    });
  }
};

function* createReturnSiteNodes(
  file: JavaScriptArtifactFile,
  ir: JavaScriptSemanticIr,
  callables: ReadonlyMap<string, JavaScriptSemanticGraphNode>,
  state: BuilderState,
): Generator<void, Map<string, JavaScriptSemanticGraphNode>> {
  const result = new Map<string, JavaScriptSemanticGraphNode>();
  for (const [index, callable] of ir.callables.entries()) {
    if (index % 64 === 0) yield;
    const owner = callables.get(callable.callableId);
    if (owner === undefined) continue;
    for (const site of callable.returnSites) {
      const identifier = site.returnSiteId;
      const node = retainNode(state, file, {
        kind: "return-site",
        roleKey: identifier,
        location: site.location,
        label: "return",
        functionNodeId: owner.node_id,
      });
      if (node !== null) result.set(identifier, node);
    }
  }
  return result;
}

function* createCallSiteNodes(
  file: JavaScriptArtifactFile,
  ir: JavaScriptSemanticIr,
  callables: ReadonlyMap<string, JavaScriptSemanticGraphNode>,
  state: BuilderState,
): Generator<void, Map<string, JavaScriptSemanticGraphNode>> {
  const result = new Map<string, JavaScriptSemanticGraphNode>();
  for (const [index, call] of ir.callSites.entries()) {
    if (index % 64 === 0) yield;
    const owner =
      call.callerCallableId === null
        ? null
        : (callables.get(call.callerCallableId)?.node_id ?? null);
    const nodeInput = {
      kind: "call-site" as const,
      roleKey: `call:${call.callSiteId}`,
      location: call.location,
      label: call.kind,
      functionNodeId: owner,
    };
    // Include the complete node and worker JSON envelope before retaining any
    // arguments. Each entry is charged by its encoded size and comma, so even
    // worst-case escaping cannot overflow the worker's single-record ceiling.
    let recordBytes = 0;
    if (call.arguments.some((argument) => Object.hasOwn(argument, "literal"))) {
      const baseline = constructSemanticGraphNode(file, nodeInput, state);
      recordBytes = Buffer.byteLength(
        `${JSON.stringify({ kind: "node", value: { ...baseline, properties: { arguments: [] } } })}\n`,
      );
    }
    const argumentsValue: JsonValue[] = [];
    let transferOmitted = 0;
    for (const argument of call.arguments) {
      if (!Object.hasOwn(argument, "literal")) continue;
      const item = {
        index: argument.index,
        value: argument.literal ?? null,
        source_range:
          argument.valueExpressionLocation === null
            ? null
            : {
                start: { ...argument.valueExpressionLocation.start },
                end: { ...argument.valueExpressionLocation.end },
              },
      };
      const size =
        Buffer.byteLength(JSON.stringify(item)) +
        (argumentsValue.length === 0 ? 0 : 1);
      if (recordBytes + size > JAVASCRIPT_ANALYSIS_TRANSFER_RECORD_BYTES) {
        transferOmitted += 1;
        continue;
      }
      argumentsValue.push(item);
      recordBytes += size;
    }
    const node = retainNode(state, file, {
      ...nodeInput,
      ...(argumentsValue.length === 0
        ? {}
        : { properties: { arguments: argumentsValue } }),
    });
    if (node !== null) {
      result.set(call.callSiteId, node);
      if (transferOmitted > 0) {
        const detail = `${String(transferOmitted)} direct call arguments exceeded the ${String(JAVASCRIPT_ANALYSIS_TRANSFER_RECORD_BYTES)}-byte worker transfer record ceiling.`;
        addSemanticGraphUnknown(state, {
          node_id: node.node_id,
          family: "call-flow",
          relation_kinds: ["argument-to-parameter"],
          reason: "resource-limit",
          detail,
          candidate_node_ids: [],
          evidence: {
            ...unknownSemanticEvidence(file, call.location),
            coverage: partialApplicationCoverage(
              javaScriptAnalysisCoverageLimits({
                transfer_record_bytes:
                  JAVASCRIPT_ANALYSIS_TRANSFER_RECORD_BYTES,
              }),
              null,
            ),
            limitations: [detail],
          },
        });
      }
      if (
        call.arguments.some(
          (argument) => argument.literalResourceLimit === "primitive-bytes",
        )
      ) {
        const limit = "primitive-bytes";
        addSemanticGraphUnknown(state, {
          node_id: node.node_id,
          family: "call-flow",
          relation_kinds: ["argument-to-parameter"],
          reason: "resource-limit",
          detail: semanticResourceLimitReason(limit),
          candidate_node_ids: [],
          evidence: {
            ...unknownSemanticEvidence(file, call.location),
            coverage: partialApplicationCoverage(
              semanticResourceLimitCoverage([limit]),
              null,
            ),
            limitations: [semanticResourceLimitReason(limit)],
          },
        });
      }
    }
  }
  return result;
}

function* projectDefinitionsAndReferences(
  context: Omit<FileContext, "referenceNodesWithin">,
): Generator<void, void> {
  for (const [bindingIndex, binding] of context.ir.bindings.entries()) {
    if (bindingIndex % 64 === 0) yield;
    const bindingNode = context.bindingNodes.get(binding.bindingId);
    if (bindingNode === undefined) continue;
    for (const [index, definition] of binding.definitions.entries()) {
      const definitionNode = retainNode(context.state, context.file, {
        kind: "expression",
        roleKey: `definition:${binding.bindingId}:${String(index)}`,
        location: definition.location,
        label: definition.kind,
        functionNodeId: bindingNode.function_node_id,
      });
      addRelation(context.state, {
        source: definitionNode,
        target: bindingNode,
        relation: "defines",
        resolution: "resolved",
      });
    }
  }
  for (const [index, reference] of context.ir.references.entries()) {
    if (index % 64 === 0) yield;
    const expression = retainNode(context.state, context.file, {
      kind: "expression",
      roleKey: `reference:${String(index)}:${reference.role}:${reference.name}`,
      location: reference.location,
      label: reference.name,
      functionNodeId:
        context.callableOwnerAt(reference.location)?.node_id ?? null,
    });
    const binding =
      reference.bindingId === null
        ? undefined
        : context.bindingNodes.get(reference.bindingId);
    if (expression !== null) {
      context.referenceNodes.push(expression);
      if (reference.role === "read") context.readNodes.push(expression);
      if (reference.role === "write") context.writeNodes.push(expression);
    }
    if (binding === undefined || expression === null) continue;
    if (reference.role === "read")
      addRelation(context.state, {
        source: binding,
        target: expression,
        relation: "reads",
        resolution: "resolved",
        evidence: inferredSemanticEvidenceAt(context.file, reference.location),
      });
    else if (reference.role === "write")
      addRelation(context.state, {
        source: expression,
        target: binding,
        relation: "writes",
        resolution: "resolved",
      });
  }
}

const projectCalls = (context: FileContext): void => {
  const expressions = new Set(
    context.ir.expressionFlows.map((flow) =>
      javascriptSourceRangeKey(flow.location),
    ),
  );
  for (const call of context.ir.callSites) {
    const callNode = context.callSiteNodes.get(call.callSiteId);
    if (callNode === undefined) continue;
    for (const callableId of call.calleeCallableIds) {
      const callable = context.callableNodes.get(callableId);
      addRelation(context.state, {
        source: callNode,
        target: callable,
        relation: "calls",
        resolution: call.resolution === "exact" ? "resolved" : "candidate",
      });
    }
    for (const argument of call.arguments) {
      const argumentNode = createArgumentNode(
        context,
        callNode,
        call.callSiteId,
        argument,
      );
      if (argumentNode !== null)
        context.argumentNodes.set(
          `${call.callSiteId}\u0000${String(argument.index)}`,
          argumentNode,
        );
      if (!argument.spread && Object.hasOwn(argument, "literal"))
        addRelation(context.state, {
          source: argumentNode,
          target: callNode,
          relation: "influences",
          resolution: "resolved",
        });
      if (
        call.resolution !== "exact" &&
        call.resultUsed &&
        argumentNode !== null
      )
        addSemanticGraphUnknown(context.state, {
          node_id: argumentNode.node_id,
          family: "data-flow",
          relation_kinds: ["influences"],
          reason: "dynamic-call",
          detail:
            "The dynamic call's return dependency on this argument is unknown.",
          candidate_node_ids: [],
          evidence: unknownSemanticEvidence(context.file, argument.location),
        });
      const references =
        argument.valueExpressionLocation !== null &&
        expressions.has(
          javascriptSourceRangeKey(argument.valueExpressionLocation),
        )
          ? []
          : context
              .referenceNodesWithin(argument.location)
              .filter(
                (reference) =>
                  reference.function_node_id === callNode.function_node_id,
              );
      for (const reference of references)
        addRelation(context.state, {
          source: reference,
          target: argumentNode,
          relation: "aliases",
          resolution:
            references.length === 1 &&
            rangesEqual(reference.identity.source_range, argument.location)
              ? "resolved"
              : "candidate",
        });
      addRelation(context.state, {
        source: semanticObjectReadOccurrence(
          context,
          argument.valueExpressionLocation,
        ),
        target: argumentNode,
        relation: "aliases",
        resolution: "resolved",
      });
    }
  }
  for (const flow of context.ir.argumentFlows) {
    const argument = context.argumentNodes.get(
      `${flow.callSiteId}\u0000${String(flow.argumentIndex)}`,
    );
    const parameter = context.bindingNodes.get(flow.parameterBindingId);
    addRelation(context.state, {
      source: argument,
      target: parameter,
      relation: "argument-to-parameter",
      resolution: context.callResolutions.get(flow.callSiteId) ?? "candidate",
    });
  }
  const returnFlowsByCallSite = new Map<
    string,
    JavaScriptSemanticCallReturnFlow[]
  >();
  for (const flow of context.ir.callReturnFlows) {
    const grouped = returnFlowsByCallSite.get(flow.callSiteId);
    if (grouped === undefined)
      returnFlowsByCallSite.set(flow.callSiteId, [flow]);
    else grouped.push(flow);
    addRelation(context.state, {
      source: context.returnSiteNodes.get(flow.returnSiteId),
      target: context.callSiteNodes.get(flow.callSiteId),
      relation: "returns-to-call",
      resolution: context.callResolutions.get(flow.callSiteId) ?? "candidate",
    });
  }
  for (const flow of context.ir.callResultFlows) {
    const resolution =
      context.callResolutions.get(flow.callSiteId) ?? "candidate";
    const target = context.bindingNodes.get(flow.bindingId);
    const returns = returnFlowsByCallSite.get(flow.callSiteId) ?? [];
    // A literal argument may influence the invocation. The assigned value
    // comes from modeled returns, so an ignored parameter does not reach it.
    if (returns.length === 0) {
      addRelation(context.state, {
        source: context.callSiteNodes.get(flow.callSiteId),
        target,
        relation: "aliases",
        resolution,
      });
      continue;
    }
    for (const item of returns)
      addRelation(context.state, {
        source: context.returnSiteNodes.get(item.returnSiteId),
        target,
        relation: "aliases",
        resolution,
      });
  }
  projectSemanticReturnValues(context);
};

const createArgumentNode = (
  context: FileContext,
  callNode: JavaScriptSemanticGraphNode,
  callSiteId: string,
  argument: JavaScriptSemanticCallArgument,
): JavaScriptSemanticGraphNode | null =>
  retainNode(context.state, context.file, {
    kind: "expression",
    roleKey: `argument:${callSiteId}:${String(argument.index)}`,
    location: argument.location,
    label: argument.spread
      ? "spread argument"
      : `argument ${String(argument.index)}`,
    functionNodeId: callNode.function_node_id,
    ...(!argument.spread && Object.hasOwn(argument, "literal")
      ? {
          properties: {
            literal_argument_value: argument.literal ?? null,
            literal_argument_call_site_node_id: callNode.node_id,
          },
        }
      : {}),
  });

/** Per-file projection passes, run in this order with a yield between each. */
const FILE_PROJECTION_PASSES: readonly ((
  context: FileContext,
) => Iterator<void, void> | void)[] = [
  projectSemanticValues,
  projectSemanticObjects,
  projectSemanticAssignments,
  projectCalls,
  projectSemanticExpressionInfluence,
  projectSemanticPromises,
  projectSemanticEvents,
  projectSemanticTimers,
  projectSemanticChildProcesses,
  projectSemanticConfiguration,
  projectSemanticRequests,
  projectSemanticBoundaries,
  projectSemanticResources,
  projectSemanticClosureCaptures,
  projectSemanticFrontiers,
];
