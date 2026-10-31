import type { JavaScriptApplicationGraph } from "./javascriptApplicationGraph.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import { uniqueSorted } from "../canonicalOrdering.js";
import type { StaticLoadStateProjection } from "./javascriptRuntimeLoadState.js";
import type { RuntimeMatchingProjection } from "./javascriptRuntimeReconciliationMatching.js";
import type { ParsedStaticLayer } from "./javascriptRuntimeReconciliationParsing.js";
import type { ParsedRuntimeCapture } from "./javascriptRuntimeReconciliationCaptureParsing.js";
import {
  javascriptRuntimeReconciliationResultSchema,
  type JavaScriptRuntimeReconciliationResult,
} from "./javascriptRuntimeReconciliationSchemas.js";
import type { RuntimeProjection } from "./javascriptRuntimeReconciliationRuntime.js";

interface ReconciliationProjection {
  readonly layers: readonly ParsedStaticLayer[];
  readonly captures: readonly ParsedRuntimeCapture[];
  readonly runtime: RuntimeProjection;
  readonly matching: RuntimeMatchingProjection;
  readonly loadStates: StaticLoadStateProjection;
  readonly graph: JavaScriptApplicationGraph;
  readonly omittedGraphItems: number;
}

interface CompletionFlags {
  readonly outputTruncated: boolean;
  readonly inputStatus: "complete" | "partial" | "truncated";
}

/** Build and verify the deterministic caller-visible reconciliation result. */
export const createJavaScriptRuntimeReconciliationResult = (
  input: ReconciliationProjection,
): JavaScriptRuntimeReconciliationResult => {
  const completion = completionFlags(input);
  const semantic = {
    static_layers: staticLayerSummaries(input.layers),
    runtime_captures: captureSummaries(input.captures, input.runtime),
    graph: input.graph,
    summary: reconciliationSummary(input),
    reconciliations: input.matching.items,
    static_load_states: input.loadStates.states,
    source_map_authority: sourceMapAuthority(input),
    coverage: reconciliationCoverage(input, completion),
    evidence_links: uniqueSorted([
      ...input.layers.map(({ evidence }) => evidence.evidence_id),
      ...input.captures.map(({ evidence }) => evidence.evidence_id),
    ]),
    limitations: reconciliationLimitations(completion),
  };
  return javascriptRuntimeReconciliationResultSchema.parse({
    reconciliation_id: `jrr_${digestCanonicalValue(semantic, "Runtime reconciliation")}`,
    ...semantic,
  });
};

const staticLayerSummaries = (
  layers: readonly ParsedStaticLayer[],
): JavaScriptRuntimeReconciliationResult["static_layers"] =>
  layers.map((layer) => ({
    layer_id: layer.layerId,
    role: layer.role,
    evidence_id: layer.evidence.evidence_id,
    graph_id: layer.graph.graph_id,
    root_artifact_sha256: layer.result.root_artifact_sha256,
    input_path: layer.result.input_path,
    format: layer.result.format,
    runtime_mappings: [...layer.runtimeMappings],
  }));

const captureSummaries = (
  captures: readonly ParsedRuntimeCapture[],
  runtime: RuntimeProjection,
): JavaScriptRuntimeReconciliationResult["runtime_captures"] =>
  captures.map((capture) => {
    const targetNode = runtime.targetNodeByEvidenceId.get(
      capture.evidence.evidence_id,
    );
    if (targetNode === undefined)
      throw new TypeError("Runtime projection omitted a required target node");
    return {
      evidence_id: capture.evidence.evidence_id,
      capture_sha256: capture.captureSha256,
      kind: capture.kind,
      target_node_id: targetNode.node_id,
      target_key: capture.inspection.target.target_id,
      target_location:
        "unresolved_location" in capture.inspection.target
          ? capture.inspection.target.unresolved_location
          : "url" in capture.inspection.target
            ? capture.inspection.target.url
            : capture.inspection.target.file_path,
      frames: capture.inspection.frames.length,
      scripts: capture.inspection.scripts.items.length,
      workers: capture.inspection.workers.length,
      scripts_complete_within_scope: capture.scriptsCompleteWithinScope,
    };
  });

const reconciliationSummary = (
  input: ReconciliationProjection,
): JavaScriptRuntimeReconciliationResult["summary"] => ({
  runtime_targets: countBy(input.runtime.entities, "kind", "target"),
  runtime_frames: countBy(input.runtime.entities, "kind", "frame"),
  runtime_scripts: countBy(input.runtime.entities, "kind", "script"),
  runtime_workers: countBy(input.runtime.entities, "kind", "worker"),
  matched: countBy(input.matching.items, "status", "matched"),
  ambiguous: countBy(input.matching.items, "status", "ambiguous"),
  unmatched: countBy(input.matching.items, "status", "unmatched"),
  unknown: countBy(input.matching.items, "status", "unknown"),
  static_loaded: countBy(input.loadStates.states, "status", "loaded"),
  static_resident: countBy(
    input.loadStates.states,
    "status",
    "resident-in-loaded-asset",
  ),
  static_not_observed: countBy(
    input.loadStates.states,
    "status",
    "not-observed-in-capture",
  ),
  static_unknown: countBy(input.loadStates.states, "status", "unknown"),
});

const sourceMapAuthority = (
  input: ReconciliationProjection,
): JavaScriptRuntimeReconciliationResult["source_map_authority"] => ({
  used_for_primary_matching: false,
  static_layer_count: input.layers.length,
  runtime_script_declarations: input.captures.reduce(
    (total, capture) =>
      total +
      (capture.kind === "browser"
        ? capture.inspection.scripts.items.filter(
            ({ source_map_url: url }) => url !== null,
          ).length
        : 0),
    0,
  ),
  limitation:
    "Source-map declarations and original-source content retain separate static authority and are not used as primary runtime byte matches.",
});

const reconciliationCoverage = (
  input: ReconciliationProjection,
  completion: CompletionFlags,
): JavaScriptRuntimeReconciliationResult["coverage"] => ({
  status:
    completion.outputTruncated || completion.inputStatus === "truncated"
      ? "truncated"
      : completion.inputStatus === "partial"
        ? "partial"
        : "complete-within-inputs",
  truncated:
    completion.outputTruncated || completion.inputStatus === "truncated",
  omitted_runtime_entities: input.runtime.omittedEntities,
  omitted_reconciliation_items: input.matching.omittedItems,
  omitted_static_load_states: input.loadStates.omittedStates,
  omitted_graph_items: input.omittedGraphItems,
});

const completionFlags = (input: ReconciliationProjection): CompletionFlags => {
  const inputTruncated =
    input.layers.some(({ graph }) => graph.coverage.truncated) ||
    input.captures.some(({ inspection }) =>
      inspection.completeness.conditions.includes("truncated"),
    );
  const inputPartial =
    input.layers.some(({ graph }) => graph.coverage.status !== "complete") ||
    input.captures.some(
      ({ inspection }) =>
        inspection.completeness.status !== "complete_within_window",
    );
  return {
    outputTruncated:
      input.runtime.omittedEntities > 0 ||
      input.matching.omittedItems > 0 ||
      input.loadStates.omittedStates > 0 ||
      input.omittedGraphItems > 0,
    inputStatus: inputTruncated
      ? "truncated"
      : inputPartial
        ? "partial"
        : "complete",
  };
};

const reconciliationLimitations = (completion: CompletionFlags): string[] =>
  uniqueSorted([
    "Only caller-supplied, semantically verified Evidence records were reconciled.",
    "Digest equality establishes byte identity but not code reachability, module initialization, or feature execution.",
    "A static module resident in an observed bundle is not reported as executed.",
    "Not-observed means absent from the bounded captures in scope, never globally unloaded.",
    "Caller-declared file and URL mappings are inference inputs and do not expand CDP origin or filesystem-root authority.",
    "Source-map authority remains separate from passive runtime authority.",
    ...(completion.inputStatus !== "complete"
      ? ["One or more static graphs or passive captures were incomplete."]
      : []),
    ...(completion.outputTruncated
      ? [
          "Runtime reconciliation omitted entities or classifications during projection.",
        ]
      : []),
  ]);

const countBy = <Item extends Record<Key, string>, Key extends keyof Item>(
  items: readonly Item[],
  key: Key,
  value: Item[Key],
): number => items.filter((item) => item[key] === value).length;
